// ═══════════════════════════════════════════════════════════════════════════
// Tom Certo — Phrase-Based Key Detector v5 (DEFINITIVO)
// ═══════════════════════════════════════════════════════════════════════════
// Em vez de analisar notas como histograma estatístico, analisa FRASES
// MELÓDICAS — é assim que o humano percebe a tonalidade.
//
// Resolve a confusão maior/relativo menor (ex: Ré Maior vs Fá# menor) porque
// é praticamente impossível alguém cantar Ré Maior e RESOLVER a frase em F#.
// Cadência humana sempre retorna à tônica. Essa é a pista mais confiável.
//
// Arquitetura em 3 camadas:
//   1) Segmentação em frases (silêncios ≥ 300ms OU notas sustentadas ≥ 1.5s)
//   2) Cada frase VOTA na tônica (peso 5× cadência, 2× primeira, 1.5× longest)
//   3) Qualidade (maj/min) só depois da tônica estável (3ª grade das notas)
//
// Regras de estabilidade:
//   - Tally acumula, mas decai 15% a cada frase (recency > histórico)
//   - Contradição não "troca" tom — reduz confiança gradualmente
//   - Stage só avança quando critérios CUMULATIVOS são atendidos
// ═══════════════════════════════════════════════════════════════════════════

export const NOTE_NAMES_BR = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];

// ─── Constantes de segmentação ────────────────────────────────────────
export const SILENCE_END_PHRASE_MS = 300;   // silêncio pra fechar frase
export const LEGATO_SUSTAINED_MS = 1500;    // fallback: nota sustentada = frase
export const MIN_NOTE_DUR_MS = 120;         // nota precisa durar ≥ isso pra contar
export const MIN_PHRASE_DUR_MS = 500;       // frase precisa ter ≥ isso
export const MIN_NOTES_PER_PHRASE = 2;
export const MIN_CADENCE_DUR_MS = 220;      // última nota precisa ≥ isso pra ser cadência

// ─── Pesos de votação ─────────────────────────────────────────────────
export const VOTE_CADENCE = 5.0;
export const VOTE_FIRST_STABLE = 2.0;
export const VOTE_LONGEST = 1.5;

// ─── Estabilidade / decay ─────────────────────────────────────────────
export const TALLY_DECAY = 0.85;            // tally antigo mantém 85% a cada nova frase
export const STAGE_PROBABLE_MIN_CONF = 0.20;
export const STAGE_CONFIRMED_MIN_CONF = 0.40;
export const STAGE_DEFINITIVE_MIN_CONF = 0.55;
export const STAGE_DEFINITIVE_MIN_QUALITY_MARGIN = 1.3;

export type DetectionStage = 'listening' | 'probable' | 'confirmed' | 'definitive';

export interface DetectedNoteEvent {
  pitchClass: number;  // 0..11
  midi: number;
  timestamp: number;   // ms since detector start
  durMs: number;
  rmsAvg: number;
}

export interface Phrase {
  notes: DetectedNoteEvent[];
  startMs: number;
  endMs: number;
  durMs: number;
  firstStablePc: number | null;
  lastSustainedPc: number | null;
  longestPc: number | null;
}

export interface KeyDetectionState {
  phrases: Phrase[];
  tonicTally: number[];         // [12] acumulado + decaído
  noteDurHist: number[];        // [12] duração total de cada pc (para qualidade)
  currentTonicPc: number | null;
  tonicConfidence: number;      // 0..1
  quality: 'major' | 'minor' | null;
  qualityMargin: number;        // razão M3/m3 ou m3/M3
  stage: DetectionStage;
}

// ── Inicialização ────────────────────────────────────────────────────
export function createInitialState(): KeyDetectionState {
  return {
    phrases: [],
    tonicTally: new Array(12).fill(0),
    noteDurHist: new Array(12).fill(0),
    currentTonicPc: null,
    tonicConfidence: 0,
    quality: null,
    qualityMargin: 0,
    stage: 'listening',
  };
}

