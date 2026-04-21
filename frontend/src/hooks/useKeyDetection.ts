/**
 * useKeyDetection v4 — detecção tonal com SHADOW TRACKING
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FILOSOFIA MUSICAL:
 *
 * 1. RESPOSTA INICIAL RÁPIDA (~1.2s)
 *    Ao receber 6+ amostras com 3+ notas distintas e confiança ≥ 0.50,
 *    mostra "Tom provável" IMEDIATAMENTE — sem esperar mais.
 *
 * 2. REFINAMENTO CONTÍNUO
 *    A confiança é recalculada a cada 300ms. O usuário vê a % subir conforme
 *    canta mais notas da mesma tonalidade.
 *
 * 3. CONFIRMAÇÃO (promoção a CONFIRMED)
 *    Após 5s + ≥ 5 notas distintas + conf ≥ 0.75 + 5 frames consecutivos
 *    do mesmo resultado → tom PASSA A SER ESTÁVEL.
 *
 * 4. SHADOW TRACKING (análise OCULTA de mudança tonal)
 *    Uma vez confirmado, notas fora da tonalidade NÃO disparam UI.
 *    Um "candidato alternativo" é trackeado SILENCIOSAMENTE no background:
 *      - usa janela recente (últimos 4s) para capturar mudanças
 *      - exige 8+ frames consecutivos do novo candidato (~2.4s)
 *      - exige margem de confiança ≥ 0.10 sobre o tom atual
 *      - exige que a confiança do tom atual esteja caindo (< 0.65)
 *    Só quando TODOS esses critérios são atendidos → UI mostra
 *    "Possível mudança tonal". Nota errada isolada = descartada.
 *
 * 5. CONFIRMAÇÃO DE MUDANÇA
 *    Após "Possível mudança" aparecer, precisa de +6 frames (~1.8s total) E
 *    confiança do candidato ≥ 0.70 para COMMIT da mudança de tom.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PESOS DO HISTOGRAMA (musicalmente informados):
 * - Decay temporal: notas recentes pesam mais
 * - Repetição: pitch classes frequentes ganham até +4x
 * - Duração: log1p(runLength) — notas sustentadas valem mais (tônica usual)
 * - Cadência: últimas 3 notas ganham boost extra (finais definem tonalidade)
 * - Estabilidade: runs ≥ 4 frames ganham bônus
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { detectKeyFromHistogram, KeyResult } from '../utils/keyDetector';
import { usePitchEngine } from '../audio/usePitchEngine';
import type { PitchEvent, PitchErrorReason } from '../audio/types';
import { frequencyToMidi, midiToPitchClass, formatKeyDisplay } from '../utils/noteUtils';

// ─── Janelas ───────────────────────────────────────────────────────────────
const HISTORY_MS = 15000;
const RECENT_WINDOW_MS = 4000;      // janela curta para shadow tracking
const ANALYZE_INTERVAL_MS = 250;    // ↓ 300 → 250ms (UI mais responsiva)

// ─── Filtros de qualidade (calibrados para VOZ cantada, não instrumento) ──
const MIN_RMS = 0.012;              // ↓ 0.018 → 0.012 (voz suave passa)
const MIN_CLARITY = 0.55;           // ↓ 0.82 → 0.55 (voz tem vibrato/ar — mais permissivo)
const FREQ_SMOOTH_WINDOW = 7;       // ↑ 5 → 7 (mais estável)

// ─── Histerese anti-vibrato ────────────────────────────────────────────────
// Voz cantada tem vibrato de até ±50 cents. Mantém pitch class se variação pequena.
const HYSTERESIS_CENTS = 50;        // ↑ 30 → 50 (metade de semitom)

// ─── Camada 1: Provisional (evidência suficiente antes de palpitar) ─────────
const PROV_MIN_MS = 3000;           // ↑ 500 → 3000 (3s mínimo de contexto)
const PROV_MIN_SAMPLES = 10;        // ↑ 3 → 10 (mais frames)
const PROV_MIN_UNIQUE = 4;          // ↑ 2 → 4 notas distintas
const PROV_MIN_CONFIDENCE = 0.60;   // ↑ 0.40 → 0.60 (não mostrar palpite ruim)

// ─── Camada 2: Confirmed ───────────────────────────────────────────────────
const CONF_MIN_MS = 4000;           // ↓ 5000 → 4000
const CONF_MIN_UNIQUE = 4;          // ↓ 5 → 4
const CONF_MIN_CONFIDENCE = 0.70;   // ↓ 0.75 → 0.70
const CONF_CONFIRM_FRAMES = 4;      // ↓ 5 → 4

// ─── Shadow tracking — DUAL MODE ─────────────────────────────────────────
// Valores controlados pelo modo escolhido pelo usuário (live/stable)
const SHADOW_MIN_FRAMES_LIVE = 5;   // ~1.25s
const SHADOW_MIN_FRAMES_STABLE = 8; // ~2.0s
const SHADOW_MARGIN = 0.08;         // candidato precisa estar X% acima do atual
const SHADOW_CURRENT_WEAKENING = 0.68;

// ─── Confirmação de mudança (após SHADOW sugerir) ─────────────────────────
const CHANGE_EXTRA_CONFIRM_FRAMES_LIVE = 3;   // +0.75s → total ~2s
const CHANGE_EXTRA_CONFIRM_FRAMES_STABLE = 6; // +1.5s → total ~3.5s
const CHANGE_MIN_CONFIDENCE = 0.65;

// ─── Pesos do histograma (recalibrados após bug E major → A minor) ────────
const HISTOGRAM_DECAY = 2.0;
const REPETITION_BOOST = 2.5;       // ↓ 4.0 → 2.5 (menos viés por repetição)
const DURATION_BOOST = 1.5;         // ↓ 2.5 → 1.5
const CADENCE_BOOST = 1.3;          // ↓ 1.8 → 1.3 (últimas 3 notas)
const TONIC_SUSTAIN_BOOST = 1.5;    // ↓ 2.5 → 1.5 (CORRIGE bug E major vs A minor)

// ─── UX ───────────────────────────────────────────────────────────────────
const NOTE_DISPLAY_HOLD_MS = 60;    // ↓ 180 → 60ms (tempo real de verdade)
const SILENCE_HINT_MS = 8000;
const SILENCE_RETRY_MS = 20000;

interface NoteEvent {
  pitchClass: number;
  timestamp: number;
  rms: number;
  runLength: number;
}

export type DetectionState =
  | 'idle'
  | 'listening'
  | 'analyzing'
  | 'provisional'
  | 'confirmed'
  | 'change_possible';

export type KeyTier = 'provisional' | 'confirmed' | null;

export type DetectionMode = 'live' | 'stable';

// Novo: modos principais do app
export type AppMode =
  | 'idle'         // nada rolando
  | 'analyzing'    // capturando 15s pra análise definitiva
  | 'result'       // mostrando resultado da análise
  | 'monitoring';  // monitoramento live pós-análise

const ANALYSIS_DURATION_MS = 15000;   // 15s para captura definitiva
const ANALYSIS_MIN_CLARITY = 0.70;    // filtro rígido durante análise
const LOCKED_MODULATION_GAP = 0.15;   // gap mínimo pra mudar tom travado
const LOCKED_MODULATION_MS = 10000;   // 10s de evidência pra trocar tom travado

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
  mode: DetectionMode;
  setMode: (m: DetectionMode) => void;
  appMode: AppMode;
  analyzeTimeLeft: number;
  lockedKey: KeyResult | null;
  lockedConfidence: number;
  modulationCandidate: KeyResult | null;
  startAnalysis: (durationMs?: number) => Promise<boolean>;
  cancelAnalysis: () => void;
  newAnalysis: () => Promise<boolean>;
  startMonitoring: () => Promise<boolean>;
  stopMonitoring: () => void;
  start: () => Promise<boolean>;
  stop: () => void;
  reset: () => void;
}

export function useKeyDetection(): UseKeyDetectionReturn {
  const [detectionState, setDetectionState] = useState<DetectionState>('idle');
  const [currentKey, setCurrentKey] = useState<KeyResult | null>(null);
  const [keyTier, setKeyTier] = useState<KeyTier>(null);
  const [liveConfidence, setLiveConfidence] = useState<number>(0);
  const [changeSuggestion, setChangeSuggestion] = useState<KeyResult | null>(null);
  const [currentNote, setCurrentNote] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<number[]>([]);
  const [audioLevel, setAudioLevel] = useState<number>(0); // 0..1 (RMS normalizado) p/ visualizer
  const [isStable, setIsStable] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Pronto para detectar');
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<PitchErrorReason | null>(null);
  const [softInfo, setSoftInfo] = useState<string | null>(null);
  const [mode, setModeState] = useState<DetectionMode>('live');
  const [appMode, setAppMode] = useState<AppMode>('idle');
  const [analyzeTimeLeft, setAnalyzeTimeLeft] = useState<number>(0);
  const [lockedKey, setLockedKey] = useState<KeyResult | null>(null);
  const [lockedConfidence, setLockedConfidence] = useState<number>(0);
  const [modulationCandidate, setModulationCandidate] = useState<KeyResult | null>(null);

  const noteHistory = useRef<NoteEvent[]>([]);
  const freqBuffer = useRef<number[]>([]);
  const currentKeyRef = useRef<KeyResult | null>(null);
  const currentTierRef = useRef<KeyTier>(null);
  const changeSuggestionRef = useRef<KeyResult | null>(null);
  const modeRef = useRef<DetectionMode>('live');

  const setMode = useCallback((m: DetectionMode) => {
    modeRef.current = m;
    setModeState(m);
  }, []);

  // Contadores para máquina de estados
  const confirmRef = useRef<{ root: number; quality: string; count: number } | null>(null);
  // Shadow tracking: candidato alternativo silencioso
  const shadowRef = useRef<{ root: number; quality: string; count: number; avgConf: number } | null>(null);
  // Depois que o shadow "vira público", este conta frames até confirmação
  const changeRef = useRef<{ root: number; quality: string; count: number } | null>(null);

  const sessionStartRef = useRef<number>(0);
  const lastValidPitchAtRef = useRef<number>(0);
  const silenceHintShownRef = useRef<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(false);
  const lastPitchRef = useRef<number | null>(null);
  const lastMidiRef = useRef<number | null>(null); // MIDI EMA para histerese anti-vibrato
  const noteDisplayRef = useRef<{ pc: number; setAt: number } | null>(null);
  const isStartingRef = useRef(false);
  const lastRecentUpdateRef = useRef<number>(0);
  const audioLevelRef = useRef<number>(0); // escrito em onPitch, drenado por analyzeKey

  // Buffer para MODA de pitch class (mais estável que mediana de frequência)
  const pcBuffer = useRef<{ pc: number; clarity: number; midi: number }[]>([]);
  // Contador de frames consecutivos do mesmo pc candidato (anti-transiente)
  const pcCandidateRef = useRef<{ pc: number; count: number } | null>(null);

  const engine = usePitchEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    if (engine.setSoftInfoHandler) {
      engine.setSoftInfoHandler((msg: string) => setSoftInfo(msg));
    }
  }, [engine]);

  const isSupported = engine.isSupported;

  // ── onPitch ─────────────────────────────────────────────────────────────
  const onPitch = useCallback((e: PitchEvent) => {
    if (!isRunningRef.current) return;

    // Audio level sempre registrado (p/ visualizer)
    const normLevel = Math.min(1, e.rms * 8);
    audioLevelRef.current = audioLevelRef.current * 0.6 + normLevel * 0.4;

    if (e.rms < MIN_RMS || e.clarity < MIN_CLARITY) return;

    const now = Date.now();
    lastValidPitchAtRef.current = now;
    silenceHintShownRef.current = false;

    // ── 1) Compute pitch class raw deste frame ─────────────────────────────
    const rawMidi = frequencyToMidi(e.frequency);
    const rawPc = midiToPitchClass(rawMidi);

    // ── 2) Buffer de pitch classes (FIFO de 7) ──────────────────────────────
    pcBuffer.current.push({ pc: rawPc, clarity: e.clarity, midi: rawMidi });
    if (pcBuffer.current.length > FREQ_SMOOTH_WINDOW) pcBuffer.current.shift();

    // ── 3) MODA de pitch class ponderada pela clarity ─────────────────────
    // Em vez de mediana de frequência (que pode cair num Hz intermediário e
    // dar nota errada por vibrato), conto quantas vezes cada pitch class
    // aparece ponderando pela clarity. A pc com maior score ganha.
    const counts = new Array(12).fill(0);
    for (const b of pcBuffer.current) counts[b.pc] += b.clarity;
    let modePc: typeof rawPc = rawPc;
    let maxScore = 0;
    for (let i = 0; i < 12; i++) {
      if (counts[i] > maxScore) { maxScore = counts[i]; modePc = i as typeof rawPc; }
    }

    // ── 4) Histerese anti-vibrato (cents) ─────────────────────────────────
    // Se o MIDI atual está MUITO próximo da última nota mostrada (< 50 cents),
    // mantém ela pra evitar flip-flop de vibrato.
    if (lastPitchRef.current !== null && lastMidiRef.current !== null) {
      const centsDelta = Math.abs(rawMidi - lastMidiRef.current) * 100;
      if (centsDelta < HYSTERESIS_CENTS && modePc !== lastPitchRef.current) {
        modePc = lastPitchRef.current as typeof rawPc;
      }
    }

    // ── 5) EMA do MIDI para centro da nota (anti-vibrato) ─────────────────
    lastMidiRef.current =
      lastMidiRef.current === null
        ? rawMidi
        : lastMidiRef.current * 0.6 + rawMidi * 0.4;

    // ── 6) Requer 2 FRAMES CONSECUTIVOS da mesma PC antes de "aceitar" ─────
    // Descarta transientes de glissando entre notas.
    if (!pcCandidateRef.current || pcCandidateRef.current.pc !== modePc) {
      pcCandidateRef.current = { pc: modePc, count: 1 };
      return; // 1ª aparição — NÃO registra ainda
    }
    pcCandidateRef.current.count++;
    if (pcCandidateRef.current.count < 2) return; // ainda não estabilizou

    // ── 7) Nota estabilizada — agora sim registra ──────────────────────────
    const pc = modePc;

    let runLength = 1;
    if (lastPitchRef.current === pc) {
      const last = noteHistory.current[noteHistory.current.length - 1];
      if (last && last.pitchClass === pc) runLength = last.runLength + 1;
    }
    lastPitchRef.current = pc;

    noteHistory.current.push({
      pitchClass: pc,
      timestamp: now,
      rms: e.rms,
      runLength,
    });

    // ── 8) DISPLAY RÁPIDO (quase instantâneo) ──────────────────────────────
    const disp = noteDisplayRef.current;
    if (!disp || now - disp.setAt >= NOTE_DISPLAY_HOLD_MS) {
      noteDisplayRef.current = { pc, setAt: now };
      setCurrentNote(pc);
    }

    if (now - lastRecentUpdateRef.current >= 180) {
      lastRecentUpdateRef.current = now;
      const all = noteHistory.current.slice(-60).map(n => n.pitchClass);
      const dedup: number[] = [];
      for (const p of all) {
        if (dedup.length === 0 || dedup[dedup.length - 1] !== p) dedup.push(p);
      }
      setRecentNotes(dedup.slice(-8));
    }
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

  // ── Histograma com pesos MUSICAIS (baseado em NOTE EVENTS) ──────────────
  // Agrupa frames consecutivos de mesma pitch class em "events" (notas musicais).
  // Cada evento contribui UMA VEZ ao histograma, com peso = duração × rms_médio.
  // Isso evita que notas sustentadas inflem artificialmente o histograma.
  const buildHistogram = useCallback((history: NoteEvent[], now: number): number[] => {
    const histogram = new Array(12).fill(0);
    const uniqueCount = new Array(12).fill(0);
    // Usando array-box para evitar problema de type narrowing do TS
    const sustainedBox: Array<{ pc: number; frames: number }> = [];
    let lastPc: number | null = null;
    let eventStart = 0;
    let eventEnd = 0;
    let eventRmsSum = 0;
    let eventFrameCount = 0;

    function commit() {
      if (lastPc === null || eventFrameCount < 2) return;
      const durMs = eventEnd - eventStart + 128;
      const rmsAvg = eventRmsSum / eventFrameCount;
      const age = (now - eventEnd) / HISTORY_MS;
      const decay = Math.exp(-HISTOGRAM_DECAY * age);
      const weight = Math.sqrt(durMs / 500) * rmsAvg * decay;
      histogram[lastPc] += weight;
      uniqueCount[lastPc] += 1;
      if (eventFrameCount >= 4) {
        sustainedBox.length = 0;
        sustainedBox.push({ pc: lastPc, frames: eventFrameCount });
      }
    }

    for (const n of history) {
      if (n.pitchClass !== lastPc) {
        commit();
        lastPc = n.pitchClass;
        eventStart = n.timestamp;
        eventEnd = n.timestamp;
        eventRmsSum = n.rms;
        eventFrameCount = 1;
      } else {
        eventEnd = n.timestamp;
        eventRmsSum += n.rms;
        eventFrameCount++;
      }
    }
    commit(); // flush final

    // ── Boost por diversidade: se nota apareceu em MÚLTIPLOS eventos distintos,
    //    é mais provável ser nota da escala (não apenas sustain random)
    for (let i = 0; i < 12; i++) {
      if (uniqueCount[i] >= 2) histogram[i] *= 1.0 + Math.log1p(uniqueCount[i]) * 0.3;
    }

    // ── Cadência: últimas ~2 notas distintas ganham peso extra ──
    // Notas finais definem tonalidade (ex: "fim de frase na tônica")
    const recentUnique: number[] = [];
    for (let i = history.length - 1; i >= 0 && recentUnique.length < 2; i--) {
      const pc = history[i].pitchClass;
      if (!recentUnique.includes(pc)) recentUnique.push(pc);
    }
    for (const pc of recentUnique) {
      histogram[pc] *= CADENCE_BOOST;
    }

    // ── Tônica sustentada: boost LEVE (já contido pelo sqrt acima) ──
    if (sustainedBox.length > 0) {
      histogram[sustainedBox[0].pc] *= 1.15;
    }

    return histogram;
  }, []);

  // ── analyzeKey: máquina de estados com shadow tracking ──────────────────
  const analyzeKey = useCallback(() => {
    if (!isRunningRef.current) return;

    // Resolver parâmetros conforme modo atual
    const SHADOW_MIN_FRAMES =
      modeRef.current === 'live' ? SHADOW_MIN_FRAMES_LIVE : SHADOW_MIN_FRAMES_STABLE;
    const CHANGE_EXTRA_CONFIRM_FRAMES =
      modeRef.current === 'live'
        ? CHANGE_EXTRA_CONFIRM_FRAMES_LIVE
        : CHANGE_EXTRA_CONFIRM_FRAMES_STABLE;

    const now = Date.now();
    noteHistory.current = noteHistory.current.filter(n => n.timestamp >= now - HISTORY_MS);

    // Drena audio level para o state (sincroniza UI do visualizer)
    setAudioLevel(audioLevelRef.current);

    const fullHistory = noteHistory.current;
    const recentHistory = fullHistory.filter(n => n.timestamp >= now - RECENT_WINDOW_MS);
    const elapsed = now - sessionStartRef.current;
    const uniqueNotes = new Set(fullHistory.map(h => h.pitchClass)).size;
    const hasKey = !!currentKeyRef.current;
    const tier = currentTierRef.current;

    const timeSinceLastPitch = now - lastValidPitchAtRef.current;
    const everHadPitch = lastValidPitchAtRef.current > 0;

    // ── Silence ──
    if (!hasKey && everHadPitch && timeSinceLastPitch > SILENCE_RETRY_MS) {
      setStatusMessage('Sem áudio — verifique o microfone');
      setDetectionState('listening');
      return;
    }
    if (!hasKey && !everHadPitch && elapsed > SILENCE_HINT_MS && !silenceHintShownRef.current) {
      silenceHintShownRef.current = true;
      setSoftInfo('Cante ou toque uma nota próximo ao microfone');
    }

    if (!hasKey && fullHistory.length < 3) {
      setDetectionState('listening');
      setStatusMessage('Ouvindo...');
      return;
    }

    const histogram = buildHistogram(fullHistory, now);
    const result = detectKeyFromHistogram(histogram);
    const conf = Math.max(0, result.confidence);
    setLiveConfidence(conf);

    // ═════════════════════════════════════════════════════════════════════
    // Sem tom ainda → tentar PROVISIONAL rápido
    // ═════════════════════════════════════════════════════════════════════
    if (!hasKey) {
      const readyForProv =
        elapsed >= PROV_MIN_MS &&
        fullHistory.length >= PROV_MIN_SAMPLES &&
        uniqueNotes >= PROV_MIN_UNIQUE &&
        conf >= PROV_MIN_CONFIDENCE;

      if (!readyForProv) {
        setDetectionState('analyzing');
        if (fullHistory.length < PROV_MIN_SAMPLES) {
          setStatusMessage('Ouvindo...');
        } else if (uniqueNotes < PROV_MIN_UNIQUE) {
          setStatusMessage(`Analisando tonalidade... (${uniqueNotes}/${PROV_MIN_UNIQUE} notas)`);
        } else {
          const pct = Math.round(conf * 100);
          setStatusMessage(`Analisando tonalidade... (${pct}%)`);
        }
        return;
      }

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
    // JÁ TEM TOM → refinamento / shadow tracking / confirmação
    // ═════════════════════════════════════════════════════════════════════
    const cur = currentKeyRef.current!;
    const isSameAsCurrent = cur.root === result.root && cur.quality === result.quality;

    currentKeyRef.current = { ...cur, confidence: conf };
    setCurrentKey({ ...cur, confidence: conf });

    // ── Provisional: troca mais fácil (ainda não estava firme) ──
    // Usa lógica simples de 3 frames
    if (tier === 'provisional') {
      if (isSameAsCurrent) {
        const cr = confirmRef.current;
        if (!cr || cr.root !== cur.root || cr.quality !== cur.quality) {
          confirmRef.current = { root: cur.root, quality: cur.quality, count: 1 };
        } else {
          cr.count++;
        }

        // Promover para CONFIRMED
        if (
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
          shadowRef.current = null; // reset shadow
          return;
        }

        setDetectionState('provisional');
        const pct = Math.round(conf * 100);
        const { noteBr, qualityLabel } = formatKeyDisplay(cur.root, cur.quality as 'major' | 'minor');
        setStatusMessage(`Refinando: ${noteBr} ${qualityLabel} (${pct}%)`);
        return;
      } else {
        // Em provisional, se detectou OUTRO tom com conf razoável 3x → troca
        const ch = changeRef.current;
        if (!ch || ch.root !== result.root || ch.quality !== result.quality) {
          changeRef.current = { root: result.root, quality: result.quality, count: 1 };
        } else {
          ch.count++;
        }
        if (changeRef.current!.count >= 3 && conf >= PROV_MIN_CONFIDENCE) {
          currentKeyRef.current = { ...result };
          confirmRef.current = { root: result.root, quality: result.quality, count: 1 };
          changeRef.current = null;
          setCurrentKey({ ...result });
          setDetectionState('provisional');
          const { noteBr, qualityLabel } = formatKeyDisplay(result.root, result.quality as 'major' | 'minor');
          setStatusMessage(`Tom provável: ${noteBr} ${qualityLabel}`);
          return;
        }
        setDetectionState('provisional');
        const pct = Math.round(conf * 100);
        const { noteBr, qualityLabel } = formatKeyDisplay(cur.root, cur.quality as 'major' | 'minor');
        setStatusMessage(`Refinando: ${noteBr} ${qualityLabel} (${pct}%)`);
        return;
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // TIER === 'confirmed' → SHADOW TRACKING OCULTO
    // ═════════════════════════════════════════════════════════════════════
    if (isSameAsCurrent) {
      // Tom atual se reforça → reset shadow + change suggestion
      shadowRef.current = null;
      if (changeSuggestionRef.current) {
        changeSuggestionRef.current = null;
        setChangeSuggestion(null);
      }
      changeRef.current = null;
      setDetectionState('confirmed');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    // ── Análise oculta: usar JANELA RECENTE (4s) para capturar mudanças ──
    let candidateKey = result;
    if (recentHistory.length >= 6) {
      const recentHist = buildHistogram(recentHistory, now);
      const recentResult = detectKeyFromHistogram(recentHist);
      if (recentResult.confidence > 0.50) {
        candidateKey = recentResult;
      }
    }
    const candidateSameAsCurrent =
      candidateKey.root === cur.root && candidateKey.quality === cur.quality;

    if (candidateSameAsCurrent) {
      // Candidato recente = tom atual → reset shadow
      shadowRef.current = null;
      if (changeSuggestionRef.current) {
        changeSuggestionRef.current = null;
        setChangeSuggestion(null);
      }
      changeRef.current = null;
      setDetectionState('confirmed');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    // ── SHADOW: candidato diferente — trackear silenciosamente ──
    const sh = shadowRef.current;
    const candConf = Math.max(0, candidateKey.confidence);
    if (!sh || sh.root !== candidateKey.root || sh.quality !== candidateKey.quality) {
      shadowRef.current = {
        root: candidateKey.root,
        quality: candidateKey.quality,
        count: 1,
        avgConf: candConf,
      };
      // Não mostra nada — só continua
      setDetectionState('confirmed');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    // Incrementa shadow + atualiza média móvel de confiança
    sh.count++;
    sh.avgConf = sh.avgConf * 0.7 + candConf * 0.3;

    // ── Critérios para EXPOR o shadow ao usuário ──
    const currentWeakening = conf < SHADOW_CURRENT_WEAKENING;
    const marginOk = sh.avgConf >= conf + SHADOW_MARGIN;
    const framesOk = sh.count >= SHADOW_MIN_FRAMES;

    if (!framesOk || !marginOk || !currentWeakening) {
      // Ainda não é forte o suficiente — NADA visível ao usuário
      setDetectionState('confirmed');
      setIsStable(true);
      setStatusMessage('Estável no tom atual');
      return;
    }

    // ── SHADOW ESTÁ MADURO: mostrar "Possível mudança" ──
    if (
      !changeSuggestionRef.current ||
      changeSuggestionRef.current.root !== candidateKey.root ||
      changeSuggestionRef.current.quality !== candidateKey.quality
    ) {
      changeSuggestionRef.current = { ...candidateKey };
      setChangeSuggestion({ ...candidateKey });
      changeRef.current = { root: candidateKey.root, quality: candidateKey.quality, count: 1 };
    } else {
      const cr = changeRef.current;
      if (!cr || cr.root !== candidateKey.root || cr.quality !== candidateKey.quality) {
        changeRef.current = { root: candidateKey.root, quality: candidateKey.quality, count: 1 };
      } else {
        cr.count++;
      }
    }

    const cr2 = changeRef.current!;

    // ── Confirmar mudança? ──
    if (cr2.count >= CHANGE_EXTRA_CONFIRM_FRAMES && sh.avgConf >= CHANGE_MIN_CONFIDENCE) {
      // COMMIT
      currentKeyRef.current = { ...candidateKey };
      currentTierRef.current = 'confirmed';
      confirmRef.current = { root: candidateKey.root, quality: candidateKey.quality, count: 1 };
      shadowRef.current = null;
      changeRef.current = null;
      changeSuggestionRef.current = null;
      setCurrentKey({ ...candidateKey });
      setChangeSuggestion(null);
      setDetectionState('confirmed');
      setIsStable(false);
      const { noteBr, qualityLabel } = formatKeyDisplay(candidateKey.root, candidateKey.quality as 'major' | 'minor');
      setStatusMessage(`Tom alterado para ${noteBr} ${qualityLabel}`);
      setTimeout(() => {
        if (isRunningRef.current && currentKeyRef.current?.root === candidateKey.root) {
          setIsStable(true);
          setStatusMessage('Estável no tom atual');
        }
      }, 1800);
      return;
    }

    // Ainda aguardando confirmação final
    setDetectionState('change_possible');
    setIsStable(false);
    const { noteBr, qualityLabel } = formatKeyDisplay(candidateKey.root, candidateKey.quality as 'major' | 'minor');
    const totalNeeded = SHADOW_MIN_FRAMES + CHANGE_EXTRA_CONFIRM_FRAMES;
    const progress = Math.min(totalNeeded, sh.count + cr2.count);
    setStatusMessage(`Possível mudança tonal: ${noteBr} ${qualityLabel}... (${progress}/${totalNeeded})`);
  }, [buildHistogram]);

  // ── start ──────────────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<boolean> => {
    if (isStartingRef.current) return false;
    isStartingRef.current = true;
    try {
      setErrorMessage(null);
      setErrorReason(null);
      setSoftInfo(null);

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

      noteHistory.current = [];
      freqBuffer.current = [];
      currentKeyRef.current = null;
      currentTierRef.current = null;
      changeSuggestionRef.current = null;
      confirmRef.current = null;
      changeRef.current = null;
      shadowRef.current = null;
      lastPitchRef.current = null;
      lastMidiRef.current = null;
      pcBuffer.current = [];
      pcCandidateRef.current = null;
      audioLevelRef.current = 0;
      setAudioLevel(0);
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
    setLockedKey(null);
    setLockedConfidence(0);
    setAppMode('idle');
    setAnalyzeTimeLeft(0);
    setModulationCandidate(null);
  }, [stop]);

  // ═══════════════════════════════════════════════════════════════════════
  // MODO PRINCIPAL: ANÁLISE DEFINITIVA (15s)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Computa o tom final aplicando filtros rígidos ao histórico acumulado.
   * Aplica:
   *  - Filtro de clarity ≥ 0.70 (só frames de alta qualidade)
   *  - First-note bias (+3x) para a primeira nota estável (candidata forte a tônica)
   *  - Phrase-end bias (+2x) para última nota sustentada antes de silêncio
   *  - Perfect-fifth bias: nota-e-5ª presentes juntas ganham bônus
   */
  const computeFinalKey = useCallback((): { key: KeyResult; conf: number } | null => {
    const history = noteHistory.current;
    if (history.length < 8) return null;

    // Filtro rígido: descarta frames de baixa qualidade
    const filtered = history.filter(n => n.rms >= 0.015);
    if (filtered.length < 6) return null;

    const histogram = new Array(12).fill(0);
    const uniqueCount = new Array(12).fill(0);
    let firstStablePc: number | null = null;
    let lastPhraseEndPc: number | null = null;

    // Agrupa em eventos e aplica pesos musicais
    let lastPc: number | null = null;
    let evStart = 0, evEnd = 0, evRmsSum = 0, evFrames = 0;
    const events: { pc: number; durMs: number; rmsAvg: number }[] = [];

    const commit = () => {
      if (lastPc === null || evFrames < 2) return;
      events.push({
        pc: lastPc,
        durMs: evEnd - evStart + 128,
        rmsAvg: evRmsSum / evFrames,
      });
    };
    for (const n of filtered) {
      if (n.pitchClass !== lastPc) {
        commit();
        lastPc = n.pitchClass;
        evStart = n.timestamp;
        evEnd = n.timestamp;
        evRmsSum = n.rms;
        evFrames = 1;
      } else {
        evEnd = n.timestamp;
        evRmsSum += n.rms;
        evFrames++;
      }
    }
    commit();
    if (events.length < 3) return null;

    // Primeira nota estável (≥ 2 frames = ~250ms) → forte candidata a tônica
    firstStablePc = events[0].pc;
    // Última nota longa = candidata a tônica de resolução
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].durMs >= 400) { lastPhraseEndPc = events[i].pc; break; }
    }

    // Constrói histograma
    for (const ev of events) {
      const weight = Math.sqrt(ev.durMs / 500) * ev.rmsAvg;
      histogram[ev.pc] += weight;
      uniqueCount[ev.pc] += 1;
    }

    // Boost diversidade (nota aparece em múltiplos eventos)
    for (let i = 0; i < 12; i++) {
      if (uniqueCount[i] >= 2) histogram[i] *= 1.0 + Math.log1p(uniqueCount[i]) * 0.3;
    }

    // ▶ FIRST-NOTE BIAS: primeira nota estável tem +3x (tônica muito provável)
    if (firstStablePc !== null) histogram[firstStablePc] *= 3.0;
    // ▶ PHRASE-END BIAS: última nota longa tem +2x (resolução harmônica)
    if (lastPhraseEndPc !== null && lastPhraseEndPc !== firstStablePc) {
      histogram[lastPhraseEndPc] *= 2.0;
    }

    // ▶ PERFECT-FIFTH BIAS: notas que tem sua 5ª também presente = tônica provável
    for (let i = 0; i < 12; i++) {
      const fifth = (i + 7) % 12;
      if (histogram[i] > 0.5 && histogram[fifth] > 0.3) {
        histogram[i] *= 1.3;
      }
    }

    const result = detectKeyFromHistogram(histogram);
    return { key: result, conf: result.confidence };
  }, []);

  /**
   * Inicia uma análise definitiva de N segundos.
   * Durante este período:
   *  - Motor roda, notas são detectadas e acumuladas
   *  - Nenhum palpite é mostrado ao usuário (evita oscilação)
   *  - Countdown visível: 15, 14, 13, ...
   *  - Ao fim: computa UM resultado definitivo com filtros rígidos
   */
  const startAnalysis = useCallback(async (durationMs: number = ANALYSIS_DURATION_MS) => {
    reset();
    setAppMode('analyzing');
    setAnalyzeTimeLeft(Math.ceil(durationMs / 1000));

    const started = await start();
    if (!started) {
      setAppMode('idle');
      return false;
    }

    const endAt = Date.now() + durationMs;
    // Countdown interval (a cada 250ms)
    const tick = setInterval(() => {
      const remaining = Math.max(0, endAt - Date.now());
      setAnalyzeTimeLeft(Math.ceil(remaining / 1000));
      if (remaining === 0) {
        clearInterval(tick);
        // Computa resultado final
        const final = computeFinalKey();
        if (final && final.conf >= 0.55) {
          setLockedKey(final.key);
          setLockedConfidence(final.conf);
          setAppMode('result');
        } else {
          // Sem evidência suficiente — volta pra idle, mas deixa a voz como feedback
          setAppMode('idle');
          setStatusMessage('Não foi possível identificar o tom. Tente cantar mais notas.');
        }
        // Para o motor após a análise (usuário pode iniciar monitoramento depois)
        stop();
      }
    }, 250);
    return true;
  }, [reset, start, stop, computeFinalKey]);

  const cancelAnalysis = useCallback(() => {
    stop();
    setAppMode('idle');
    setAnalyzeTimeLeft(0);
  }, [stop]);

  /**
   * Entra em modo de monitoramento live usando o lockedKey como "tom travado".
   * O motor só troca se houver evidência FORTE (10s+ de modulação consistente).
   */
  const startMonitoring = useCallback(async () => {
    if (!lockedKey) return false;
    setAppMode('monitoring');
    setModulationCandidate(null);
    const ok = await start();
    if (!ok) setAppMode('result');
    return ok;
  }, [lockedKey, start]);

  const stopMonitoring = useCallback(() => {
    stop();
    if (lockedKey) setAppMode('result');
    else setAppMode('idle');
  }, [stop, lockedKey]);

  /** Reanalisa a partir do zero */
  const newAnalysis = useCallback(() => {
    reset();
    return startAnalysis();
  }, [reset, startAnalysis]);

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
    audioLevel,
    isStable,
    statusMessage,
    isRunning,
    isSupported,
    errorMessage,
    errorReason,
    softInfo,
    mode,
    setMode,
    appMode,
    analyzeTimeLeft,
    lockedKey,
    lockedConfidence,
    modulationCandidate,
    startAnalysis,
    cancelAnalysis,
    newAnalysis,
    startMonitoring,
    stopMonitoring,
    start,
    stop,
    reset,
  };
}
