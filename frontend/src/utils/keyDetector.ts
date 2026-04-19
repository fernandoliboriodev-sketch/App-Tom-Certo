// Krumhansl-Schmuckler key-finding algorithm
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const xd = x[i] - mx;
    const yd = y[i] - my;
    num += xd * yd;
    dx2 += xd * xd;
    dy2 += yd * yd;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

export interface KeyResult {
  root: number;
  quality: 'major' | 'minor';
  confidence: number;
}

export function detectKeyFromHistogram(histogram: number[]): KeyResult {
  let best: KeyResult = { root: 0, quality: 'major', confidence: -Infinity };

  for (let root = 0; root < 12; root++) {
    const maj = Array.from({ length: 12 }, (_, i) => KK_MAJOR[(i - root + 12) % 12]);
    const min = Array.from({ length: 12 }, (_, i) => KK_MINOR[(i - root + 12) % 12]);

    const majCorr = pearson(histogram, maj);
    const minCorr = pearson(histogram, min);

    if (majCorr > best.confidence) best = { root, quality: 'major', confidence: majCorr };
    if (minCorr > best.confidence) best = { root, quality: 'minor', confidence: minCorr };
  }

  return best;
}