// ── Constrói uma frase a partir de eventos de nota ───────────────────
// Filtra notas muito curtas; retorna null se a frase não for válida.
export function buildPhrase(notes: DetectedNoteEvent[]): Phrase | null {
  // Filtra notas muito curtas
  const valid = notes.filter(n => n.durMs >= MIN_NOTE_DUR_MS);
  if (valid.length < MIN_NOTES_PER_PHRASE) return null;

  const startMs = valid[0].timestamp;
  const lastN = valid[valid.length - 1];
  const endMs = lastN.timestamp + lastN.durMs;
  const durMs = endMs - startMs;
  if (durMs < MIN_PHRASE_DUR_MS) return null;

  // First stable: primeira nota com duração ≥ 180ms (voz estabilizada)
  let firstStablePc: number | null = null;
  for (const n of valid) {
    if (n.durMs >= 180) { firstStablePc = n.pitchClass; break; }
  }
  if (firstStablePc === null) firstStablePc = valid[0].pitchClass;

  // Last sustained (cadência): última nota com durMs ≥ MIN_CADENCE_DUR_MS
  let lastSustainedPc: number | null = null;
  for (let i = valid.length - 1; i >= 0; i--) {
    if (valid[i].durMs >= MIN_CADENCE_DUR_MS) {
      lastSustainedPc = valid[i].pitchClass;
      break;
    }
  }
  // Fallback: última nota da frase
  if (lastSustainedPc === null) lastSustainedPc = valid[valid.length - 1].pitchClass;

  // Longest: nota mais longa da frase
  let longestPc: number | null = null;
  let maxDur = 0;
  for (const n of valid) {
    if (n.durMs > maxDur) { maxDur = n.durMs; longestPc = n.pitchClass; }
  }

  return { notes: valid, startMs, endMs, durMs, firstStablePc, lastSustainedPc, longestPc };
}

// ── Computa votos de uma frase (pc → peso) ──────────────────────────
function votesFromPhrase(phrase: Phrase): number[] {
  const votes = new Array(12).fill(0);
  if (phrase.lastSustainedPc !== null) votes[phrase.lastSustainedPc] += VOTE_CADENCE;
  if (phrase.firstStablePc !== null) votes[phrase.firstStablePc] += VOTE_FIRST_STABLE;
  if (phrase.longestPc !== null) votes[phrase.longestPc] += VOTE_LONGEST;
  return votes;
}

// ── Atualiza noteDurHist com as notas da frase ──────────────────────
function updateNoteDurHist(hist: number[], phrase: Phrase): number[] {
  const out = hist.slice();
  for (const n of phrase.notes) {
    out[n.pitchClass] += n.durMs;
  }
  return out;
}

// ── Determina qualidade (maj/min) a partir do histograma ────────────
// Retorna { quality, margin }. Margem = razão do dominante sobre o outro.
function determineQuality(
  noteDurHist: number[],
  tonicPc: number
): { quality: 'major' | 'minor'; margin: number } {
  const M3 = noteDurHist[(tonicPc + 4) % 12];
  const m3 = noteDurHist[(tonicPc + 3) % 12];
  const leadingTone = noteDurHist[(tonicPc + 11) % 12];     // 7ª maior (maj/harm min)
  const minorSeventh = noteDurHist[(tonicPc + 10) % 12];    // 7ª menor (minor natural)

  // Se não há informação de 3ª, decide pela 7ª; se nenhuma, default MAJOR
  const total3rd = M3 + m3;
  if (total3rd < 50) {
    // 3ª quase não cantada → usa 7ª
    if (leadingTone > minorSeventh * 1.2) return { quality: 'major', margin: 1.5 };
    if (minorSeventh > leadingTone * 1.2) return { quality: 'minor', margin: 1.5 };
    return { quality: 'major', margin: 1.0 }; // default
  }

  // 3ª é decisivo
  const majRatio = M3 / (m3 + 1e-6);
  const minRatio = m3 / (M3 + 1e-6);

  if (majRatio >= 1.15) return { quality: 'major', margin: majRatio };
  if (minRatio >= 1.15) return { quality: 'minor', margin: minRatio };

  // Ambíguo → prior pra major (música ocidental ~60% maior)
  return { quality: 'major', margin: 1.0 };
}

