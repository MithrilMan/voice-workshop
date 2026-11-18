/**
 * Songs and ensembles to try the singing and the beatbox with: all
 * traditional or long out of copyright (the round "Frère Jacques" in four
 * of its languages, Beethoven's tune on Schiller's words, scales), and
 * chords written here (the beats are the library's BEAT_PATTERNS).
 */

export interface SongPreset {
  id: string;
  name: string;
  notes: string;
  lyrics: string;
  lang: string;
  tempo: number;
  /** semitones for a low voice (a man's): his octave */
  low?: number;
  hint: string;
}

const ROUND = 'F4 G4 A4 F4 | F4 G4 A4 F4 | A4 Bb4 C5:2 | A4 Bb4 C5:2 | C5:0.5 D5:0.5 C5:0.5 Bb4:0.5 A4 F4 | C5:0.5 D5:0.5 C5:0.5 Bb4:0.5 A4 F4 | F4 C4 F4:2 | F4 C4 F4:2';
const ODE = 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2';

export const SONGS: readonly SongPreset[] = [
  { id: 'martino', name: 'Fra Martino (Italian)', notes: ROUND, lang: 'it', tempo: 110, low: -12, hint: 'the round, in Italian',
    lyrics: 'Fra Martino campanaro, dormi tu? Dormi tu? Suona le campane, suona le campane, din don dan, din don dan.' },
  { id: 'jacques', name: 'Frère Jacques (French)', notes: ROUND, lang: 'fr', tempo: 110, low: -12, hint: 'in French, written in IPA: sung French says the final e that speech drops',
    lyrics: '[fʁɛʁə ʒakə fʁɛʁə ʒakə dɔʁme vu dɔʁme vu sɔne le matinə sɔne le matinə diŋ daŋ dɔŋ diŋ daŋ dɔŋ]' },
  { id: 'jakob', name: 'Bruder Jakob (German)', notes: ROUND, lang: 'de', tempo: 110, low: -12, hint: 'in German',
    lyrics: 'Bruder Jakob, Bruder Jakob, schläfst du noch? Schläfst du noch? Hörst du nicht die Glocken? Hörst du nicht die Glocken? Ding, dang, dong. Ding, dang, dong.' },
  { id: 'john', name: 'Are you sleeping (English)', notes: ROUND, lang: 'en', tempo: 110, low: -12, hint: 'in English',
    lyrics: 'Are you sleeping, are you sleeping, Brother John, Brother John? Morning bells are ringing, morning bells are ringing, ding, dang, dong. Ding, dang, dong.' },
  { id: 'freude', name: 'Ode to Joy (German)', notes: ODE, lang: 'de', tempo: 96, low: -12, hint: 'Beethoven’s tune on Schiller’s words',
    lyrics: 'Freude, schöner Götterfunken, Tochter aus Elysium, wir betreten feuertrunken, Himmlische, dein Heiligtum!' },
  { id: 'scale', name: 'A scale on “la”', notes: 'C4 D4 E4 F4 G4 A4 B4 C5:2 | B4 A4 G4 F4 E4 D4 C4:2', lang: 'it', tempo: 100, low: -12, hint: 'one syllable on every note',
    lyrics: 'la la la la la la la la la la la la la la la' },
  { id: 'arpeggio', name: 'An arpeggio on one vowel', notes: 'C4 E4 G4 C5:2 ~G4 ~E4 ~C4:2', lang: 'it', tempo: 90, low: -12, hint: 'one “a” held over all the notes (a melisma: ~ goes on with the syllable)',
    lyrics: '' },
];

/** an ensemble part: a song (by preset, moved by semitones) or a beat (one of the library's BEAT_PATTERNS), by a voice */
export interface PartPreset {
  name: string;
  voice: string;
  song?: string;
  /** notes and words of its own, in place of a preset's */
  notes?: string;
  lyrics?: string;
  lang?: string;
  vowel?: string;
  transpose?: number;
  beat?: string;
  startBeat: number;
  gain: number;
  pan: number;
}

