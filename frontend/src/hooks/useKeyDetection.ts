/**
 * useKeyDetection v5.1 — Phrase-Based Detector (robusto)
 *
 * CORREÇÃO v5.1: não depende de "silêncio real" (RMS baixo). Usa "ausência
 * de voz" (frame sem pitch válido) como silêncio — funciona mesmo em ambiente
 * ruidoso. Adiciona múltiplos gatilhos pra fechar frase:
 *   1) Ausência de voz ≥ 250ms (pausa natural)
 *   2) Nota sustentada ≥ 1200ms após ≥ 2 notas distintas (fim de legato)
 *   3) Frase com 4+ notas e duração ≥ 3s (frase longa)
 *   4) Timeout de 8s sem fechar frase (safety net)
 *
 * Também afrouxa filtros pra capturar mais notas da voz real.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  createInitialState,
  buildPhrase,
  ingestPhrase,
  KeyDetectionState,
  DetectedNoteEvent,
  DetectionStage,
} from '../utils/phraseKeyDetector';
import { usePitchEngine } from '../audio/usePitchEngine';
import type { PitchEvent, PitchErrorReason } from '../audio/types';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';

// ─── Filtros de frame (afrouxados pra voz real) ───────────────
const MIN_RMS = 0.008;             // ↓ era 0.010
const MIN_CLARITY = 0.50;          // ↓ era 0.55
const MEDIAN_WINDOW = 3;           // ↓ era 5 (menos smoothing, mais responsivo)

// ─── Commit de nota ──────────────────────────────────────────
const MIN_COMMIT_FRAMES = 2;       // ↓ era 4 (~46ms — ainda filtra ruído)
const MIN_NOTE_DUR_MS_LOCAL = 80;  // ↓ era 120 — notas curtas contam

// ─── Fechamento de frase (múltiplos gatilhos) ────────────────
const VOICED_GAP_MS = 250;         // ausência de voz ≥ 250ms = fim de frase
const LEGATO_SUSTAIN_MS = 1200;    // nota mantida ≥ 1.2s (após 2+ notas) = fim
const LONG_PHRASE_NOTES = 5;       // ≥ 5 notas distintas
const LONG_PHRASE_DUR_MS = 3000;   // e dur ≥ 3s = fim
const SAFETY_TIMEOUT_MS = 8000;    // safety net: 8s sem fechar → força fim

// ─── Tipos de compatibilidade ────────────────────────────────
export type DetectionState =
  | 'idle' | 'listening' | 'analyzing'
  | 'provisional' | 'confirmed' | 'change_possible';
export type KeyTier = 'provisional' | 'confirmed' | null;

export interface KeyResult {
  root: number;
  quality: 'major' | 'minor';
  confidence?: number;
}

export interface UseKeyDetectionReturn {
  detectionState: DetectionState;
  currentKey: KeyResult | null;
  keyTier: KeyTier;
  liveConfidence: number;
  changeSuggestion: KeyResult | null;
  currentNote: number | null;
  recentNotes: number[];
  audioLevel: number;
  isStable: boolean;
  statusMessage: string;
  isRunning: boolean;
  isSupported: boolean;
  errorMessage: string | null;
  errorReason: PitchErrorReason | null;
  softInfo: string | null;
  phraseStage: DetectionStage;
  phrasesAnalyzed: number;
  start: () => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

export function useKeyDetection(): UseKeyDetectionReturn {
  const [currentNote, setCurrentNote] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<PitchErrorReason | null>(null);
  const [softInfo, setSoftInfo] = useState<string | null>(null);
  const [keyState, setKeyState] = useState<KeyDetectionState>(createInitialState());

  const engine = usePitchEngine();

  // ── Refs de processamento ────────────────────────────────
  const startTimeRef = useRef<number>(0);
  const medianBufRef = useRef<number[]>([]);
  const lastStableMidiRef = useRef<number | null>(null); // ← para correção de oitava
  const curPcRef = useRef<number | null>(null);
  const curStartRef = useRef<number>(0);
  const curFramesRef = useRef<number>(0);
  const curRmsSumRef = useRef<number>(0);
  const curMidiSumRef = useRef<number>(0);
  const curCommittedRef = useRef<boolean>(false);
  const lastVoicedTimeRef = useRef<number>(0);
  const phraseNotesRef = useRef<DetectedNoteEvent[]>([]);
  const phraseStartTimeRef = useRef<number>(0);

  // ── Helpers ──────────────────────────────────────────────
  const addRecentNote = useCallback((pc: number) => {
    setRecentNotes(prev => {
      if (prev[prev.length - 1] === pc) return prev;
      const next = [...prev, pc];
      return next.length > 6 ? next.slice(-6) : next;
    });
  }, []);

  // Commita a nota em curso no buffer da frase
  const commitCurNote = useCallback((now: number): boolean => {
    if (
      curPcRef.current === null ||
      curCommittedRef.current ||
      curFramesRef.current < MIN_COMMIT_FRAMES
    ) return false;

    const durMs = now - curStartRef.current;
    if (durMs < MIN_NOTE_DUR_MS_LOCAL) return false;

    const rmsAvg = curRmsSumRef.current / curFramesRef.current;
    const midiAvg = curMidiSumRef.current / curFramesRef.current;
    phraseNotesRef.current.push({
      pitchClass: curPcRef.current,
      midi: Math.round(midiAvg),
      timestamp: curStartRef.current - startTimeRef.current,
      durMs,
      rmsAvg,
    });
    curCommittedRef.current = true;
    return true;
  }, []);

  // Fecha frase e envia pra o detector
  const closePhrase = useCallback((now: number, reason: string) => {
    commitCurNote(now);
    if (phraseNotesRef.current.length === 0) return;

    const notes = phraseNotesRef.current;
    phraseNotesRef.current = [];
    phraseStartTimeRef.current = 0;

    const phrase = buildPhrase(notes);
    if (phrase) {
      setSoftInfo(`Frase capturada (${reason}): ${notes.length} notas`);
      setKeyState(prev => ingestPhrase(prev, phrase));
    } else {
      setSoftInfo(`Frase descartada (${reason}): apenas ${notes.length} notas curtas`);
    }
  }, [commitCurNote]);

  // ── Callback de pitch ────────────────────────────────────
  const onPitch = useCallback((ev: PitchEvent) => {
    const now = Date.now();
    setAudioLevel(Math.min(1, ev.rms * 8));

    const isVoiced =
      ev.rms >= MIN_RMS &&
      ev.clarity >= MIN_CLARITY &&
      ev.frequency >= 65 &&
      ev.frequency <= 2000;

    if (!isVoiced) {
      // Sem voz detectada
      if (lastVoicedTimeRef.current > 0) {
        const gap = now - lastVoicedTimeRef.current;
        if (gap >= VOICED_GAP_MS) {
          // Fim de frase por pausa
          closePhrase(now, 'pausa');
          curPcRef.current = null;
          curFramesRef.current = 0;
          curCommittedRef.current = false;
          setCurrentNote(null);
          lastVoicedTimeRef.current = 0;
        }
      }
      return;
    }

    lastVoicedTimeRef.current = now;

    // Pitch class do frame
    let midi = frequencyToMidi(ev.frequency);

    // ── CORREÇÃO DE OITAVA (YIN frequentemente reporta ±12 em erro) ──
    // Se o novo MIDI diferir +12 ou -12 do último estável, assume erro de oitava
    // e usa a oitava estável (mantém pitch class, corrige posicionamento).
    if (lastStableMidiRef.current !== null) {
      const diff = midi - lastStableMidiRef.current;
      if (diff >= 10 && diff <= 14) {
        // Subiu ~1 oitava: provavelmente erro, volta uma oitava
        midi -= 12;
      } else if (diff <= -10 && diff >= -14) {
        // Desceu ~1 oitava: provavelmente erro, sobe uma oitava
        midi += 12;
      }
    }

    const rawPc = midiToPitchClass(midi);

    // ── Filtro mediana (3 frames) ──
    medianBufRef.current.push(rawPc);
    if (medianBufRef.current.length > MEDIAN_WINDOW) medianBufRef.current.shift();
    const counts = new Array(12).fill(0);
    for (const pc of medianBufRef.current) counts[pc]++;
    let pc: number = rawPc;
    let top = 0;
    for (let i = 0; i < 12; i++) if (counts[i] > top) { top = counts[i]; pc = i; }

    // Atualiza MIDI "estável" após pitch class estabilizar (usado pra oitava)
    if (counts[pc] >= MEDIAN_WINDOW) {
      lastStableMidiRef.current = midi;
    }

    setCurrentNote(pc);

    if (curPcRef.current === pc) {
      curFramesRef.current++;
      curRmsSumRef.current += ev.rms;
      curMidiSumRef.current += midi;

      // Gatilho 2: nota muito sustentada (legato) após ≥ 2 notas
      const dur = now - curStartRef.current;
      if (
        dur >= LEGATO_SUSTAIN_MS &&
        !curCommittedRef.current &&
        phraseNotesRef.current.length >= 2
      ) {
        closePhrase(now, 'legato');
      }
    } else {
      // Nota nova
      if (commitCurNote(now) && curPcRef.current !== null) {
        addRecentNote(curPcRef.current);
      }
      curPcRef.current = pc;
      curStartRef.current = now;
      curFramesRef.current = 1;
      curRmsSumRef.current = ev.rms;
      curMidiSumRef.current = midi;
      curCommittedRef.current = false;
      if (phraseStartTimeRef.current === 0) phraseStartTimeRef.current = now;

      // Gatilho 3: frase longa (5+ notas + 3s)
      const phraseDur = now - phraseStartTimeRef.current;
      if (
        phraseNotesRef.current.length >= LONG_PHRASE_NOTES - 1 &&
        phraseDur >= LONG_PHRASE_DUR_MS
      ) {
        closePhrase(now, 'frase longa');
      }
    }
  }, [addRecentNote, commitCurNote, closePhrase]);

  const onError = useCallback((msg: string, reason: PitchErrorReason) => {
    setErrorMessage(msg);
    setErrorReason(reason);
    setIsRunning(false);
  }, []);

  useEffect(() => {
    if (engine.setSoftInfoHandler) engine.setSoftInfoHandler(setSoftInfo);
  }, [engine]);

  const start = useCallback(async (): Promise<boolean> => {
    if (isRunning) return true;
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
    setCurrentNote(null);
    setRecentNotes([]);
    setAudioLevel(0);
    setKeyState(createInitialState());
    startTimeRef.current = Date.now();
    medianBufRef.current = [];
    lastStableMidiRef.current = null;
    curPcRef.current = null;
    curFramesRef.current = 0;
    curCommittedRef.current = false;
    lastVoicedTimeRef.current = 0;
    phraseNotesRef.current = [];
    phraseStartTimeRef.current = 0;
    const ok = await engine.start(onPitch, onError);
    if (ok) setIsRunning(true);
    return ok;
  }, [engine, isRunning, onError, onPitch]);

  const stop = useCallback(() => {
    engine.stop().catch(() => {});
    setIsRunning(false);
    setCurrentNote(null);
    setAudioLevel(0);
  }, [engine]);

  const reset = useCallback(() => {
    stop();
    setKeyState(createInitialState());
    setRecentNotes([]);
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
  }, [stop]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' && isRunning) stop();
    });
    return () => sub.remove();
  }, [isRunning, stop]);

  // ── Watchdog: safety timeout + detecção passiva de pausa ──
  // Usa setInterval pra garantir que frases longas sem mudança de nota
  // ainda assim fechem (mesmo se não chegarem frames não-voiced).
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      const now = Date.now();
      // Safety timeout: frase aberta há muito tempo
      if (phraseStartTimeRef.current > 0 && now - phraseStartTimeRef.current > SAFETY_TIMEOUT_MS) {
        if (phraseNotesRef.current.length >= 2) {
          closePhrase(now, 'timeout');
        }
      }
      // Gap de voz passivo: se último frame voiced foi há ≥ VOICED_GAP_MS
      // e temos notas acumuladas, fecha
      if (
        lastVoicedTimeRef.current > 0 &&
        now - lastVoicedTimeRef.current >= VOICED_GAP_MS &&
        phraseNotesRef.current.length >= 2
      ) {
        closePhrase(now, 'pausa-passiva');
        lastVoicedTimeRef.current = 0;
      }
    }, 200);
    return () => clearInterval(t);
  }, [isRunning, closePhrase]);

  // ── Mapping pra API compatível ───────────────────────────
  const detectionState: DetectionState = (() => {
    if (!isRunning) return 'idle';
    switch (keyState.stage) {
      case 'listening': return 'listening';
      case 'probable': return 'provisional';
      case 'confirmed': return 'provisional';
      case 'definitive': return 'confirmed';
    }
  })();

  const keyTier: KeyTier =
    keyState.stage === 'listening' ? null :
    keyState.stage === 'definitive' ? 'confirmed' :
    keyState.stage === 'confirmed' ? 'confirmed' : 'provisional';

  const currentKey: KeyResult | null =
    keyState.currentTonicPc !== null && keyState.quality
      ? { root: keyState.currentTonicPc, quality: keyState.quality, confidence: keyState.tonicConfidence }
      : null;

  const statusMessage: string = (() => {
    if (!isRunning) return 'Pronto para detectar';
    if (keyState.stage === 'listening') return 'Escutando...';
    if (keyState.stage === 'probable') return 'Tônica provável';
    if (keyState.stage === 'confirmed') return 'Tônica confirmada';
    return 'Tom definitivo';
  })();

  return {
    detectionState,
    currentKey,
    keyTier,
    liveConfidence: keyState.tonicConfidence,
    changeSuggestion: null,
    currentNote,
    recentNotes,
    audioLevel,
    isStable: keyState.stage === 'definitive',
    statusMessage,
    isRunning,
    isSupported: engine.isSupported,
    errorMessage,
    errorReason,
    softInfo,
    phraseStage: keyState.stage,
    phrasesAnalyzed: keyState.phrases.length,
    start,
    stop,
    reset,
  };
}