// ── Determina stage com base no estado cumulativo ───────────────────
function determineStage(s: {
  phraseCount: number;
  tonicConfidence: number;
  qualityMargin: number;
  lastPhrasesAgree: boolean; // últimas 2 frases concordam na tônica?
  lastThreePhrasesAgree: boolean;
}): DetectionStage {
  if (s.phraseCount === 0) return 'listening';

  // Provável: ≥1 frase e confiança razoável
  if (s.phraseCount >= 1 && s.tonicConfidence >= STAGE_PROBABLE_MIN_CONF) {
    // Confirmada: ≥2 frases, confiança maior, e últimas 2 concordam
    if (s.phraseCount >= 2 && s.tonicConfidence >= STAGE_CONFIRMED_MIN_CONF && s.lastPhrasesAgree) {
      // Definitivo: ≥3 frases, confiança alta, 3 últimas concordam, qualidade margem OK
      if (
        s.phraseCount >= 3 &&
        s.tonicConfidence >= STAGE_DEFINITIVE_MIN_CONF &&
        s.lastThreePhrasesAgree &&
        s.qualityMargin >= STAGE_DEFINITIVE_MIN_QUALITY_MARGIN
      ) {
        return 'definitive';
      }
      return 'confirmed';
    }
    return 'probable';
  }

  return 'listening';
}

// ── Integra uma nova frase ao estado ────────────────────────────────
// Esta é a função central: recebe phrase, atualiza tally com decay,
// calcula tônica atual, confiança, qualidade e stage.
export function ingestPhrase(state: KeyDetectionState, phrase: Phrase): KeyDetectionState {
  // 1) Decay do tally anterior (recency bias — frases antigas perdem peso)
  const decayed = state.tonicTally.map(v => v * TALLY_DECAY);

  // 2) Adiciona votos da nova frase
  const votes = votesFromPhrase(phrase);
  const newTally = decayed.map((v, i) => v + votes[i]);

  // 3) Atualiza histograma de duração (para análise de qualidade)
  const newDurHist = updateNoteDurHist(state.noteDurHist, phrase);

  // 4) Encontra tônica candidata (top do tally)
  let topPc = 0;
  let topWeight = -Infinity;
  let sumWeight = 0;
  for (let pc = 0; pc < 12; pc++) {
    sumWeight += newTally[pc];
    if (newTally[pc] > topWeight) {
      topWeight = newTally[pc];
      topPc = pc;
    }
  }

  // 5) Confiança = ratio top / total  (0..1)
  const tonicConfidence = sumWeight > 0 ? topWeight / sumWeight : 0;

  // 6) Qualidade (só faz sentido calcular se já há tônica candidata)
  const qr = determineQuality(newDurHist, topPc);

  // 7) Frases pra avaliar stage
  const newPhrases = [...state.phrases, phrase];

  // Últimas 2 frases concordam? (top-vote pc de cada frase é igual ao topPc atual?)
  const lastPhrasesAgree = (() => {
    if (newPhrases.length < 2) return false;
    const lp = newPhrases[newPhrases.length - 1];
    const pp = newPhrases[newPhrases.length - 2];
    return lp.lastSustainedPc === topPc && pp.lastSustainedPc === topPc;
  })();

  // Últimas 3 concordam?
  const lastThreePhrasesAgree = (() => {
    if (newPhrases.length < 3) return false;
    return (
      newPhrases[newPhrases.length - 1].lastSustainedPc === topPc &&
      newPhrases[newPhrases.length - 2].lastSustainedPc === topPc &&
      newPhrases[newPhrases.length - 3].lastSustainedPc === topPc
    );
  })();

  const stage = determineStage({
    phraseCount: newPhrases.length,
    tonicConfidence,
    qualityMargin: qr.margin,
    lastPhrasesAgree,
    lastThreePhrasesAgree,
  });

  return {
    phrases: newPhrases,
    tonicTally: newTally,
    noteDurHist: newDurHist,
    currentTonicPc: topPc,
    tonicConfidence,
    quality: stage === 'listening' ? null : qr.quality,
    qualityMargin: qr.margin,
    stage,
  };
}

// ── Helpers pra UI ──────────────────────────────────────────────────
export function keyName(root: number, quality: 'major' | 'minor'): string {
  return quality === 'major'
    ? `${NOTE_NAMES_BR[root]} Maior`
    : `${NOTE_NAMES_BR[root]} menor`;
}

// Campo harmônico (acordes diatônicos I-ii-iii-IV-V-vi-vii°) em pt-BR
export function harmonicFieldNames(root: number, quality: 'major' | 'minor'): string[] {
  const intervals = quality === 'major'
    ? [0, 2, 4, 5, 7, 9, 11]
    : [0, 2, 3, 5, 7, 8, 10];
  const qualities = quality === 'major'
    ? ['', 'm', 'm', '', '', 'm', '°']
    : ['m', '°', '', 'm', 'm', '', ''];
  return intervals.map((iv, i) => `${NOTE_NAMES_BR[(root + iv) % 12]}${qualities[i]}`);
}
