// ═════════════════════════════════════════════════════════════════════════
// tonalScorer.ts — Scoring tonal contextual (complementa phraseKeyDetector)
// ═════════════════════════════════════════════════════════════════════════
// Implementa a fórmula:
//   score = 0.35 × aderenciaEscala
//         + 0.30 × forcaTonica
//         + 0.20 × resolucaoFrase
//         + 0.15 × estabilidadeTemporal
//         - 0.25 × penalidadeNotasFora
//
// Rodada para CADA candidato (24 = 12 tônicas × maj/min). O vencedor é
// comparado com o vencedor do phrase-voting. Se concordam → confiança alta.
// Se divergem → confiança baixa (app fica em "confirmando" mais tempo).
//
// MÓDULOS:
//   • frequencyToNote       (já existe em noteUtils.ts)
//   • smoothingNotas        (mediana de 5 frames — já no hook)
//   • bufferTemporal        (3-6s janela deslizante — implementado abaixo)
//   • histogramaPonderado   (por duração + estabilidade)
//   • scoringTonalidade     (fórmula acima)
//   • estabilidadeHisterese (já no phraseKeyDetector)
// ═════════════════════════════════════════════════════════════════════════

import type { Phrase } from './phraseKeyDetector';

// ── Escalas diatônicas (7 notas) ──────────────────────────────────
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// ── Amostra temporal (item do buffer deslizante) ──────────────────
export interface NoteSample {
  pitchClass: number;   // 0..11
  durMs: number;        // duração sustentada
  stability: number;    // 0..1 — quão estável foi (frames concordaram)
  timestamp: number;    // ms desde início
}

// ── Buffer deslizante (últimos 3-6s) ──────────────────────────────
export class TemporalBuffer {
  private samples: NoteSample[] = [];
  private windowMs: number;

  constructor(windowMs = 5000) { this.windowMs = windowMs; }

  push(sample: NoteSample) {
    this.samples.push(sample);
    const cutoff = sample.timestamp - this.windowMs;
    this.samples = this.samples.filter(s => s.timestamp >= cutoff);
  }

  getSamples(): NoteSample[] { return this.samples.slice(); }
  clear() { this.samples = []; }
}

// ── Histograma ponderado (duração × estabilidade) ─────────────────
export function buildWeightedHistogram(samples: NoteSample[]): number[] {
  const h = new Array(12).fill(0);
  for (const s of samples) {
    // Nota conta pela duração (ms) multiplicada pela estabilidade (0..1)
    h[s.pitchClass] += s.durMs * s.stability;
  }
  return h;
}

// ── 1) Aderência à escala (0..1) ──────────────────────────────────
// Fração do peso total que cai dentro da escala do candidato.
function aderenciaEscala(hist: number[], root: number, quality: 'major' | 'minor'): number {
  const intervals = quality === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const inScale = new Set(intervals.map(iv => (root + iv) % 12));
  let inSum = 0, totalSum = 0;
  for (let pc = 0; pc < 12; pc++) {
    totalSum += hist[pc];
    if (inScale.has(pc)) inSum += hist[pc];
  }
  return totalSum > 0 ? inSum / totalSum : 0;
}

// ── 2) Força da tônica (0..1) ─────────────────────────────────────
// Tônica + dominante (5ª) juntas, normalizadas pelo max do histograma.
// Em Ré Maior: hist[D] + hist[A] será forte; em F# minor: hist[F#] + hist[C#].
// Distingue relativos pois A é MUITO mais cantado que C# em D Maj.
function forcaTonica(hist: number[], root: number): number {
  const maxH = Math.max(...hist, 1e-9);
  const tonic = hist[root] / maxH;
  const fifth = hist[(root + 7) % 12] / maxH;
  return Math.min(1, 0.60 * tonic + 0.40 * fifth);
}

// ── 3) Resolução de frase (0..1) ──────────────────────────────────
// Quantas frases terminaram em `root` (cadência).
// 0 = nenhuma frase resolveu na tônica candidata
// 1 = todas as frases resolveram na tônica candidata
function resolucaoFrase(phrases: Phrase[], root: number): number {
  if (phrases.length === 0) return 0;
  let cadCount = 0;
  for (const p of phrases) {
    if (p.lastSustainedPc === root) cadCount++;
  }
  return cadCount / phrases.length;
}

