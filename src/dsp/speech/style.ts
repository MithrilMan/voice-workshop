/**
 * A speaker's way of speaking, beyond the sounds: how the melody of a phrase
 * moves, how long the pauses are, how much an accent is pushed and how a
 * phrase ends. The defaults are the planner's own values, the ones every
 * voice used before it had a style of its own.
 */
export interface ProsodyStyle {
  /** how far below the usual pitch a phrase may fall, semitones (Fujisaki's floor) */
  floor: number;
  /** strength of the phrase commands, the rise and slow fall of pitch over each phrase (1 = usual) */
  phrase: number;
  /** each accent of a phrase this much of the one before (downstep) ... */
  downstep: number;
  /** ... but never lower than this much of the first */
  downstepFloor: number;
  /** final lowering of a statement, semitones */
  finalFall: number;
  /** final rise of a yes/no question, semitones */
  questionRise: number;
  /** small rise before a comma (continuation), semitones */
  continuation: number;
  /** microprosody: the intrinsic pitch of vowels and the push of the consonant before (1 = usual) */
  micro: number;
  /** slow random wander of the pitch (Klatt's flutter, 0..100) */
  flutter: number;
  /** pause at a full stop and at a comma, s */
  pauseLong: number;
  pauseShort: number;
  /** lengthening of the last syllable of a phrase (1 = usual, 0 = none) */
  finalLengthening: number;
  /** fall of the lung pressure over the utterance, share */
  declination: number;
  /** extra lung pressure, and a tenser voice (less Rd), on accented syllables */
  stressPs: number;
  stressRd: number;
  /** how a phrase ends: over its last stretch (s) the pressure falls by a share and the voice gets breathier (more Rd) */
  endWindow: number;
  endPs: number;
  endRd: number;
}

/** one semitone in log units of F0 */
export const ST = Math.LN2 / 12;

export const DEFAULT_STYLE: Readonly<ProsodyStyle> = Object.freeze({
  floor: 4,
  phrase: 1,
  downstep: 0.9,
  downstepFloor: 0.6,
  finalFall: 0.13 / ST,
  questionRise: 0.5 / ST,
  continuation: 0.13 / ST,
  micro: 1,
  flutter: 25,
  pauseLong: 0.3,
  pauseShort: 0.16,
  finalLengthening: 1,
  declination: 0.12,
  stressPs: 0.14,
  stressRd: 0.12,
  endWindow: 0.28,
  endPs: 0.18,
  endRd: 0.55,
});

/** a style with every field, from a partial one */
export const styleOf = (s?: Partial<ProsodyStyle>): ProsodyStyle => ({ ...DEFAULT_STYLE, ...(s ?? {}) });

/** a lengthening factor f (1.4: 40 % longer) made stronger or weaker by the style */
export const lengthen = (f: number, st: ProsodyStyle): number => 1 + (f - 1) * st.finalLengthening;