export interface EnsemblePreset { id: string; name: string; tempo: number; room: number; repeat?: number; swing?: number; parts: PartPreset[]; hint: string }

// four voices on a chord progression (C, A minor, F, G, C), each a line of its own
const CHORDS = {
  s: 'G4:4 A4:4 A4:4 B4:4 C5:4', a: 'E4:4 E4:4 F4:4 D4:4 E4:4', t: 'C4:4 C4:4 C4:4 B3:4 C4:4', b: 'C3:4 A2:4 F2:4 G2:4 C3:4',
};
// a groove in A minor: A minor, F, C, G, a bar each
const GROOVE = {
  bass: 'A2:0.5 r:0.5 A2:0.5 A2:0.5 r:1 A2:0.5 G2:0.5 | F2:0.5 r:0.5 F2:0.5 F2:0.5 r:1 F2:0.5 G2:0.5 | C3:0.5 r:0.5 C3:0.5 C3:0.5 r:1 C3:0.5 B2:0.5 | G2:0.5 r:0.5 G2:0.5 G2:0.5 r:1 G2:0.5 A2:0.5',
  hi: 'E4:2 E4:2 | F4:2 F4:2 | E4:2 G4:2 | D4:2 D4:2',
  mid: 'C4:2 C4:2 | C4:2 A3:2 | G3:2 C4:2 | B3:2 B3:2',
};

export const ENSEMBLES: readonly EnsemblePreset[] = [
  { id: 'round', name: 'Frère Jacques: a round in four languages', tempo: 110, room: 0.22, hint: 'four voices come in two bars apart, each in its own language',
    parts: [
      { name: 'Italian', voice: 'woman', song: 'martino', startBeat: 0, gain: 0, pan: -0.6 },
      { name: 'French', voice: 'man', song: 'jacques', transpose: -12, startBeat: 8, gain: 0, pan: 0.6 },
      { name: 'German', voice: 'child', song: 'jakob', startBeat: 16, gain: -1, pan: -0.2 },
      { name: 'English', voice: 'deep', song: 'john', transpose: -12, startBeat: 24, gain: 1, pan: 0.2 },
    ] },
  { id: 'chords', name: 'Four voices, one chord at a time', tempo: 72, room: 0.3, hint: 'soprano, alto, tenor and bass hold a progression on “oo”',
    parts: [
      { name: 'Soprano', voice: 'woman', notes: CHORDS.s, vowel: 'u', startBeat: 0, gain: -2, pan: -0.5 },
      { name: 'Alto', voice: 'warm', notes: CHORDS.a, vowel: 'u', startBeat: 0, gain: 0, pan: -0.15 },
      { name: 'Tenor', voice: 'man', notes: CHORDS.t, vowel: 'u', startBeat: 0, gain: 0, pan: 0.15 },
      { name: 'Bass', voice: 'deep', notes: CHORDS.b, vowel: 'u', startBeat: 0, gain: 2, pan: 0.5 },
    ] },
  { id: 'groove', name: 'A band of mouths', tempo: 92, room: 0.15, repeat: 4, swing: 0.2, hint: 'a bass voice on “dum”, two voices on the chords, a beatboxer',
    parts: [
      { name: 'Bass', voice: 'deep', notes: GROOVE.bass, lyrics: 'dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum dum', lang: 'it', startBeat: 0, gain: 2, pan: 0 },
      { name: 'High', voice: 'woman', notes: GROOVE.hi, vowel: 'u', startBeat: 0, gain: -3, pan: -0.45 },
      { name: 'Middle', voice: 'man', notes: GROOVE.mid, vowel: 'u', startBeat: 0, gain: -3, pan: 0.45 },
      { name: 'Beatbox', voice: 'man', beat: 'boombap', startBeat: 0, gain: 0, pan: 0 },
    ] },
];
