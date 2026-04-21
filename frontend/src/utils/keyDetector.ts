// ═════════════════════════════════════════════════════════════════════════
// Tom Certo — Tonal Inference Engine v4
// ═════════════════════════════════════════════════════════════════════════
// OBJETIVO desta revisão: ELIMINAR a confusão maior vs. relativo menor.
//
// Relativo maior/menor (ex: Ré Maior / Fá# menor) compartilham EXATAMENTE
// as mesmas 7 notas diatônicas. Portanto, NENHUM algoritmo baseado só em
// distribuição de notas consegue diferenciá-los — apenas o CENTRO TONAL
// diferencia.
//
// Sinais de centro tonal (em ordem de importância):
//   1. Nota sobre a qual a melodia "descansa" (última nota sustentada)
//   2. Primeira nota estável de uma frase
//   3. Tônica candidata ter a 5ª dominante também forte (V-I)
//   4. 3ª maior vs 3ª menor — já separa maj/min quando a 3ª é cantada
//   5. Nota mais sustentada
//   6. Frequência relativa
//
// Pesos finais:
//   0.15 Pearson (Krumhansl-Schmuckler)
//   0.10 Signature fit (notas dentro da escala)
//   0.18 3rd-balance (M3 >> m3 para maior; m3 >> M3 para menor)
//   0.22 Tonic centrality (tônica + dominante juntas)
//   0.09 Cadência (última nota sustentada = tônica)
//   0.08 First-note bias (primeira nota estável = tônica)
//   0.05 Longest-sustained (nota mais sustentada = tônica)
//   0.05 Subdominant support (4ª também presente)
//   0.05 Leading tone (7ª maior em maj/harm. menor)
//   0.03 Relative-major prior (literatura ocidental é ~60% maior)
// ═════════════════════════════════════════════════════════════════════════

// Perfis de Krumhansl-Schmuckler (1990)
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Escalas diatônicas (EXATAS — 7 notas cada — pra comparação justa)
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_NATURAL = [0, 2, 3, 5, 7, 8, 10];

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const xd = x[i] - mx, yd = y[i] - my;
    num += xd * yd; dx2 += xd * xd; dy2 += yd * yd;
  }
  const d = Math.sqrt(dx2 * dy2);
  return d > 0 ? num / d : 0;
}

function rotate(arr: number[], shift: number): number[] {
  return Array.from({ length: 12 }, (_, i) => arr[(i - shift + 12) % 12]);
}

function signatureFit(hist: number[], root: number, quality: 'major' | 'minor'): number {
  const iv = quality === 'major' ? MAJOR_SCALE : MINOR_SCALE_NATURAL;
  const scale = new Set(iv.map(i => (root + i) % 12));
  let inS = 0, outS = 0;
  for (let pc = 0; pc < 12; pc++) {
    if (scale.has(pc)) inS += hist[pc];
    else outS += hist[pc];
  }
  const total = inS + outS;
  return total <= 0 ? 0 : inS / total;
}

/**
 * Terceira maior (root+4) vs terceira menor (root+3).
 * Retorna -1..+1: positivo = perfil maior, negativo = perfil menor.
 */
function thirdBalance(hist: number[], root: number): number {
  const M3 = hist[(root + 4) % 12];
  const m3 = hist[(root + 3) % 12];
  const sum = M3 + m3;
  if (sum < 1e-6) return 0;
  return (M3 - m3) / sum;
}

/**
 * Centro tonal: quanto `root` domina como tônica + quanto sua 5ª justa é forte.
 * Peso: 60% tônica + 40% dominante.
 *
 * RAZÃO: em Ré Maior, A (5ª) é muito mais cantada que C# (5ª de F#m).
 * Isso desempata Ré Maior vs Fá# menor mesmo com notas iguais.
 */
function tonicCentrality(hist: number[], root: number): number {
  const maxH = Math.max(...hist, 1e-9);
  const tonic = hist[root] / maxH;            // 0..1
  const fifth = hist[(root + 7) % 12] / maxH; // 0..1
  return Math.min(1, 0.60 * tonic + 0.40 * fifth);
}

function subdominantSupport(hist: number[], root: number): number {
  const maxH = Math.max(...hist, 1e-9);
  return hist[(root + 5) % 12] / maxH;
}

