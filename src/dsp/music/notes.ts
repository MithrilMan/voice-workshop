/**
 * Notes to sing, written as plain text: a note name with its octave
 * (C4 is middle C, A4 is 440 Hz; # sharp, b flat), a length in beats after a
 * colon (1 when none; 2, 0.5, 1/2, 1.5 ...), `r` for a rest. A note that
 * starts with `~` goes on with the syllable of the note before it (a
 * melisma). Bar lines `|` and line breaks are only for the eye.
 *
 *   C4 D4 E4 C4 | E4 F4 G4:2 | r:1 ~A4:0.5 G4:0.5
 */
export interface Note {
  /** the pitch as a MIDI number (60 = C4, 69 = A4 = 440 Hz), null for a rest */
  midi: number | null;
  /** length, beats */
  beats: number;
  /** goes on with the syllable of the note before (a melisma) */
  tie?: boolean;
  /** loudness of the note, 0.5 soft .. 1 as usual .. 1.5 loud */
  velocity?: number;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** a note name (C4, F#3, Bb5) as a MIDI number, or null if it is not one */
export function noteNumber(name: string): number | null {
  const m = /^([A-Ga-g])(#|b|♯|♭)?(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + STEP[m[1].toUpperCase()] + acc;
}

/** the frequency of a MIDI number, Hz */
export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** the name of a MIDI number (sharps) */
export function noteName(m: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

function beatsOf(s: string): number {
  const f = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
  const v = f ? Number(f[1]) / Number(f[2]) : Number(s);
  if (!(v > 0) || v > 64) throw new Error(`not a length in beats: "${s}"`);
  return v;
}

/** Reads notes written as text (see above); throws on a word that is not a note, naming it. */
export function parseNotes(text: string): Note[] {
  const out: Note[] = [];
  for (const raw of text.split(/[\s|]+/)) {
    if (!raw) continue;
    const tie = raw.startsWith('~');
    const [name, len] = (tie ? raw.slice(1) : raw).split(':');
    const beats = len === undefined || len === '' ? 1 : beatsOf(len);
    if (/^(r|rest|-)$/i.test(name)) { out.push({ midi: null, beats }); continue; }
    const midi = noteNumber(name);
    if (midi === null) throw new Error(`not a note: "${raw}"`);
    out.push(tie ? { midi, beats, tie } : { midi, beats });
  }
  return out;
}

/** Notes moved by some semitones (rests stay). */
export const transpose = (notes: readonly Note[], semitones: number): Note[] =>
  notes.map((n) => (n.midi === null || !semitones ? { ...n } : { ...n, midi: n.midi + semitones }));

/** How long the notes last, beats. */
export const beatsLong = (notes: readonly Note[]): number => notes.reduce((a, n) => a + n.beats, 0);
