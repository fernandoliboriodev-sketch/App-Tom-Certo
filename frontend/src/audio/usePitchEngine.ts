/**
 * NATIVE (iOS/Android) pitch engine using @siteed/audio-studio for real PCM streaming.
 * Feeds Float32 samples to the YIN algorithm frame-by-frame.
 *
 * ── FIXES (Bug: "Recording is already in progress") ──────────────────────────
 * FIX 1: isStartingRef lock — previne chamadas concorrentes a start()
 * FIX 2: Guard de sessão ativa — se activeRef=true, força stop() antes de iniciar
 * FIX 3: activeRef.current = true movido para APÓS recorder.startRecording() ter sucesso
 *        (antes estava antes do await, causando flag inconsistente se o start falhasse)
 * FIX 4: Safety delay de 250ms em stop() — dá tempo para o Android liberar AudioRecord
 * FIX 5: Logs detalhados em todas as etapas para diagnóstico
 */

import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  AudioStudioModule,
  AudioDataEvent,
} from '@siteed/audio-studio';
import { yinPitch } from './yin';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';
import * as storage from '../auth/storage';
import type {
  PitchCallback,
  ErrorCallback,
  PitchEngineHandle,
  PitchErrorReason,
  CapturedClip,
} from './types';

// ─── Parâmetros de captura ────────────────────────────────────────────────────
// 16kHz: baixo consumo de CPU, suficiente para pitch vocal/instrumental (até ~1500Hz)
const SAMPLE_RATE = 16000;
// Janela YIN: 2048 amostras @ 16kHz = 128ms por frame
const FRAME_SIZE = 2048;
// Intervalo de chunk do lado nativo (ms). Menor = atualizações mais frequentes.
const STREAM_INTERVAL_MS = 100;
const PERM_KEY = 'tc_mic_granted_v1';

