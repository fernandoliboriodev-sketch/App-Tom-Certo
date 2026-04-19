// Musical note utilities — Brazilian (default) + International notation
export const NOTES_BR = [
  'Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá',
  'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si',
] as const;

export const NOTES_INTL = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export function frequencyToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

export function midiToPitchClass(midi: number): PitchClass {
  return (((midi % 12) + 12) % 12) as PitchClass;
}

export function formatKeyDisplay(root: number, quality: 'major' | 'minor') {
  return {
    noteBr: NOTES_BR[root],
    noteIntl: NOTES_INTL[root],
    qualityLabel: quality === 'major' ? 'maior' : 'menor',
    fullLabel: `${NOTES_BR[root]} ${quality === 'major' ? 'maior' : 'menor'}`,
  };
}

const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9] as const;
const MAJOR_QUAL = ['major', 'minor', 'minor', 'major', 'major', 'minor'] as const;
const MINOR_OFFSETS = [0, 2, 3, 5, 7, 8] as const;
const MINOR_QUAL = ['minor', 'dim', 'major', 'minor', 'minor', 'major'] as const;

export interface HarmonicChord {
  root: number;
  quality: 'major' | 'minor' | 'dim';
  noteBr: string;
  noteIntl: string;
  label: string;
  isTonic: boolean;
}

export function getHarmonicField(root: number, quality: 'major' | 'minor'): HarmonicChord[] {
  const offsets = (quality === 'major' ? MAJOR_OFFSETS : MINOR_OFFSETS) as readonly number[];
  const quals = (quality === 'major' ? MAJOR_QUAL : MINOR_QUAL) as readonly string[];

  return offsets.map((offset, i) => {
    const chordRoot = (root + offset) % 12;
    const chordQuality = quals[i] as 'major' | 'minor' | 'dim';
    const noteBr = NOTES_BR[chordRoot];
    const noteIntl = NOTES_INTL[chordRoot];
    const suffix = chordQuality === 'minor' ? ' m' : chordQuality === 'dim' ? ' °' : '';
    return {
      root: chordRoot,
      quality: chordQuality,
      noteBr,
      noteIntl,
      label: `${noteBr}${suffix}`,
      isTonic: i === 0,
    };
  });
}
