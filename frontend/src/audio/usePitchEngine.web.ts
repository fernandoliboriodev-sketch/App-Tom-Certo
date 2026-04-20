// WEB fallback pitch engine using the Web Audio API + YIN.
// Exposed as a hook so the API matches the native version.

import { useCallback, useRef } from 'react';
import { yinPitch } from './yin';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';
import type {
  PitchCallback,
  ErrorCallback,
  PitchEngineHandle,
} from './types';

interface Internal {
  ctx: AudioContext | null;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  rafId: number | null;
  buffer: Float32Array | null;
}

export function usePitchEngine(): PitchEngineHandle {
  const innerRef = useRef<Internal>({
    ctx: null,
    stream: null,
    source: null,
    analyser: null,
    rafId: null,
    buffer: null,
  });
  const softInfoRef = useRef<((msg: string) => void) | null>(null);

  const stop = useCallback(async () => {
    const i = innerRef.current;
    if (i.rafId !== null) {
      cancelAnimationFrame(i.rafId);
      i.rafId = null;
    }
    try { i.source?.disconnect(); } catch { /* noop */ }
    try { i.analyser?.disconnect(); } catch { /* noop */ }
    i.stream?.getTracks().forEach((t) => t.stop());
    i.stream = null;
    i.source = null;
    i.analyser = null;
    i.buffer = null;
    if (i.ctx && i.ctx.state !== 'closed') {
      i.ctx.close().catch(() => {});
    }
    i.ctx = null;
  }, []);

  const start = useCallback(
    async (onPitch: PitchCallback, onError: ErrorCallback): Promise<boolean> => {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          onError('Seu navegador não suporta captura de microfone.', 'platform_limit');
          return false;
        }

        const i = innerRef.current;
        i.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        const AnyAudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        i.ctx = new AnyAudioContext();
        if (i.ctx!.state === 'suspended') await i.ctx!.resume();

        i.source = i.ctx!.createMediaStreamSource(i.stream);
        i.analyser = i.ctx!.createAnalyser();
        i.analyser.fftSize = 2048;
        i.analyser.smoothingTimeConstant = 0;
        i.source.connect(i.analyser);

        i.buffer = new Float32Array(i.analyser.fftSize);
        const sr = i.ctx!.sampleRate;

        const loop = () => {
          const ii = innerRef.current;
          if (!ii.analyser || !ii.buffer) return;
          ii.analyser.getFloatTimeDomainData(ii.buffer);
          const result = yinPitch(ii.buffer, { sampleRate: sr });
          if (result.frequency > 0) {
            const midi = frequencyToMidi(result.frequency);
            const pc = midiToPitchClass(midi);
            onPitch({
              pitchClass: pc,
              frequency: result.frequency,
              rms: result.rms,
              clarity: result.probability,
            });
          }
          ii.rafId = requestAnimationFrame(loop);
        };
        loop();
        return true;
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (/permission|denied|NotAllowed/i.test(msg)) {
          onError('Permita o acesso ao microfone para detectar o tom.', 'permission_denied');
        } else if (/NotFound|DevicesNotFound/i.test(msg)) {
          onError('Nenhum microfone encontrado no dispositivo.', 'unknown');
        } else {
          onError('Erro ao acessar o microfone', 'unknown');
        }
        await stop();
        return false;
      }
    },
    [stop]
  );

  const setSoftInfoHandler = useCallback((handler: (msg: string) => void) => {
    softInfoRef.current = handler;
  }, []);

  return {
    isSupported: true,
    start,
    stop,
    setSoftInfoHandler,
  };
}