async function ensureMicPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    const current = await AudioStudioModule.getPermissionsAsync?.().catch(() => null);
    if (current && (current as any).granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if (current && (current as any).canAskAgain === false) return 'blocked';

    const next = await AudioStudioModule.requestPermissionsAsync();
    if ((next as any).granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if ((next as any).canAskAgain === false) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

export function usePitchEngine(): PitchEngineHandle {
  const recorder = useAudioRecorder();
  const onPitchRef = useRef<PitchCallback | null>(null);
  const onErrorRef = useRef<ErrorCallback | null>(null);
  const softInfoRef = useRef<((msg: string) => void) | null>(null);
  const activeRef = useRef(false);

  // ── FIX 1: Lock para prevenir start() concorrente ─────────────────────────
  const isStartingRef = useRef(false);

  // ── Ring buffer de tamanho FIXO para amostras Float32 ─────────────────────
  // ANTES: alocava new Float32Array() a cada chunk de áudio (100ms) — causava
  // GC pressure e lag no Android em sessões longas.
  // AGORA: buffer fixo de capacidade 8192 samples (~512ms @ 16kHz).
  const RING_CAPACITY = 8192;
  const ringRef = useRef<Float32Array>(new Float32Array(RING_CAPACITY));
  const ringLenRef = useRef<number>(0); // quantas amostras válidas estão no buffer

  // ── Captura em paralelo para análise ML (backend) ──────────────────────────
  // Quando ativa, cada chunk do audio stream é copiado para `captureBuffersRef`
  // em paralelo ao processamento YIN. Não afeta performance do pitch em tempo real.
  const captureActiveRef = useRef(false);
  const captureBuffersRef = useRef<Float32Array[]>([]);
  const captureTotalSamplesRef = useRef(0);
  const captureMaxSamplesRef = useRef(0);
  const captureResolveRef = useRef<((clip: CapturedClip | null) => void) | null>(null);

  const runYinOnFrame = useCallback((frame: Float32Array, sampleRate: number) => {
    if (!activeRef.current) return; // skip YIN se sessão parou (evita trabalho perdido)
    const result = yinPitch(frame, { sampleRate });
    if (result.frequency > 0 && onPitchRef.current) {
      const midi = frequencyToMidi(result.frequency);
      const pc = midiToPitchClass(midi);
      onPitchRef.current({
        pitchClass: pc,
        frequency: result.frequency,
        rms: result.rms,
        clarity: result.probability,
      });
    }
  }, []);

  const handleAudioStream = useCallback(
    async (event: AudioDataEvent) => {
      if (!activeRef.current) return;
      const data = event.data;
      if (!(data instanceof Float32Array)) return;

      // ── CAPTURA PARALELA (ML): copia chunk pro buffer se ativo ──────────
      if (captureActiveRef.current) {
        // Clona (não guarda referência; nativo pode reusar o buffer)
        const cloned = new Float32Array(data.length);
        cloned.set(data);
        captureBuffersRef.current.push(cloned);
        captureTotalSamplesRef.current += cloned.length;
        // Se atingiu o alvo, resolve
        if (
          captureMaxSamplesRef.current > 0 &&
          captureTotalSamplesRef.current >= captureMaxSamplesRef.current
        ) {
          const total = captureTotalSamplesRef.current;
          const merged = new Float32Array(total);
          let off = 0;
          for (const buf of captureBuffersRef.current) {
            merged.set(buf, off);
            off += buf.length;
          }
          captureActiveRef.current = false;
          captureBuffersRef.current = [];
          captureTotalSamplesRef.current = 0;
          captureMaxSamplesRef.current = 0;
          const resolver = captureResolveRef.current;
          captureResolveRef.current = null;
          if (resolver) {
            resolver({
              samples: merged,
              sampleRate: SAMPLE_RATE,
              durationMs: (total / SAMPLE_RATE) * 1000,
            });
          }
        }
      }

      const ring = ringRef.current;
      const len = ringLenRef.current;
      const sr = SAMPLE_RATE;

      // ── Adicionar nova amostra ao ring buffer (sem alocar) ──────────────
      let newLen = len + data.length;
      if (newLen > RING_CAPACITY) {
        // Buffer cheio: descartar amostras antigas (shift esquerda)
        const keep = RING_CAPACITY - data.length;
        if (keep > 0) {
          ring.copyWithin(0, len - keep, len);
          ring.set(data, keep);
          newLen = RING_CAPACITY;
        } else {
          // chunk maior que o buffer (improvável): manter só os últimos
          ring.set(data.subarray(data.length - RING_CAPACITY), 0);
          newLen = RING_CAPACITY;
        }
      } else {
        ring.set(data, len);
      }

      // ── Processar frames YIN SEM overlap (reduz 50% da CPU) ──────────────
      // Antes: overlap 50% → 1 YIN a cada FRAME_SIZE/2 samples (64ms) = 15 Hz
      // Agora: sem overlap → 1 YIN a cada FRAME_SIZE samples (128ms) = 7.8 Hz
      // Pitch tracking funciona bem a 7.8 Hz — e libera a thread JS
      // para eventos de toque (botões agora respondem instantaneamente).
      let offset = 0;
      while (newLen - offset >= FRAME_SIZE) {
        // subarray NÃO aloca — é só uma view do ring buffer
        const frame = ring.subarray(offset, offset + FRAME_SIZE);
        runYinOnFrame(frame, sr);
        offset += FRAME_SIZE; // sem overlap
      }

      // ── Shift buffer para manter apenas amostras pendentes ──────────────
      const remaining = newLen - offset;
      if (remaining > 0 && offset > 0) {
        ring.copyWithin(0, offset, newLen);
      }
      ringLenRef.current = remaining;
    },
    [runYinOnFrame]
  );

  // ── stop() ─────────────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    console.log(`[AudioEngine][STOP] Chamado. activeRef=${activeRef.current} isStarting=${isStartingRef.current}`);

    if (!activeRef.current && !isStartingRef.current) {
      console.log('[AudioEngine][STOP] Gravação já estava parada — ignorando chamada duplicada');
      return;
    }

    activeRef.current = false;
    ringLenRef.current = 0;

    try {
      await recorder.stopRecording();
      console.log('[AudioEngine][STOP] recorder.stopRecording() concluído com sucesso');
    } catch (e: any) {
      // Pode acontecer se a gravação já foi parada (não é erro crítico)
      console.warn('[AudioEngine][STOP] stopRecording() falhou (gravação já parada?):', String(e?.message || e));
    }

    // ── FIX 4: Safety delay ─────────────────────────────────────────────────
    // O Android pode levar alguns milissegundos para liberar o AudioRecord completamente.
    // Sem esse delay, uma chamada imediata a startRecording() retorna
    // "Recording is already in progress" mesmo depois de stopRecording().
    await new Promise(resolve => setTimeout(resolve, 250));
    console.log('[AudioEngine][STOP] Cleanup concluído. AudioRecord liberado. Pronto para novo start.');
  }, [recorder]);

  // ── start() ────────────────────────────────────────────────────────────────
  const start = useCallback(
    async (onPitch: PitchCallback, onError: ErrorCallback): Promise<boolean> => {
      // ── FIX 1: Lock de inicialização ────────────────────────────────────────
      // Previne race condition se start() for chamado duas vezes antes de completar
      if (isStartingRef.current) {
        console.warn('[AudioEngine][START] WARN: start() chamado enquanto já está iniciando — chamada ignorada para evitar "Recording is already in progress"');
        return false;
      }

      // ── FIX 2: Forçar stop se sessão anterior ainda ativa ──────────────────
      // Se activeRef=true, a gravação anterior não foi encerrada corretamente.
      // Isso causa "Recording is already in progress" no Android.
      if (activeRef.current) {
        console.warn('[AudioEngine][START] WARN: Sessão de gravação anterior ainda ativa (activeRef=true). Forçando stop() antes de iniciar nova sessão...');
        await stop();
      }

      isStartingRef.current = true;
      console.log('[AudioEngine][START-1] Iniciando engine de áudio...');

      onPitchRef.current = onPitch;
      onErrorRef.current = onError;
      ringLenRef.current = 0;

      // ── Verificação de permissão com logs detalhados ──────────────────────
      console.log('[AudioEngine][START-2] Verificando permissão do microfone...');
      let perm: 'granted' | 'denied' | 'blocked';
      try {
        perm = await ensureMicPermission();
      } catch (e: any) {
        console.error('[AudioEngine][START] ensureMicPermission() lançou exceção:', String(e?.message || e));
        isStartingRef.current = false;
        onError('Erro ao verificar permissão do microfone.', 'unknown');
        return false;
      }
      console.log('[AudioEngine][START-3] Resultado da permissão:', perm);

      if (perm === 'blocked') {
        isStartingRef.current = false;
        console.log('[AudioEngine][START] Permissão BLOQUEADA (configurações do sistema)');
        onError(
          'Permita o acesso ao microfone nas configurações do aparelho para detectar o tom.',
          'permission_blocked'
        );
        return false;
      }

      if (perm === 'denied') {
        isStartingRef.current = false;
        console.log('[AudioEngine][START] Permissão NEGADA pelo usuário');
        onError('Permita o acesso ao microfone para detectar o tom.', 'permission_denied');
        return false;
      }

      try {
        console.log('[AudioEngine][START-4] Permissão OK. Chamando recorder.startRecording()...');
        console.log('[AudioEngine][START-5] Estado ANTES do start:', {
          activeRef: activeRef.current,
          isStartingRef: isStartingRef.current,
          platform: Platform.OS,
          platformVersion: Platform.Version,
        });

        await recorder.startRecording({
          sampleRate: SAMPLE_RATE,
          channels: 1,
          encoding: 'pcm_32bit',
          streamFormat: 'float32',
          interval: STREAM_INTERVAL_MS,
          // Evitar DSP que altera o pitch
          android: {
            audioSource: 'unprocessed',
          } as any,
          ios: {
            audioSession: {
              category: 'PlayAndRecord',
              mode: 'measurement',
            },
          } as any,
          onAudioStream: handleAudioStream,
        } as any);

        // ── FIX 3: activeRef SOMENTE após startRecording() ter sucesso ────────
        // ANTES estava: activeRef.current = true; ANTES do await — errado!
        // Se startRecording() falhasse, o flag ficava true incorretamente.
        // AGORA: só marcamos como ativo se a chamada nativa realmente funcionou.
        activeRef.current = true;

        console.log('[AudioEngine][START-6] recorder.startRecording() BEM-SUCEDIDO!');
        console.log('[AudioEngine][START-7] Estado APÓS o start:', {
          activeRef: activeRef.current,
          isStartingRef: isStartingRef.current,
        });

        return true;
      } catch (err: any) {
        activeRef.current = false;

        const msg = String(err?.message || err || '');

        // ── Log técnico completo para diagnóstico ─────────────────────────────
        console.error('[AudioEngine][ERRO CRÍTICO] recorder.startRecording() FALHOU!', {
          message: msg,
          errorName: err?.name,
          errorCode: err?.code,
          stack: err?.stack?.substring(0, 500),
          platform: Platform.OS,
          platformVersion: Platform.Version,
          wasAlreadyRecording: 'não (activeRef estava false antes da chamada)',
          timestamp: new Date().toISOString(),
          possibleCause: msg.includes('already') || msg.includes('progress')
            ? 'RACE CONDITION: recorder nativo ainda estava ativo'
            : 'Outro erro de inicialização',
        });

        let reason: PitchErrorReason = 'unknown';
        if (/permission|denied|NotAllowed/i.test(msg)) {
          reason = 'permission_denied';
        } else if (/not.*support|nativemodule|unavailable|TurboModule/i.test(msg)) {
          reason = 'platform_limit';
          if (Platform.OS !== 'web') {
            softInfoRef.current?.(
              'Este recurso requer o aplicativo instalado (APK). No Expo Go a captação nativa não está disponível.'
            );
          }
        }

        // Mensagem amigável para o usuário
        const userMsg = reason === 'platform_limit'
          ? 'Recurso não disponível neste ambiente. Instale o APK para usar.'
          : 'Não foi possível iniciar o microfone. Tente novamente.';

        onError(userMsg, reason);
        return false;
      } finally {
        isStartingRef.current = false;
        console.log('[AudioEngine][START] Lock isStartingRef liberado');
      }
    },
    [recorder, handleAudioStream, stop]
  );

  const setSoftInfoHandler = useCallback((handler: (msg: string) => void) => {
    softInfoRef.current = handler;
  }, []);

  // ── Captura clip de N ms em paralelo (para envio ML backend) ─────────────
  const captureClip = useCallback(async (durationMs: number): Promise<CapturedClip | null> => {
    if (!activeRef.current) return null;
    if (captureActiveRef.current) return null; // já capturando
    const targetSamples = Math.round((durationMs / 1000) * SAMPLE_RATE);
    captureBuffersRef.current = [];
    captureTotalSamplesRef.current = 0;
    captureMaxSamplesRef.current = targetSamples;
    return new Promise<CapturedClip | null>((resolve) => {
      captureResolveRef.current = resolve;
      captureActiveRef.current = true;
      // Timeout de segurança (2× duração)
      setTimeout(() => {
        if (captureActiveRef.current && captureResolveRef.current === resolve) {
          // Se ainda não resolveu, pega o que tem
          const total = captureTotalSamplesRef.current;
          if (total > 0) {
            const merged = new Float32Array(total);
            let off = 0;
            for (const buf of captureBuffersRef.current) {
              merged.set(buf, off);
              off += buf.length;
            }
            captureResolveRef.current = null;
            captureActiveRef.current = false;
            captureBuffersRef.current = [];
            captureTotalSamplesRef.current = 0;
            resolve({ samples: merged, sampleRate: SAMPLE_RATE, durationMs: (total / SAMPLE_RATE) * 1000 });
          } else {
            captureActiveRef.current = false;
            captureResolveRef.current = null;
            resolve(null);
          }
        }
      }, durationMs * 2 + 1000);
    });
  }, []);

  const isCapturing = useCallback(() => captureActiveRef.current, []);

  return {
    isSupported: true,
    start,
    stop,
    setSoftInfoHandler,
    captureClip,
    isCapturing,
  };
}
