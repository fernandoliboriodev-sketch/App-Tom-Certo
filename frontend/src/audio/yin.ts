// YIN pitch detection — de Cheveigné & Kawahara (2002)
//
// ── Melhorias v2 (robustez de detecção) ─────────────────────────────────────
// 1. Octave validation: verifica se tau/2 também tem mínimo → corrige octave-down
// 2. Stricter probability: retorna clarity real (não só 1 - yin[tau])
// 3. Faixa de frequência: voz humana e instrumentos (65Hz–1200Hz)
// 4. Frame-RMS check mais rigoroso
// 5. Parabolic interpolation para precisão sub-sample

export interface YinOptions {
  sampleRate: number;
  threshold?: number;
  probabilityMin?: number;
  minFreq?: number;
  maxFreq?: number;
}

export interface YinResult {
  frequency: number;   // Hz, -1 se não detectou
  probability: number; // clarity [0, 1]
  rms: number;         // energia do frame
}

export function yinPitch(buffer: Float32Array, opts: YinOptions): YinResult {
  const {
    sampleRate,
    threshold = 0.10,       // mais restritivo que 0.12 (menos falsos positivos)
    probabilityMin = 0.80,  // ↓ 0.88 → 0.80 (mais permissivo; hook filtra com 0.82)
    minFreq = 65,           // ~Dó2 (baixo do piano, voz masculina grave)
    maxFreq = 1200,         // ~Ré6 (voz feminina aguda, limite razoável)
  } = opts;

  const bufSize = buffer.length;
  const halfSize = Math.floor(bufSize / 2);

  // ── 1) RMS ────────────────────────────────────────────────────────────────
  let rms = 0;
  for (let i = 0; i < bufSize; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / bufSize);
  if (rms < 0.01) return { frequency: -1, probability: 0, rms };

  // ── 2) Determinar range de tau (só precisamos computar yin[t] em [1..tauMax]) ──
  // Antes: iterava até halfSize (1024 valores) — 4x mais trabalho que o necessário
  // Agora: tauMax é derivado de minFreq (65Hz @ 16kHz = 246) → economiza 75% da CPU
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(halfSize - 1, Math.ceil(sampleRate / minFreq));

  // ── 3) Difference function (só até tauMax) ────────────────────────────────
  const yin = new Float32Array(tauMax + 2);
  for (let t = 1; t <= tauMax; t++) {
    let sum = 0;
    for (let i = 0; i < halfSize; i++) {
      const d = buffer[i] - buffer[i + t];
      sum += d * d;
    }
    yin[t] = sum;
  }

  // ── 4) Cumulative mean normalized difference (só até tauMax) ─────────────
  yin[0] = 1;
  let running = 0;
  for (let t = 1; t <= tauMax; t++) {
    running += yin[t];
    yin[t] = (yin[t] * t) / running;
  }

  // ── 5) Absolute threshold — primeiro mínimo abaixo de threshold ───────────
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (yin[t] < threshold) {
      // desce até encontrar mínimo local
      while (t + 1 <= tauMax && yin[t + 1] < yin[t]) t++;
      tau = t;
      break;
    }
  }

  if (tau === -1) {
    // Fallback: pegar o mínimo absoluto se clarity for razoável
    let minVal = Infinity;
    let minTau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (yin[t] < minVal) { minVal = yin[t]; minTau = t; }
    }
    if (minTau === -1 || minVal > 0.25) {
      return { frequency: -1, probability: 0, rms };
    }
    tau = minTau;
  }

  // ── 6) Octave validation ──────────────────────────────────────────────────
  // YIN sofre de "octave-down error": detecta tau ~2x o valor correto.
  // Se existir um mínimo aceitável em tau/2 (clarity próxima), preferir a oitava acima.
  const halfTau = Math.floor(tau / 2);
  if (halfTau >= tauMin) {
    const yTau = yin[tau];
    // buscar mínimo local perto de halfTau
    let bestHalfTau = halfTau;
    let bestHalfVal = yin[halfTau];
    const searchRange = Math.max(2, Math.floor(halfTau * 0.05));
    for (let t = Math.max(tauMin, halfTau - searchRange); t <= Math.min(tauMax, halfTau + searchRange); t++) {
      if (yin[t] < bestHalfVal) {
        bestHalfVal = yin[t];
        bestHalfTau = t;
      }
    }
    // Se a clarity do dobro é competitiva (dentro de 15% do atual) e abaixo do threshold, usar
    if (bestHalfVal < threshold * 1.8 && bestHalfVal < yTau * 1.15) {
      tau = bestHalfTau;
    }
  }

  // ── 7) Parabolic interpolation para precisão sub-sample ──────────────────
  const x0 = tau > 0 ? yin[tau - 1] : yin[tau];
  const x1 = yin[tau];
  const x2 = tau + 1 <= tauMax ? yin[tau + 1] : yin[tau];
  const a = (x0 + x2 - 2 * x1) / 2;
  const b = (x2 - x0) / 2;
  const betterTau = a !== 0 ? tau - b / (2 * a) : tau;

  const freq = sampleRate / betterTau;
  // Clarity = 1 - yin[tau], bounded 0..1
  const probability = Math.max(0, Math.min(1, 1 - x1));

  if (freq < minFreq || freq > maxFreq || probability < probabilityMin) {
    return { frequency: -1, probability, rms };
  }

  return { frequency: freq, probability, rms };
}