function leadingToneEvidence(hist: number[], root: number): number {
  const lt = hist[(root + 11) % 12];
  const maxH = Math.max(...hist, 1e-9);
  return Math.min(1, lt / maxH);
}

// ─── Hints musicais (pistas contextuais vindas do histórico de notas) ──
export interface KeyHints {
  firstStablePc?: number | null;
  lastPhraseEndPc?: number | null;
  longestSustainedPc?: number | null;
}

export interface KeyResult {
  root: number;
  quality: 'major' | 'minor';
  confidence: number;
  breakdown?: {
    pearson: number;
    signature: number;
    third: number;
    tonicity: number;
    cadence: number;
    firstNote: number;
    longest: number;
  };
}

export interface KeyScoreEntry {
  root: number;
  quality: 'major' | 'minor';
  score: number;
}

function computeKeyScore(
  hist: number[],
  root: number,
  quality: 'major' | 'minor',
  hints?: KeyHints
): { score: number; breakdown: NonNullable<KeyResult['breakdown']> } {
  const profile = quality === 'major' ? rotate(KK_MAJOR, root) : rotate(KK_MINOR, root);
  const p = Math.max(0, pearson(hist, profile));
  const sf = signatureFit(hist, root, quality);
  const tb = thirdBalance(hist, root);
  const thirdBonus = quality === 'major' ? Math.max(0, tb) : Math.max(0, -tb);
  const tc = tonicCentrality(hist, root);
  const sd = subdominantSupport(hist, root);
  const lt = leadingToneEvidence(hist, root);

  // Bônus contextuais — só pontuam se o hint bate com o root do candidato
  const cadenceBonus = hints?.lastPhraseEndPc === root ? 1 : 0;
  const firstNoteBonus = hints?.firstStablePc === root ? 1 : 0;
  const longestBonus = hints?.longestSustainedPc === root ? 1 : 0;

  // Prior levíssimo pra maior (literatura ocidental é ~60/40 maior/menor)
  const rmb = quality === 'major' ? 0.03 : 0;

  const score =
    0.15 * p +
    0.10 * sf +
    0.18 * thirdBonus +
    0.22 * tc +
    0.09 * cadenceBonus +
    0.08 * firstNoteBonus +
    0.05 * longestBonus +
    0.05 * sd +
    0.05 * lt +
    rmb;

  return {
    score,
    breakdown: {
      pearson: p,
      signature: sf,
      third: thirdBonus,
      tonicity: tc,
      cadence: cadenceBonus,
      firstNote: firstNoteBonus,
      longest: longestBonus,
    },
  };
}

/**
 * Scoring de TODOS os 24 candidatos (12 maj + 12 min).
 * Usado pelo acumulador bayesiano no hook (EMA para estabilidade).
 */
export function scoreAllKeys(hist: number[], hints?: KeyHints): KeyScoreEntry[] {
  const out: KeyScoreEntry[] = [];
  for (let r = 0; r < 12; r++) {
    const { score: sMaj } = computeKeyScore(hist, r, 'major', hints);
    const { score: sMin } = computeKeyScore(hist, r, 'minor', hints);
    out.push({ root: r, quality: 'major', score: sMaj });
    out.push({ root: r, quality: 'minor', score: sMin });
  }
  return out;
}

/**
 * Detecta tom a partir de um histograma ponderado por duração/clarity.
 * O parâmetro `hints` é fundamental pra resolver ambiguidade maior/relativo-menor.
 */
export function detectKeyFromHistogram(hist: number[], hints?: KeyHints): KeyResult {
  let best: KeyResult = { root: 0, quality: 'major', confidence: -Infinity };

  for (let r = 0; r < 12; r++) {
    const majR = computeKeyScore(hist, r, 'major', hints);
    const minR = computeKeyScore(hist, r, 'minor', hints);

    if (majR.score > best.confidence) {
      best = { root: r, quality: 'major', confidence: majR.score, breakdown: majR.breakdown };
    }
    if (minR.score > best.confidence) {
      best = { root: r, quality: 'minor', confidence: minR.score, breakdown: minR.breakdown };
    }
  }

  return best;
}
