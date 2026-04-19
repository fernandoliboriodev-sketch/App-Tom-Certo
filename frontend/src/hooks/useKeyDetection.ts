import { useRef, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { detectKeyFromHistogram, KeyResult } from '../utils/keyDetector';
import { createPitchEngine, PitchEngine, PitchEvent, PitchErrorReason } from '../audio/pitchEngine';

const HISTORY_MS = 6000;
const ANALYZE_INTERVAL_MS = 500;
const WARMUP_MIN_MS = 3500;
const WARMUP_MIN_UNIQUE = 4;
const WARMUP_CONFIDENCE = 0.58;
const INITIAL_CONFIRM_FRAMES = 3;
const ONGOING_CONFIDENCE = 0.42;
const HYSTERESIS_FRAMES = 7;
const NOTE_DISPLAY_HOLD_MS = 220;
const NOTE_DEDUPE_WINDOW_MS = 120;

interface NoteEvent {
  pitchClass: number;
  timestamp: number;
  rms: number;
}

export type DetectionState =
  | 'idle'
  | 'listening'
  | 'analyzing'
  | 'detected'
  | 'stable';

export interface UseKeyDetectionReturn {
  detectionState: DetectionState;
  currentKey: KeyResult | null;
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

export function useKeyDetection(): UseKeyDetectionReturn {
  const [detectionState, setDetectionState] = useState<DetectionState>('idle');
  const [currentKey, setCurrentKey] = useState<KeyResult | null>(null);
  const [currentNote, setCurrentNote] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [isStable, setIsStable] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Pronto para detectar');
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<PitchErrorReason | null>(null);
  const [softInfo, setSoftInfo] = useState<string | null>(null);

  const noteHistory = useRef<NoteEvent[]>([]);
  const currentKeyRef = useRef<KeyResult | null>(null);
  const hysteresisRef = useRef<{ root: number; quality: string; count: number } | null>(null);
  const initialConfirmRef = useRef<{ root: number; quality: string; count: number } | null>(null);
  const sessionStartRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);
  const lastPitchRef = useRef<{ pc: number; ts: number } | null>(null);
  const noteDisplayRef = useRef<{ pc: number; setAt: number } | null>(null);
  const engineRef = useRef<PitchEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createPitchEngine();
    engineRef.current.onSoftInfo = (msg: string) => setSoftInfo(msg);
  }

  const isSupported = engineRef.current.isSupported;

  const onPitch = useCallback((e: PitchEvent) => {
    if (!isRunningRef.current) return;
    const now = Date.now();
    const last = lastPitchRef.current;

    if (last && last.pc === e.pitchClass && now - last.ts < NOTE_DEDUPE_WINDOW_MS) {
      noteHistory.current.push({ pitchClass: e.pitchClass, timestamp: now, rms: e.rms });
      noteDisplayRef.current = { pc: e.pitchClass, setAt: now };
      setCurrentNote(e.pitchClass);
      return;
    }
    lastPitchRef.current = { pc: e.pitchClass, ts: now };
    noteHistory.current.push({ pitchClass: e.pitchClass, timestamp: now, rms: e.rms });

    const disp = noteDisplayRef.current;
    if (!disp || now - disp.setAt >= NOTE_DISPLAY_HOLD_MS) {
      noteDisplayRef.current = { pc: e.pitchClass, setAt: now };
      setCurrentNote(e.pitchClass);
    }

    const all = noteHistory.current.slice(-40).map(n => n.pitchClass);
    const deduped: number[] = [];
    for (const pc of all) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== pc) deduped.push(pc);
    }
    setRecentNotes(deduped.slice(-6));
  }, []);

  const onEngineError = useCallback((msg: string, reason?: PitchErrorReason) => {
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

  const analyzeKey = useCallback(() => {
    if (!isRunningRef.current) return;
    const now = Date.now();
    noteHistory.current = noteHistory.current.filter(
      n => n.timestamp >= now - HISTORY_MS
    );

    const history = noteHistory.current;
    const elapsed = now - sessionStartRef.current;
    const uniqueNotes = new Set(history.map(h => h.pitchClass)).size;
    const hasKey = !!currentKeyRef.current;

    if (!hasKey) {
      if (history.length < 3) {
        setDetectionState('listening');
        setStatusMessage('Ouvindo...');
        return;
      }
      if (elapsed < WARMUP_MIN_MS || uniqueNotes < WARMUP_MIN_UNIQUE) {
        setDetectionState('analyzing');
        setStatusMessage('Analisando tonalidade...');
        return;
      }
    }

    const histogram = new Array(12).fill(0);
    for (const note of history) {
      const age = (now - note.timestamp) / HISTORY_MS;
      const decay = Math.exp(-2.5 * age);
      histogram[note.pitchClass] += note.rms * decay;
    }

    const result = detectKeyFromHistogram(histogram);
    const minConf = hasKey ? ONGOING_CONFIDENCE : WARMUP_CONFIDENCE;

    if (result.confidence < minConf) {
      if (!hasKey) {
        setDetectionState('analyzing');
        setStatusMessage('Analisando tonalidade...');
      }
      return;
    }

    const cur = currentKeyRef.current;
    const isSameKey = cur && cur.root === result.root && cur.quality === result.quality;

    if (!cur) {
      const ic = initialConfirmRef.current;
      if (!ic || ic.root !== result.root || ic.quality !== result.quality) {
        initialConfirmRef.current = {
          root: result.root,
          quality: result.quality,
          count: 1,
        };
        setDetectionState('analyzing');
        setStatusMessage('Analisando tonalidade...');
        return;
      }
      ic.count++;
      if (ic.count < INITIAL_CONFIRM_FRAMES) {
        setDetectionState('analyzing');
        setStatusMessage('Analisando tonalidade...');
        return;
      }
      currentKeyRef.current = result;
      initialConfirmRef.current = null;
      setCurrentKey(result);
      setDetectionState('detected');
      setIsStable(false);
      setStatusMessage('Tom detectado');
      setTimeout(() => {
        if (isRunningRef.current && currentKeyRef.current) {
          setDetectionState('stable');
          setIsStable(true);
          setStatusMessage('Estável no tom atual');
        }
      }, 1600);
      return;
    }

    if (isSameKey) {
      hysteresisRef.current = null;
      currentKeyRef.current = result;
      setCurrentKey(result);
      setDetectionState('stable');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    const hys = hysteresisRef.current;
    if (!hys || hys.root !== result.root || hys.quality !== result.quality) {
      hysteresisRef.current = { root: result.root, quality: result.quality, count: 1 };
      setIsStable(false);
      setStatusMessage('Analisando possível mudança tonal');
      return;
    }
    hys.count++;
    if (hys.count >= HYSTERESIS_FRAMES) {
      currentKeyRef.current = result;
      hysteresisRef.current = null;
      setCurrentKey(result);
      setDetectionState('detected');
      setIsStable(false);
      setStatusMessage('Novo tom detectado');
      setTimeout(() => {
        if (isRunningRef.current) {
          setDetectionState('stable');
          setIsStable(true);
          setStatusMessage('Estável no tom atual');
        }
      }, 1500);
    } else {
      setStatusMessage('Analisando possível mudança tonal');
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
    noteHistory.current = [];
    currentKeyRef.current = null;
    hysteresisRef.current = null;
    initialConfirmRef.current = null;
    lastPitchRef.current = null;
    noteDisplayRef.current = null;
    sessionStartRef.current = Date.now();
    isRunningRef.current = true;

    setIsRunning(true);
    setDetectionState('listening');
    setCurrentKey(null);
    setCurrentNote(null);
    setRecentNotes([]);
    setIsStable(false);
    setStatusMessage('Ouvindo...');

    const engine = engineRef.current!;
    const ok = await engine.start(onPitch, onEngineError);
    if (!ok) {
      isRunningRef.current = false;
      setIsRunning(false);
      setDetectionState('idle');
      return false;
    }

    intervalRef.current = setInterval(analyzeKey, ANALYZE_INTERVAL_MS);
    return true;
  }, [analyzeKey, onPitch, onEngineError]);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    engineRef.current?.stop();
    noteHistory.current = [];
    setDetectionState('idle');
    setCurrentNote(null);
    setRecentNotes([]);
    setIsStable(false);
    setStatusMessage('Pronto para detectar');
  }, []);

  const reset = useCallback(() => {
    stop();
    currentKeyRef.current = null;
    setCurrentKey(null);
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
      engineRef.current?.stop();
    };
  }, []);

  return {
    detectionState,
    currentKey,
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
