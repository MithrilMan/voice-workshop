/**
 * Beats to start from, in many styles, written as text (see parseBeat):
 * one bar of sixteen steps, sixteenth notes, each line a layer.
 */
export interface BeatPattern {
  id: string;
  name: string;
  tempo: number;
  /** the late second step of each pair (see BeatOptions) */
  swing?: number;
  beat: string;
  hint: string;
}

export const BEAT_PATTERNS: readonly BeatPattern[] = [
  {
    id: 'boots', name: 'Boots and cats', tempo: 100, hint: 'the first beat every beatboxer learns: kick, hi-hat, snare, hi-hat',
    beat: `> b  .  ts .  pf .  ts .  b  .  ts .  pf .  ts .`,
  },
  {
    id: 'breathing', name: 'Breathing beat', tempo: 96, hint: 'inward snares and hi-hats: one mouth breathes in while it plays',
    beat: `> b  .  ts .  ^k .  ts .  b  b  ts .  ^k .  ^ts .`,
  },
  {
    id: 'boombap', name: 'Boom bap', tempo: 90, swing: 0.3, hint: 'hip-hop of the nineties: a lazy kick, a hard snare, swung hi-hats',
    beat: `> b  .  .  .  pf! .  .  b  .  .  b  .  pf! .  .  .
> t  .  t  .  t  .  t  .  t  .  t  .  t  .  t  .`,
  },
  {
    id: 'trap', name: 'Trap', tempo: 140, hint: 'long 808 kicks, a clap on the third beat, hi-hats that stutter',
    beat: `> b8 .  .  .  .  .  .  .  .  .  b8 .  .  .  .  .
> .  .  .  .  .  .  .  .  cl! .  .  .  .  .  .  .
> ts .  ts .  ts .  ts ts ts .  ts .  ts ts ts ts`,
  },
  {
    id: 'house', name: 'House', tempo: 124, hint: 'four on the floor, open hi-hats between the kicks',
    beat: `> b  .  .  .  b  .  .  .  b  .  .  .  b  .  .  .
> .  .  tss .  .  .  tss .  .  .  tss .  .  .  tss .
> .  .  .  .  cl .  .  .  .  .  .  .  cl .  .  .`,
  },
  {
    id: 'dnb', name: 'Drum and bass', tempo: 172, hint: 'fast: a kick, a snare, a kick late in the bar, a snare',
    beat: `> b  .  .  .  pf! .  .  .  .  .  b  .  pf! .  .  .
> ts .  ts .  ts .  ts .  ts .  ts .  ts .  ts ts`,
  },
  {
    id: 'dembow', name: 'Dembow', tempo: 95, hint: 'the reggaeton rhythm: a kick on every beat and a rim that answers it',
    beat: `> b  .  .  .  b  .  .  .  b  .  .  .  b  .  .  .
> .  .  .  k  .  .  k  .  .  .  .  k  .  .  k  .`,
  },
  {
    id: 'funk', name: 'Funk', tempo: 100, swing: 0.15, hint: 'kicks off the beat and soft ghost notes on the snare',
    beat: `> b  .  .  b  .  .  b  .  .  .  b  .  .  .  .  .
> .  .  .  .  pf .  .  pf? .  pf? .  .  pf .  .  pf?
> t  .  t  .  t  .  t  .  t  .  t  .  t  .  t  .`,
  },
  {
    id: 'rock', name: 'Rock', tempo: 110, hint: 'a straight backbeat, a crash on the first beat',
    beat: `> b  .  .  .  pf! .  .  .  b  .  b  .  pf! .  .  .
> cr .  ts .  ts .  ts .  ts .  ts .  ts .  ts .`,
  },
  {
    id: 'halftime', name: 'Half time', tempo: 140, hint: 'a kick, a heavy snare on the third beat, lip bass between them',
    beat: `> b  .  .  .  .  .  .  .  pf! .  .  .  .  .  .  .
> .  .  bb .  bb .  .  .  .  .  bb .  bb .  bb .`,
  },
  {
    id: 'clicks', name: 'Clicks', tempo: 104, hint: 'clicks of the tongue and lips, with a hum under them',
    beat: `> po .  ck .  tt .  ck cu po .  ck .  tt .  dr .
> m:A1 .  .  .  .  .  .  .  m:C2 .  .  .  .  .  .  .`,
  },
  {
    id: 'bassline', name: 'Bass line', tempo: 100, hint: 'a hummed bass line on notes, under kicks and clicks',
    beat: `> b  .  m:C2 .  ck .  m:C2 .  b  .  m:Eb2 .  ck .  m:F2 .`,
  },
  {
    id: 'tricks', name: 'Tricks', tempo: 98, hint: 'a lip roll, a scratch, a zip and a laser over a plain beat',
    beat: `> b  .  ts .  pf .  ts .  b  .  ts .  pf .  lz .
> .  .  .  .  .  .  sc .  .  lr .  .  .  zp .  .`,
  },
];
