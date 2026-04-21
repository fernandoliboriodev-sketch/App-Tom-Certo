/**
 * useKeyDetection v5 — DEFINITIVO: Phrase-Based Detector
 *
 * ════════════════════════════════════════════════════════════════════════
 * Abordagem: a tonalidade é determinada pela RESOLUÇÃO DAS FRASES,
 * não pela distribuição estatística das notas. Resolve a confusão
 * sistemática entre tom maior e seu relativo menor (ex: D Major ↔ F#m).
 *
 * Pipeline:
 *  1) Frame → pitch class (com filtro mediana + correção de oitava)
 *  2) Frames consecutivos → nota (agrupa run-length)
 *  3) Notas separadas por silêncio ≥ 300ms → frase
 *  4) Cada frase VOTA na tônica (cadência 5x, first 2x, longest 1.5x)
 *  5) Qualidade (maj/min) vem APÓS tônica estável, via 3ª grade
 *  6) Estabilidade: tally decai 15% por frase (recency > histórico)
 *
 * Estados (4):
 *  - listening: 0 frases
 *  - probable: 1 frase com cadência clara
 *  - confirmed: 2+ frases concordam
 *  - definitive: 3+ frases + qualidade clara
 * ════════════════════════════════════════════════════════════════════════
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
  SILENCE_END_PHRASE_MS,
  LEGATO_SUSTAINED_MS,
  MIN_NOTE_DUR_MS,
} from '../utils/phraseKeyDetector';
import { usePitchEngine } from '../audio/usePitchEngine';
import type { PitchEvent, PitchErrorReason } from '../audio/types';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';

// ─── Filtros de qualidade (calibrados pra voz cantada) ────────────
const MIN_RMS = 0.010;
const MIN_CLARITY = 0.55;
const MEDIAN_WINDOW = 5;       // filtro mediana sobre 5 frames consecutivos
const MIN_COMMIT_FRAMES = 4;   // precisa de 4 frames iguais pra commitar uma nota

// ─── Tipos legados para compatibilidade UI ────────────────────────
export type DetectionState =
  | 'idle'
  | 'listening'
  | 'analyzing'
  | 'provisional'
  | 'confirmed'
  | 'change_possible';

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
  // Novo: estado do detector por frases
  phraseStage: DetectionStage;
  phrasesAnalyzed: number;
  start: () => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

export function useKeyDetection(): UseKeyDetectionReturn {
  // ── Estado pública ────────────────────────────────────────────
  const [currentNote, setCurrentNote] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<PitchErrorReason | null>(null);
  const [softInfo, setSoftInfo] = useState<string | null>(null);
  const [keyState, setKeyState] = useState<KeyDetectionState>(createInitialState());

  // ── Engine de pitch ───────────────────────────────────────────
  const engine = usePitchEngine();

  // ── Refs para frame processing (evita re-render a cada frame) ─
  const startTimeRef = useRef<number>(0);                 // epoch quando start() foi chamado
  const medianBufferRef = useRef<number[]>([]);           // últimos 5 pitch classes
  const currentNotePcRef = useRef<number | null>(null);   // pitch class da nota atual
  const currentNoteStartRef = useRef<number>(0);          // quando começou a nota atual
  const currentNoteFramesRef = useRef<number>(0);         // quantos frames já acumulou
  const currentNoteRmsSumRef = useRef<number>(0);
  const currentNoteMidiSumRef = useRef<number>(0);
  const currentNoteCommittedRef = useRef<boolean>(false); // já entrou na frase?
  const lastFrameTimeRef = useRef<number>(0);             // último frame (com pitch válido)
  const lastSilenceStartRef = useRef<number | null>(null); // início do silêncio atual
  const phraseNotesRef = useRef<DetectedNoteEvent[]>([]); // notas acumulando na frase atual
  const phraseStartRef = useRef<number>(0);               // início da frase atual

  // ── Helpers ───────────────────────────────────────────────────
  const addRecentNote = useCallback((pc: number) => {
    setRecentNotes(prev => {
      if (prev[prev.length - 1] === pc) return prev; // não duplica consecutivas
      const next = [...prev, pc];
      return next.length > 5 ? next.slice(-5) : next;
    });
  }, []);

  // Commita a nota atual ao buffer de frase (se válida)
  const commitCurrentNoteToPhrase = useCallback((now: number) => {
    if (
      currentNotePcRef.current === null ||
      currentNoteCommittedRef.current ||
      currentNoteFramesRef.current < MIN_COMMIT_FRAMES
    ) return;

    const durMs = now - currentNoteStartRef.current;
    if (durMs < MIN_NOTE_DUR_MS) return;

    const rmsAvg = currentNoteRmsSumRef.current / currentNoteFramesRef.current;
    const midiAvg = currentNoteMidiSumRef.current / currentNoteFramesRef.current;
    const ev: DetectedNoteEvent = {
      pitchClass: currentNotePcRef.current,
      midi: Math.round(midiAvg),
      timestamp: currentNoteStartRef.current - startTimeRef.current,
      durMs,
      rmsAvg,
    };
    phraseNotesRef.current.push(ev);
    currentNoteCommittedRef.current = true;
  }, []);

  // Fecha frase atual → envia pro detector
  const closePhraseIfValid = useCallback((now: number) => {
    // Tenta commitar nota atual primeiro
    commitCurrentNoteToPhrase(now);

    if (phraseNotesRef.current.length === 0) return;

    const phrase = buildPhrase(phraseNotesRef.current);
    phraseNotesRef.current = [];

    if (phrase) {
      setKeyState(prev => ingestPhrase(prev, phrase));
    }
  }, [commitCurrentNoteToPhrase]);

  // ── Callback de pitch — chamado em cada frame de áudio ───────
  const onPitch = useCallback((ev: PitchEvent) => {
    const now = Date.now();

    // ── Audio level (para visualizer) ──
    setAudioLevel(Math.min(1, ev.rms * 8));

    // ── Checa se é silêncio (RMS baixo ou clarity ruim) ──
    const isVoiced = ev.rms >= MIN_RMS && ev.clarity >= MIN_CLARITY && ev.frequency > 60 && ev.frequency < 2000;

    if (!isVoiced) {
      // Marca início do silêncio se ainda não marcado
      if (lastSilenceStartRef.current === null) {
        lastSilenceStartRef.current = now;
      } else {
        const silenceDur = now - lastSilenceStartRef.current;
        if (silenceDur >= SILENCE_END_PHRASE_MS) {
          // Silêncio suficiente → fecha frase
          closePhraseIfValid(now);
          // Reset da nota atual
          currentNotePcRef.current = null;
          currentNoteFramesRef.current = 0;
          currentNoteCommittedRef.current = false;
          setCurrentNote(null);
        }
      }
      return;
    }

    // Tem voz: reset do silêncio
    lastSilenceStartRef.current = null;
    lastFrameTimeRef.current = now;

    // ── Pitch class do frame ──
    const midi = frequencyToMidi(ev.frequency);
    const rawPc = midiToPitchClass(midi);

    // ── Filtro mediana (remove pitch classes isoladas/anômalas) ──
    medianBufferRef.current.push(rawPc);
    if (medianBufferRef.current.length > MEDIAN_WINDOW) medianBufferRef.current.shift();
    const counts = new Array(12).fill(0);
    for (const pc of medianBufferRef.current) counts[pc]++;
    let smoothedPc: number = rawPc;
    let topCount = 0;
    for (let i = 0; i < 12; i++) {
      if (counts[i] > topCount) { topCount = counts[i]; smoothedPc = i; }
    }

    // ── Atualiza UI em tempo real ──
    setCurrentNote(smoothedPc);

    // ── Agrupa frames em "nota" (run-length com histerese) ──
    if (currentNotePcRef.current === smoothedPc) {
      // Mesma nota — extende duração
      currentNoteFramesRef.current++;
      currentNoteRmsSumRef.current += ev.rms;
      currentNoteMidiSumRef.current += midi;

      // ── Fallback legato: nota muito sustentada → fecha frase (se há ≥ 1 outra nota)
      const noteDur = now - currentNoteStartRef.current;
      if (
        noteDur >= LEGATO_SUSTAINED_MS &&
        !currentNoteCommittedRef.current &&
        phraseNotesRef.current.length >= 1
      ) {
        commitCurrentNoteToPhrase(now);
        closePhraseIfValid(now);
      }
    } else {
      // Nota nova: commita a anterior e inicia nova
      commitCurrentNoteToPhrase(now);
      if (currentNotePcRef.current !== null && currentNoteCommittedRef.current) {
        addRecentNote(currentNotePcRef.current);
      }
      currentNotePcRef.current = smoothedPc;
      currentNoteStartRef.current = now;
      currentNoteFramesRef.current = 1;
      currentNoteRmsSumRef.current = ev.rms;
      currentNoteMidiSumRef.current = midi;
      currentNoteCommittedRef.current = false;
      if (phraseStartRef.current === 0) phraseStartRef.current = now;
    }
  }, [addRecentNote, closePhraseIfValid, commitCurrentNoteToPhrase]);

  // ── Callback de erro do engine ────────────────────────────────
  const onError = useCallback((msg: string, reason: PitchErrorReason) => {
    setErrorMessage(msg);
    setErrorReason(reason);
    setIsRunning(false);
  }, []);

  // ── Soft info (do engine) ─────────────────────────────────────
  useEffect(() => {
    if (engine.setSoftInfoHandler) engine.setSoftInfoHandler(setSoftInfo);
  }, [engine]);

  // ── START ────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<boolean> => {
    if (isRunning) return true;
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
    setCurrentNote(null);
    setRecentNotes([]);
    setAudioLevel(0);
    setKeyState(createInitialState());
    // Reset refs
    startTimeRef.current = Date.now();
    medianBufferRef.current = [];
    currentNotePcRef.current = null;
    currentNoteFramesRef.current = 0;
    currentNoteCommittedRef.current = false;
    lastSilenceStartRef.current = null;
    phraseNotesRef.current = [];
    phraseStartRef.current = 0;

    const ok = await engine.start(onPitch, onError);
    if (ok) setIsRunning(true);
    return ok;
  }, [engine, isRunning, onError, onPitch]);

  // ── STOP ─────────────────────────────────────────────────────
  const stop = useCallback(() => {
    engine.stop().catch(() => {});
    setIsRunning(false);
    setCurrentNote(null);
    setAudioLevel(0);
  }, [engine]);

  // ── RESET ────────────────────────────────────────────────────
  const reset = useCallback(() => {
    stop();
    setKeyState(createInitialState());
    setRecentNotes([]);
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
  }, [stop]);

  // ── App state: para gravação quando app vai pra background ───
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' && isRunning) {
        stop();
      }
    });
    return () => sub.remove();
  }, [isRunning, stop]);

  // ── Watchdog: se não há frames há > 5s, força fechar frase ──
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      const now = Date.now();
      if (lastFrameTimeRef.current > 0 && now - lastFrameTimeRef.current > 5000) {
        closePhraseIfValid(now);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [isRunning, closePhraseIfValid]);

  // ── Mapeamento do estado interno pra API compatível com UI ───
  const detectionState: DetectionState = (() => {
    if (!isRunning) return 'idle';
    switch (keyState.stage) {
      case 'listening': return 'listening';
      case 'probable': return 'provisional';
      case 'confirmed': return 'provisional'; // Confirmed ainda mostra como "refinando"
      case 'definitive': return 'confirmed';
    }
  })();

  const keyTier: KeyTier = (() => {
    if (keyState.stage === 'listening') return null;
    if (keyState.stage === 'definitive') return 'confirmed';
    if (keyState.stage === 'confirmed') return 'confirmed'; // mostra confirmed em stage confirmed/definitive
    return 'provisional';
  })();

  const currentKey: KeyResult | null =
    keyState.currentTonicPc !== null && keyState.quality
      ? {
          root: keyState.currentTonicPc,
          quality: keyState.quality,
          confidence: keyState.tonicConfidence,
        }
      : null;

  const statusMessage: string = (() => {
    if (!isRunning) return 'Pronto para detectar';
    if (keyState.stage === 'listening') return 'Escutando...';
    if (keyState.stage === 'probable') return 'Tônica provável';
    if (keyState.stage === 'confirmed') return 'Tônica confirmada — definindo modo';
    return 'Tom definitivo';
  })();

  const isStable = keyState.stage === 'definitive';

  return {
    detectionState,
    currentKey,
    keyTier,
    liveConfidence: keyState.tonicConfidence,
    changeSuggestion: null, // Não usado no novo modelo (contradição reduz confiança em vez de sugerir mudança)
    currentNote,
    recentNotes,
    audioLevel,
    isStable,
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
