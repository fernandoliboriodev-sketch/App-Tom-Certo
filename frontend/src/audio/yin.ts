// Simplified YIN pitch detection algorithm
// Reference: de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator"

export interface YinOptions {
  sampleRate: number;
  threshold?: number;
  probabilityMin?: number;
}

export interface YinResult {
  frequency: number;
  probability: number;
  rms: number;
}

export function yinPitch(buffer: Float32Array, opts: YinOptions): YinResult {
  const { sampleRate, threshold = 0.12, probabilityMin = 0.85 } = opts;
  const bufSize = buffer.length;
  const halfSize = Math.floor(bufSize / 2);

  let rms = 0;
  for (let i = 0; i < bufSize; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / bufSize);
  if (rms < 0.01) return { frequency: -1, probability: 0, rms };

  const yin = new Float32Array(halfSize);

  for (let t = 1; t < halfSize; t++) {
    let sum = 0;
    for (let i = 0; i < halfSize; i++) {
      const d = buffer[i] - buffer[i + t];
      sum += d * d;
    }
    yin[t] = sum;
  }

  yin[0] = 1;
  let running = 0;
  for (let t = 1; t < halfSize; t++) {
    running += yin[t];
    yin[t] = (yin[t] * t) / running;
  }

  let tau = -1;
  for (let t = 2; t < halfSize; t++) {
    if (yin[t] < threshold) {
      while (t + 1 < halfSize && yin[t + 1] < yin[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return { frequency: -1, probability: 0, rms };

  const x0 = tau > 0 ? yin[tau - 1] : yin[tau];
  const x1 = yin[tau];
  const x2 = tau + 1 < halfSize ? yin[tau + 1] : yin[tau];
  const a = (x0 + x2 - 2 * x1) / 2;
  const b = (x2 - x0) / 2;
  const betterTau = a !== 0 ? tau - b / (2 * a) : tau;

  const freq = sampleRate / betterTau;
  const probability = 1 - yin[tau];

  if (freq < 60 || freq > 1500 || probability < probabilityMin) {
    return { frequency: -1, probability, rms };
  }
  return { frequency: freq, probability, rms };
}