// ── 4) Estabilidade temporal (0..1) ───────────────────────────────
// Quão consistente o tônica ficou entre a 1ª metade e a 2ª metade das amostras.
// Alto = tônica persistente ao longo do tempo, não é um pico isolado.
function estabilidadeTemporal(samples: NoteSample[], root: number): number {
  if (samples.length < 4) return 0;
  const mid = Math.floor(samples.length / 2);
  const firstHalf = samples.slice(0, mid);
  const secondHalf = samples.slice(mid);
  const sumRoot = (arr: NoteSample[]) => arr.filter(s => s.pitchClass === root).reduce((a, s) => a + s.durMs * s.stability, 0);
  const sumAll = (arr: NoteSample[]) => arr.reduce((a, s) => a + s.durMs * s.stability, 0);
  const r1 = sumAll(firstHalf) > 0 ? sumRoot(firstHalf) / sumAll(firstHalf) : 0;
  const r2 = sumAll(secondHalf) > 0 ? sumRoot(secondHalf) / sumAll(secondHalf) : 0;
  // Estabilidade = 1 - diferença (max 0, sem penalizar se ambos são altos)
  const diff = Math.abs(r1 - r2);
  return Math.max(0, 1 - diff * 2); // diff=0 → 1.0, diff=0.5 → 0
}

// ── 5) Penalidade por notas fora da escala (0..1) ─────────────────
// Fração do peso total que caiu FORA da escala.
// Usada como PENALIDADE (subtraída do score).
function penalidadeNotasFora(hist: number[], root: number, quality: 'major' | 'minor'): number {
  const intervals = quality === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const inScale = new Set(intervals.map(iv => (root + iv) % 12));
  let out = 0, total = 0;
  for (let pc = 0; pc < 12; pc++) {
    total += hist[pc];
    if (!inScale.has(pc)) out += hist[pc];
  }
  return total > 0 ? out / total : 0;
}

// ── SCORE AGREGADO (fórmula solicitada) ───────────────────────────
export interface TonalCandidate {
  root: number;
  quality: 'major' | 'minor';
  score: number;
  breakdown: {
    aderencia: number;
    forca: number;
    resolucao: number;
    estabilidade: number;
    penalidade: number;
  };
}

export function scoreKey(
  hist: number[],
  samples: NoteSample[],
  phrases: Phrase[],
  root: number,
  quality: 'major' | 'minor'
): TonalCandidate {
  const aderencia = aderenciaEscala(hist, root, quality);
  const forca = forcaTonica(hist, root);
  const resolucao = resolucaoFrase(phrases, root);
  const estabilidade = estabilidadeTemporal(samples, root);
  const penalidade = penalidadeNotasFora(hist, root, quality);

  const score =
    0.35 * aderencia +
    0.30 * forca +
    0.20 * resolucao +
    0.15 * estabilidade -
    0.25 * penalidade;

  return {
    root,
    quality,
    score,
    breakdown: { aderencia, forca, resolucao, estabilidade, penalidade },
  };
}

// ── Ranqueia TODOS os 24 candidatos e retorna o melhor ────────────
export function rankAllKeys(
  hist: number[],
  samples: NoteSample[],
  phrases: Phrase[]
): TonalCandidate[] {
  const out: TonalCandidate[] = [];
  for (let r = 0; r < 12; r++) {
    out.push(scoreKey(hist, samples, phrases, r, 'major'));
    out.push(scoreKey(hist, samples, phrases, r, 'minor'));
  }
  return out.sort((a, b) => b.score - a.score);
}

// ── Comparação com o phrase-voting (CONCORDÂNCIA) ─────────────────
// Retorna um multiplicador de confiança baseado na concordância dos 2 sistemas.
// 1.0 = concordam perfeitamente. 0.5 = mesma tônica, qualidade diferente.
// 0.3 = discordam na tônica.
export function agreementMultiplier(
  phraseWinnerRoot: number,
  phraseWinnerQuality: 'major' | 'minor',
  scoringWinner: TonalCandidate
): number {
  const rootsMatch = phraseWinnerRoot === scoringWinner.root;
  const qualitiesMatch = phraseWinnerQuality === scoringWinner.quality;
  if (rootsMatch && qualitiesMatch) return 1.0;
  if (rootsMatch) return 0.60; // mesma tônica, divergem em maj/min
  return 0.30; // discordam até na tônica
}
