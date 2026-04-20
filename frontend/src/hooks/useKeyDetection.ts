/**
 * useKeyDetection v3 — detecção tonal com 2 camadas de confiança
 *
 * FILOSOFIA:
 * ─ Camada 1 (provisional): resposta rápida (~2s). Mostra "tom provável" com confiança real.
 *   Atualiza continuamente conforme mais dados chegam.
 * ─ Camada 2 (confirmed): após confirmação por N frames + confiança alta + variedade melódica.
 *   Uma vez confirmado, o tom só muda com evidência forte (histerese + frames consecutivos).
 *
 * O usuário vê IMEDIATAMENTE um tom provável com % de confiança, e esse número
 * sobe conforme ele continua cantando. Não há mais "silêncio informacional" de 6s.
 *
 * PROTEÇÕES:
 * ─ Notas isoladas erradas NÃO trocam o tom (filtro de dedupe + peso por duração).
 * ─ Mudança real de tom exige 10+ frames consecutivos do novo tom com confiança alta.
 * ─ Tolerância a notas fora da escala (histograma absorve ruído com decay).
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { detectKeyFromHistogram, KeyResult } from '../utils/keyDetector';
import { usePitchEngine } from '../audio/usePitchEngine';
import type { PitchEvent, PitchErrorReason } from '../audio/types';
import { frequencyToMidi, midiToPitchClass, formatKeyDisplay } from '../utils/noteUtils';

// ─── Janelas e filtros ──────────────────────────────────────────────────────
const HISTORY_MS = 15000;          // 15s de histórico de notas
const ANALYZE_INTERVAL_MS = 300;   // 300ms = 3.3x/s (mais responsivo)

const MIN_RMS = 0.020;
const MIN_CLARITY = 0.88;
const FREQ_SMOOTH_WINDOW = 7;      // mediana móvel (reduzido para resposta mais rápida)

// ─── Camada 1: Provisional (rápido) ─────────────────────────────────────────
const PROV_MIN_MS = 1800;          // 1.8s mínimo
const PROV_MIN_SAMPLES = 10;       // 10 amostras
const PROV_MIN_UNIQUE = 3;         // 3 notas distintas
const PROV_MIN_CONFIDENCE = 0.45;  // confiança mínima para mostrar provisório

// ─── Camada 2: Confirmed (robusto) ──────────────────────────────────────────
const CONF_MIN_MS = 5500;          // 5.5s mínimo
const CONF_MIN_UNIQUE = 5;
const CONF_MIN_CONFIDENCE = 0.75;
const CONF_CONFIRM_FRAMES = 5;     // 5 frames iguais (~1.5s)

// ─── Mudança de tom (histerese) ─────────────────────────────────────────────
const CHANGE_SUGGEST_FRAMES = 3;   // ~1s para começar a sugerir "possível mudança"
const CHANGE_CONFIRM_FRAMES = 10;  // ~3s para confirmar a mudança
const CHANGE_MIN_CONFIDENCE = 0.70;

// ─── Pesos do histograma ────────────────────────────────────────────────────
const HISTOGRAM_DECAY = 2.0;       // decai exponencialmente com idade
const REPETITION_BOOST = 4.0;      // notas repetidas ganham peso
const DURATION_BOOST = 2.5;        // runs longos (nota sustentada) ganham peso

// ─── UX timings ─────────────────────────────────────────────────────────────
const NOTE_DISPLAY_HOLD_MS = 300;
const SILENCE_HINT_MS = 8000;
const SILENCE_RETRY_MS = 20000;

// ═════════════════════════════════════════════════════════════════════════════
// Tipos
// ═════════════════════════════════════════════════════════════════════════════
interface NoteEvent {
  pitchClass: number;
  timestamp: number;
  rms: number;
  runLength: number; // nº de frames consecutivos com este pitch class (para duration boost)
}

export type DetectionState =
  | 'idle'
  | 'listening'     // ouvindo, sem resultado ainda
  | 'analyzing'     // coletando amostras
  | 'provisional'   // tom provável exibido (camada 1)
  | 'confirmed'     // tom estável (camada 2)
  | 'change_possible'; // sugerindo mudança

export type KeyTier = 'provisional' | 'confirmed' | null;

export interface UseKeyDetectionReturn {
  detectionState: DetectionState;
  currentKey: KeyResult | null;
  keyTier: KeyTier;
  liveConfidence: number;     // 0..1, atualizada continuamente
  changeSuggestion: KeyResult | null; // tom que pode substituir o atual
  currentNote: number | null;
  recentNotes: number[];
  isStable: boolean;
  statusMessage: string;
  isRunning: boolean;
  isSupported: boolean;
  errorMessage: string | null;
  errorReason: PitchErrorReason | null;
  softInfo: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// Hook
// ═════════════════════════════════════════════════════════════════════════════
export function useKeyDetection(): UseKeyDetectionReturn {
  const [detectionState, setDetectionState] = useState<DetectionState>('idle');
  const [currentKey, setCurrentKey] = useState<KeyResult | null>(null);
  const [keyTier, setKeyTier] = useState<KeyTier>(null);
  const [liveConfidence, setLiveConfidence] = useState<number>(0);
  const [changeSuggestion, setChangeSuggestion] = useState<KeyResult | null>(null);
  const [currentNote, setCurrentNote] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [isStable, setIsStable] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Pronto para detectar');
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<PitchErrorReason | null>(null);
  const [softInfo, setSoftInfo] = useState<string | null>(null);

  // ── Refs internas ──────────────────────────────────────────────────────
  const noteHistory = useRef<NoteEvent[]>([]);
  const freqBuffer = useRef<number[]>([]);
  const currentKeyRef = useRef<KeyResult | null>(null);
  const currentTierRef = useRef<KeyTier>(null);
  const changeSuggestionRef = useRef<KeyResult | null>(null);

  // Counters para histerese
  const confirmRef = useRef<{ root: number; quality: string; count: number } | null>(null);
  const changeRef = useRef<{ root: number; quality: string; count: number } | null>(null);

  const sessionStartRef = useRef<number>(0);
  const lastValidPitchAtRef = useRef<number>(0);
  const silenceHintShownRef = useRef<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);
  const lastPitchRef = useRef<number | null>(null);
  const noteDisplayRef = useRef<{ pc: number; setAt: number } | null>(null);
  const isStartingRef = useRef(false);

  const engine = usePitchEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    if (engine.setSoftInfoHandler) {
      engine.setSoftInfoHandler((msg: string) => setSoftInfo(msg));
    }
  }, [engine]);

  const isSupported = engine.isSupported;

  // ── onPitch: mediana + registro com run-length ─────────────────────────
  const onPitch = useCallback((e: PitchEvent) => {
    if (!isRunningRef.current) return;
    if (e.rms < MIN_RMS || e.clarity < MIN_CLARITY) return;

    const now = Date.now();
    lastValidPitchAtRef.current = now;
    silenceHintShownRef.current = false;

    // Mediana móvel de frequência
    freqBuffer.current.push(e.frequency);
    if (freqBuffer.current.length > FREQ_SMOOTH_WINDOW) freqBuffer.current.shift();
    const sortedFreqs = [...freqBuffer.current].sort((a, b) => a - b);
    const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
    const pc = midiToPitchClass(frequencyToMidi(medianFreq));

    // ── Run-length tracking: quantos frames consecutivos com o mesmo pc ──
    let runLength = 1;
    if (lastPitchRef.current === pc) {
      const last = noteHistory.current[noteHistory.current.length - 1];
      if (last && last.pitchClass === pc) {
        runLength = last.runLength + 1;
      }
    }
    lastPitchRef.current = pc;

    noteHistory.current.push({
      pitchClass: pc,
      timestamp: now,
      rms: e.rms,
      runLength,
    });

    // Display (com hold para evitar flicker)
    const disp = noteDisplayRef.current;
    if (!disp || now - disp.setAt >= NOTE_DISPLAY_HOLD_MS) {
      noteDisplayRef.current = { pc, setAt: now };
      setCurrentNote(pc);
    }

    // recentNotes (últimas 6 distintas em ordem)
    const all = noteHistory.current.slice(-60).map(n => n.pitchClass);
    const dedup: number[] = [];
    for (const p of all) {
      if (dedup.length === 0 || dedup[dedup.length - 1] !== p) dedup.push(p);
    }
    setRecentNotes(dedup.slice(-6));
  }, []);

  const onEngineError = useCallback((msg: string, reason?: PitchErrorReason) => {
    console.log('[KeyDetection][ERRO]', msg, reason);
    setErrorMessage(msg);
    setErrorReason(reason ?? 'unknown');
    setStatusMessage(msg);
    isRunningRef.current = false;
    setIsRunning(false);
    setDetectionState('idle');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ── Construção do histograma com pesos (duration + repetition + decay) ─
  const buildHistogram = useCallback((history: NoteEvent[], now: number): number[] => {
    const rawCounts = new Array(12).fill(0);
    const maxRun = new Array(12).fill(0);
    const histogram = new Array(12).fill(0);

    for (const note of history) {
      const age = (now - note.timestamp) / HISTORY_MS;
      const decay = Math.exp(-HISTOGRAM_DECAY * age);
      // Peso base: RMS × decay × (1 + log(runLength))
      //   → nota sustentada (run longo) ganha peso extra mas com retorno decrescente
      const durationWeight = 1.0 + Math.log1p(note.runLength) * 0.6;
      histogram[note.pitchClass] += note.rms * decay * durationWeight;
      rawCounts[note.pitchClass]++;
      if (note.runLength > maxRun[note.pitchClass]) {
        maxRun[note.pitchClass] = note.runLength;
      }
    }

    // Boost de repetição (frequência relativa)
    const total = history.length || 1;
    for (let i = 0; i < 12; i++) {
      const freq = rawCounts[i] / total;
      histogram[i] *= 1.0 + freq * REPETITION_BOOST;
    }

    // Boost de duração máxima (note class com run longo = forte candidato a tônica)
    for (let i = 0; i < 12; i++) {
      if (maxRun[i] >= 3) {
        histogram[i] *= 1.0 + (maxRun[i] / 10) * DURATION_BOOST * 0.25;
      }
    }

    return histogram;
  }, []);

  // ── analyzeKey: máquina de estados 2-tier ──────────────────────────────
  const analyzeKey = useCallback(() => {
    if (!isRunningRef.current) return;

    const now = Date.now();
    noteHistory.current = noteHistory.current.filter(n => n.timestamp >= now - HISTORY_MS);

    const history = noteHistory.current;
    const elapsed = now - sessionStartRef.current;
    const uniqueNotes = new Set(history.map(h => h.pitchClass)).size;
    const hasKey = !!currentKeyRef.current;
    const tier = currentTierRef.current;

    // ── Silence detection ────────────────────────────────────────────────
    const timeSinceLastPitch = now - lastValidPitchAtRef.current;
    const everHadPitch = lastValidPitchAtRef.current > 0;

    if (!hasKey && everHadPitch && timeSinceLastPitch > SILENCE_RETRY_MS) {
      setStatusMessage('Sem áudio — verifique o microfone');
      setDetectionState('listening');
      return;
    }
    if (!hasKey && !everHadPitch && elapsed > SILENCE_HINT_MS && !silenceHintShownRef.current) {
      silenceHintShownRef.current = true;
      setSoftInfo('Cante ou toque uma nota próximo ao microfone');
    }

    // ── Fase 0: sem dados ─────────────────────────────────────────────────
    if (!hasKey && history.length < 3) {
      setDetectionState('listening');
      setStatusMessage('Ouvindo...');
      return;
    }

    // ── Computa histograma e roda K-S ────────────────────────────────────
    const histogram = buildHistogram(history, now);
    const result = detectKeyFromHistogram(histogram);
    const conf = Math.max(0, result.confidence);

    // Atualiza confiança live SEMPRE (feedback contínuo ao usuário)
    setLiveConfidence(conf);

    // ═════════════════════════════════════════════════════════════════════
    // SEM TOM AINDA → tentar estabelecer PROVISIONAL rápido
    // ═════════════════════════════════════════════════════════════════════
    if (!hasKey) {
      const readyForProv =
        elapsed >= PROV_MIN_MS &&
        history.length >= PROV_MIN_SAMPLES &&
        uniqueNotes >= PROV_MIN_UNIQUE &&
        conf >= PROV_MIN_CONFIDENCE;

      if (!readyForProv) {
        setDetectionState('analyzing');
        // Mensagens progressivas
        if (history.length < PROV_MIN_SAMPLES) {
          setStatusMessage('Ouvindo...');
        } else if (uniqueNotes < PROV_MIN_UNIQUE) {
          setStatusMessage(`Analisando tonalidade... (${uniqueNotes}/${PROV_MIN_UNIQUE} notas)`);
        } else {
          const pct = Math.round(conf * 100);
          setStatusMessage(`Analisando tonalidade... (${pct}%)`);
        }
        return;
      }

      // ── PROVISIONAL key definido ─────────────────────────────────────
      currentKeyRef.current = { ...result };
      currentTierRef.current = 'provisional';
      confirmRef.current = { root: result.root, quality: result.quality, count: 1 };
      setCurrentKey({ ...result });
      setKeyTier('provisional');
      setDetectionState('provisional');
      setIsStable(false);
      const { noteBr, qualityLabel } = formatKeyDisplay(result.root, result.quality as 'major' | 'minor');
      setStatusMessage(`Tom provável: ${noteBr} ${qualityLabel}`);
      return;
    }

    // ═════════════════════════════════════════════════════════════════════
    // JÁ TEM TOM → refinamento / confirmação / mudança
    // ═════════════════════════════════════════════════════════════════════
    const cur = currentKeyRef.current!;
    const isSameAsCurrent =
      cur.root === result.root && cur.quality === result.quality;

    // Atualizar confiança do currentKey (para exibição)
    currentKeyRef.current = { ...cur, confidence: conf };
    setCurrentKey({ ...cur, confidence: conf });

    // ── Mesmo tom: confirmar ou manter ─────────────────────────────────
    if (isSameAsCurrent) {
      // Limpa sugestão de mudança
      if (changeSuggestionRef.current) {
        changeSuggestionRef.current = null;
        setChangeSuggestion(null);
      }
      changeRef.current = null;

      const cr = confirmRef.current;
      if (!cr || cr.root !== cur.root || cr.quality !== cur.quality) {
        confirmRef.current = { root: cur.root, quality: cur.quality, count: 1 };
      } else {
        cr.count++;
      }

      // Promover PROVISIONAL → CONFIRMED se critérios forem atingidos
      if (
        tier === 'provisional' &&
        elapsed >= CONF_MIN_MS &&
        uniqueNotes >= CONF_MIN_UNIQUE &&
        conf >= CONF_MIN_CONFIDENCE &&
        confirmRef.current!.count >= CONF_CONFIRM_FRAMES
      ) {
        currentTierRef.current = 'confirmed';
        setKeyTier('confirmed');
        setDetectionState('confirmed');
        setIsStable(true);
        setStatusMessage('Estável no tom atual');
      } else if (tier === 'confirmed') {
        setDetectionState('confirmed');
        setIsStable(true);
        setStatusMessage('Estável no tom atual');
      } else {
        // ainda provisional — refinando
        setDetectionState('provisional');
        setIsStable(false);
        const pct = Math.round(conf * 100);
        const { noteBr, qualityLabel } = formatKeyDisplay(cur.root, cur.quality as 'major' | 'minor');
        setStatusMessage(`Refinando: ${noteBr} ${qualityLabel} (${pct}%)`);
      }
      return;
    }

    // ── Tom diferente detectado ───────────────────────────────────────
    //   Provisional: troca mais fácil (ainda não estava firme)
    //   Confirmed:   exige histerese forte
    const needsStrongChange = tier === 'confirmed';

    const ch = changeRef.current;
    if (!ch || ch.root !== result.root || ch.quality !== result.quality) {
      // Primeiro frame do novo tom candidato
      changeRef.current = { root: result.root, quality: result.quality, count: 1 };
    } else {
      ch.count++;
    }

    const changeCount = changeRef.current!.count;

    if (!needsStrongChange) {
      // ── Provisional: troca com 3 frames consistentes + conf razoável ──
      if (changeCount >= CHANGE_SUGGEST_FRAMES && conf >= PROV_MIN_CONFIDENCE) {
        currentKeyRef.current = { ...result };
        setCurrentKey({ ...result });
        confirmRef.current = { root: result.root, quality: result.quality, count: 1 };
        changeRef.current = null;
        setChangeSuggestion(null);
        changeSuggestionRef.current = null;
        setDetectionState('provisional');
        setIsStable(false);
        const { noteBr, qualityLabel } = formatKeyDisplay(result.root, result.quality as 'major' | 'minor');
        setStatusMessage(`Tom provável: ${noteBr} ${qualityLabel}`);
        return;
      }
      // Ainda coletando evidência — mantém o provisório atual
      setDetectionState('provisional');
      const pct = Math.round(conf * 100);
      const { noteBr, qualityLabel } = formatKeyDisplay(cur.root, cur.quality as 'major' | 'minor');
      setStatusMessage(`Refinando: ${noteBr} ${qualityLabel} (${pct}%)`);
      return;
    }

    // ── CONFIRMED: mudança requer histerese forte ──────────────────────
    if (changeCount >= CHANGE_SUGGEST_FRAMES && changeCount < CHANGE_CONFIRM_FRAMES) {
      // Mostrar sugestão de mudança
      if (
        !changeSuggestionRef.current ||
        changeSuggestionRef.current.root !== result.root ||
        changeSuggestionRef.current.quality !== result.quality
      ) {
        const suggestion = { ...result };
        changeSuggestionRef.current = suggestion;
        setChangeSuggestion(suggestion);
      }
      setDetectionState('change_possible');
      setIsStable(false);
      const { noteBr, qualityLabel } = formatKeyDisplay(result.root, result.quality as 'major' | 'minor');
      setStatusMessage(`Possível mudança: ${noteBr} ${qualityLabel}... (${changeCount}/${CHANGE_CONFIRM_FRAMES})`);
      return;
    }

    if (changeCount >= CHANGE_CONFIRM_FRAMES && conf >= CHANGE_MIN_CONFIDENCE) {
      // ── MUDANÇA CONFIRMADA ────────────────────────────────────────
      currentKeyRef.current = { ...result };
      currentTierRef.current = 'confirmed';
      confirmRef.current = { root: result.root, quality: result.quality, count: 1 };
      changeRef.current = null;
      changeSuggestionRef.current = null;
      setCurrentKey({ ...result });
      setKeyTier('confirmed');
      setChangeSuggestion(null);
      setDetectionState('confirmed');
      setIsStable(false); // breve flash, próximo tick volta a true
      const { noteBr, qualityLabel } = formatKeyDisplay(result.root, result.quality as 'major' | 'minor');
      setStatusMessage(`Tom alterado para ${noteBr} ${qualityLabel}`);

      // Re-estabilizar após 1.5s
      setTimeout(() => {
        if (isRunningRef.current && currentKeyRef.current?.root === result.root) {
          setIsStable(true);
          setStatusMessage('Estável no tom atual');
        }
      }, 1500);
      return;
    }
  }, [buildHistogram]);

  // ── start ───────────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<boolean> => {
    if (isStartingRef.current) {
      console.warn('[KeyDetection][START] chamada duplicada ignorada');
      return false;
    }

    isStartingRef.current = true;

    try {
      setErrorMessage(null);
      setErrorReason(null);
      setSoftInfo(null);

      // Parar sessão anterior com AWAIT (protege contra "Recording in progress")
      if (isRunningRef.current) {
        isRunningRef.current = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        await engineRef.current?.stop();
      } else {
        await engineRef.current?.stop();
      }

      // Reset completo
      noteHistory.current = [];
      freqBuffer.current = [];
      currentKeyRef.current = null;
      currentTierRef.current = null;
      changeSuggestionRef.current = null;
      confirmRef.current = null;
      changeRef.current = null;
      lastPitchRef.current = null;
      noteDisplayRef.current = null;
      lastValidPitchAtRef.current = 0;
      silenceHintShownRef.current = false;
      sessionStartRef.current = Date.now();
      isRunningRef.current = true;
      setIsRunning(true);
      setDetectionState('listening');
      setCurrentKey(null);
      setKeyTier(null);
      setLiveConfidence(0);
      setChangeSuggestion(null);
      setCurrentNote(null);
      setRecentNotes([]);
      setIsStable(false);
      setStatusMessage('Ouvindo...');

      const eng = engineRef.current;
      const ok = await eng.start(onPitch, onEngineError);

      if (!ok) {
        isRunningRef.current = false;
        setIsRunning(false);
        setDetectionState('idle');
        return false;
      }

      intervalRef.current = setInterval(analyzeKey, ANALYZE_INTERVAL_MS);
      return true;
    } finally {
      isStartingRef.current = false;
    }
  }, [analyzeKey, onPitch, onEngineError]);

  // ── stop ───────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    engineRef.current?.stop().catch(() => {});
    noteHistory.current = [];
    freqBuffer.current = [];
    setDetectionState('idle');
    setCurrentNote(null);
    setRecentNotes([]);
    setIsStable(false);
    setStatusMessage('Pronto para detectar');
  }, []);

  const reset = useCallback(() => {
    stop();
    currentKeyRef.current = null;
    currentTierRef.current = null;
    changeSuggestionRef.current = null;
    setCurrentKey(null);
    setKeyTier(null);
    setLiveConfidence(0);
    setChangeSuggestion(null);
    setErrorMessage(null);
  }, [stop]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' && isRunningRef.current) stop();
    });
    return () => sub.remove();
  }, [stop]);

  useEffect(() => {
    return () => {
      isRunningRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      engineRef.current?.stop().catch(() => {});
    };
  }, []);

  return {
    detectionState,
    currentKey,
    keyTier,
    liveConfidence,
    changeSuggestion,
    currentNote,
    recentNotes,
    isStable,
    statusMessage,
    isRunning,
    isSupported,
    errorMessage,
    errorReason,
    softInfo,
    start,
    stop,
    reset,
  };
}
