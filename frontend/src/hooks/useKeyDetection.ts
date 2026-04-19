import { useRef, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { detectKeyFromHistogram, KeyResult } from '../utils/keyDetector';
import { createPitchEngine, PitchEngine, PitchEvent, PitchErrorReason } from '../audio/pitchEngine';
import { frequencyToMidi, midiToPitchClass, formatKeyDisplay } from '../utils/noteUtils';

// ─── Algorithm constants ──────────────────────────────────────────────────────
// Philosophy: accuracy over speed. A correct key after 10s beats a wrong key after 3s.

const HISTORY_MS = 15000;          // 15s sliding window for rich harmonic context
const ANALYZE_INTERVAL_MS = 400;   // Analyze every 400ms

// ── Layer 1: Pitch smoothing (fixes G ↔ G# oscillation) ─────────────────────
// Collect last N raw frequencies, use their MEDIAN before mapping to pitch class.
// This prevents a singer who is slightly sharp/flat from toggling between neighbors.
const FREQ_SMOOTH_WINDOW = 9;

// ── Layer 2: Sample quality gate ─────────────────────────────────────────────
// Reject samples that are too quiet (background noise) or have poor pitch clarity.
const MIN_RMS = 0.018;             // Silence / breath noise threshold
const MIN_CLARITY = 0.87;          // YIN probability must be high (0.85 default, we raise it)

// ── Layer 3: Warmup phases ───────────────────────────────────────────────────
const MIN_QUALITY_SAMPLES = 28;    // "Ouvindo..." until this many quality samples collected
const WARMUP_MIN_MS = 6000;        // Minimum 6s before any key can be shown
const WARMUP_MIN_UNIQUE = 6;       // Need 6+ distinct pitch classes represented

// ── Layer 4: First detection (conservative) ──────────────────────────────────
const FIRST_CONFIDENCE = 0.80;     // Pearson correlation must be ≥ 0.80 for first key
const CONFIRM_FRAMES = 10;         // Must see same key for 10 consecutive frames (~4s)

// ── Layer 5: Ongoing key maintenance ─────────────────────────────────────────
const ONGOING_CONFIDENCE = 0.54;   // Easier bar to MAINTAIN an existing key
const HISTOGRAM_DECAY = 2.0;       // Slower decay → more stable (was 3.0, higher=more recency bias)

// ── Layer 6: Key change hysteresis (streak-based) ────────────────────────────
// Counter RESETS if any single analysis frame reverts to old key or different candidate.
const CHANGE_MIN_FRAMES = 16;      // Need 16 CONSECUTIVE frames (~6.4s) for a key switch

// ── Display ───────────────────────────────────────────────────────────────────
const NOTE_DISPLAY_HOLD_MS = 400;
const NOTE_DEDUPE_WINDOW_MS = 100;

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Hook ─────────────────────────────────────────────────────────────────────
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

  // Internal refs (never cause re-renders)
  const noteHistory = useRef<NoteEvent[]>([]);
  const freqBuffer = useRef<number[]>([]);         // For frequency smoothing
  const currentKeyRef = useRef<KeyResult | null>(null);
  const hysteresisRef = useRef<{ root: number; quality: string; count: number } | null>(null);
  const confirmRef = useRef<{ root: number; quality: string; count: number } | null>(null);
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

  // ── onPitch: Layer 1+2 — quality gate + frequency smoothing ────────────────
  const onPitch = useCallback((e: PitchEvent) => {
    if (!isRunningRef.current) return;

    // Layer 2: Quality gate — reject silence and unclear pitches
    if (e.rms < MIN_RMS || e.clarity < MIN_CLARITY) return;

    const now = Date.now();

    // Layer 1: Frequency smoothing via median filter
    // Prevents G4 ↔ G#4 oscillation when singer is slightly off-pitch
    freqBuffer.current.push(e.frequency);
    if (freqBuffer.current.length > FREQ_SMOOTH_WINDOW) {
      freqBuffer.current.shift();
    }
    const sortedFreqs = [...freqBuffer.current].sort((a, b) => a - b);
    const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
    const pc = midiToPitchClass(frequencyToMidi(medianFreq));

    // Deduplicate: don't log the same pitch class in rapid succession
    const last = lastPitchRef.current;
    if (last && last.pc === pc && now - last.ts < NOTE_DEDUPE_WINDOW_MS) {
      // Same pitch in rapid succession — still add to history for density but skip display update
      noteHistory.current.push({ pitchClass: pc, timestamp: now, rms: e.rms });
      return;
    }
    lastPitchRef.current = { pc, ts: now };
    noteHistory.current.push({ pitchClass: pc, timestamp: now, rms: e.rms });

    // Update current note display with hold
    const disp = noteDisplayRef.current;
    if (!disp || now - disp.setAt >= NOTE_DISPLAY_HOLD_MS) {
      noteDisplayRef.current = { pc, setAt: now };
      setCurrentNote(pc);
    }

    // Update recent notes (deduped run for visual display)
    const all = noteHistory.current.slice(-50).map(n => n.pitchClass);
    const deduped: number[] = [];
    for (const p of all) {
      if (deduped.length === 0 || deduped[deduped.length - 1] !== p) deduped.push(p);
    }
    setRecentNotes(deduped.slice(-6));
  }, []);

  // ── onEngineError ───────────────────────────────────────────────────────────
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

  // ── analyzeKey: Layers 3-6 ─────────────────────────────────────────────────
  const analyzeKey = useCallback(() => {
    if (!isRunningRef.current) return;
    const now = Date.now();

    // Prune old samples outside the sliding window
    noteHistory.current = noteHistory.current.filter(n => n.timestamp >= now - HISTORY_MS);

    const history = noteHistory.current;
    const elapsed = now - sessionStartRef.current;
    const uniqueNotes = new Set(history.map(h => h.pitchClass)).size;
    const hasKey = !!currentKeyRef.current;

    // ── Phase 1: Warmup — not enough quality samples yet ──────────────────────
    if (!hasKey && history.length < MIN_QUALITY_SAMPLES) {
      setDetectionState('listening');
      setStatusMessage('Ouvindo...');
      return;
    }

    // ── Phase 2: Need more time or more pitch variety ─────────────────────────
    if (!hasKey && (elapsed < WARMUP_MIN_MS || uniqueNotes < WARMUP_MIN_UNIQUE)) {
      setDetectionState('analyzing');
      setStatusMessage('Analisando tonalidade...');
      return;
    }

    // ── Build weighted histogram ────────────────────────────────────────────────
    // Each sample contributes: rms × recency_decay × consistency_bonus
    // Slower decay (HISTOGRAM_DECAY=2.0) = more stability over time
    const rawCounts = new Array(12).fill(0);
    const histogram = new Array(12).fill(0);
    for (const note of history) {
      const age = (now - note.timestamp) / HISTORY_MS;
      const decay = Math.exp(-HISTOGRAM_DECAY * age);
      histogram[note.pitchClass] += note.rms * decay;
      rawCounts[note.pitchClass]++;
    }
    // Consistency bonus: pitch classes appearing in many samples get amplified.
    // This suppresses passing tones and noise while boosting structural scale notes.
    const totalSamples = history.length || 1;
    for (let i = 0; i < 12; i++) {
      const freq = rawCounts[i] / totalSamples;
      histogram[i] *= (1.0 + freq * 4.0); // Increased from 3.0 for stronger filtering
    }

    const result = detectKeyFromHistogram(histogram);
    const minConf = hasKey ? ONGOING_CONFIDENCE : FIRST_CONFIDENCE;

    // ── Phase 3: Have data, waiting for confidence ────────────────────────────
    if (result.confidence < minConf) {
      if (!hasKey) {
        // Reset confirmation streak — low confidence means we're not sure yet
        confirmRef.current = null;
        setDetectionState('analyzing');
        setStatusMessage('Refinando análise...');
      }
      return;
    }

    const cur = currentKeyRef.current;
    const isSameKey = cur && cur.root === result.root && cur.quality === result.quality;

    // ── No key yet: confirm streak ─────────────────────────────────────────────
    if (!cur) {
      const ic = confirmRef.current;
      if (!ic || ic.root !== result.root || ic.quality !== result.quality) {
        // New candidate — start streak from 1
        confirmRef.current = { root: result.root, quality: result.quality, count: 1 };
        setDetectionState('analyzing');
        setStatusMessage('Refinando análise...');
        return;
      }
      ic.count++;
      if (ic.count < CONFIRM_FRAMES) {
        // Keep streaming — show progress every 2 frames
        setDetectionState('analyzing');
        if (ic.count % 2 === 0) {
          const { noteBr, qualityLabel } = formatKeyDisplay(
            ic.root, ic.quality as 'major' | 'minor'
          );
          setStatusMessage(`Confirmando: ${noteBr} ${qualityLabel}...`);
        }
        return;
      }

      // ✅ Key confirmed after CONFIRM_FRAMES of consistent high-confidence detection
      currentKeyRef.current = result;
      confirmRef.current = null;
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
      }, 1800);
      return;
    }

    // ── Already have a key: check if it's still the same ──────────────────────
    if (isSameKey) {
      // Clear any pending key-change candidate
      hysteresisRef.current = null;
      currentKeyRef.current = result;
      setCurrentKey(result);
      setDetectionState('stable');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    // ── Different key detected: streak-based hysteresis ───────────────────────
    // The streak RESETS if any frame reverts to the current key or a third key.
    const hys = hysteresisRef.current;
    if (!hys || hys.root !== result.root || hys.quality !== result.quality) {
      // New key candidate — start (or restart) streak from 1
      hysteresisRef.current = { root: result.root, quality: result.quality, count: 1 };
      setIsStable(false);
      const { noteBr, qualityLabel } = formatKeyDisplay(
        result.root, result.quality as 'major' | 'minor'
      );
      setStatusMessage(`Possível mudança: ${noteBr} ${qualityLabel}...`);
      return;
    }

    // Streak continues for same candidate
    hys.count++;
    const { noteBr, qualityLabel } = formatKeyDisplay(
      hys.root, hys.quality as 'major' | 'minor'
    );

    if (hys.count >= CHANGE_MIN_FRAMES) {
      // ✅ Key change confirmed after CHANGE_MIN_FRAMES consecutive frames
      currentKeyRef.current = result;
      hysteresisRef.current = null;
      setCurrentKey(result);
      setDetectionState('detected');
      setIsStable(false);
      setStatusMessage(`Novo tom: ${noteBr} ${qualityLabel}`);
      setTimeout(() => {
        if (isRunningRef.current) {
          setDetectionState('stable');
          setIsStable(true);
          setStatusMessage('Estável no tom atual');
        }
      }, 1800);
    } else {
      // Show which key we're detecting and how far into the streak we are
      setStatusMessage(`Possível mudança: ${noteBr} ${qualityLabel}...`);
    }
  }, []);

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<boolean> => {
    setErrorMessage(null);
    setErrorReason(null);
    setSoftInfo(null);
    noteHistory.current = [];
    freqBuffer.current = [];
    currentKeyRef.current = null;
    hysteresisRef.current = null;
    confirmRef.current = null;
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

  // ── stop ───────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    engineRef.current?.stop();
    noteHistory.current = [];
    freqBuffer.current = [];
    setDetectionState('idle');
    setCurrentNote(null);
    setRecentNotes([]);
    setIsStable(false);
    setStatusMessage('Pronto para detectar');
  }, []);

  // ── reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    stop();
    currentKeyRef.current = null;
    setCurrentKey(null);
    setErrorMessage(null);
  }, [stop]);

  // ── App state: stop when backgrounded ─────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' && isRunningRef.current) stop();
    });
    return () => sub.remove();
  }, [stop]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
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
