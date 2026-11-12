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
  /**
   * the longest stretch one arc of the melody carries, s: a phrase that runs longer without a pause starts its
   * melody again inside it, at a break before a function word (0 = never: only a pause starts an arc)
   */
  phraseSpan: number;
  /** each accent of a phrase this much of the one before (downstep) ... */
  downstep: number;
  /** ... but never lower than this much of the first */
  downstepFloor: number;
  /** final lowering of a statement, semitones */
  finalFall: number;
  /** final rise of a yes/no question, semitones */
  questionRise: number;
  /** small rise before a comma (continuation), semitones; below zero the voice falls there */
  continuation: number;
  /**
   * how far the high of an accent that is not the last of its phrase is held past its stressed vowel, toward the
   * end of the next vowel of the phrase (0 = it ends with the stressed vowel, 1 = with the next one); not onto
   * the one vowel between two accents, where the voice comes down before it rises again
   */
  peakDelay: number;
  /**
   * where the last accent of a statement stands (Italian): 0 = high before the stressed syllable and falling
   * onto it, 1 = rising on the stressed vowel like the accents before it, and falling after it
   */
  nuclearPeak: number;
  /**
   * how much of the final rise of a yes/no question is a rise on its last stress and a fall after it instead
   * (0 = the question rises at its end, 1 = it rises on its last stress and falls)
   */
  questionRiseFall: number;
  /** microprosody: the intrinsic pitch of vowels and the push of the consonant before (1 = usual) */
  micro: number;
  /** slow random wander of the pitch (Klatt's flutter, 0..100) */
  flutter: number;
  /** pause at a full stop and at a comma, s */
  pauseLong: number;
  pauseShort: number;
  /** lengthening of the last syllable of a phrase (1 = usual, 0 = none) */
  finalLengthening: number;
  /**
   * the slowing down at the end of a phrase reaches back to the stress of its last word, where that is not on
   * its last syllable («mare», «stelle»): the stressed vowel this much longer (0.5: half as long again), the
   * sounds between it and the last vowel half as much (0 = only the last syllable lengthens)
   */
  lastStressLengthening: number;
  /** fall of the lung pressure over the utterance, share */
  declination: number;
  /** extra lung pressure, and a tenser voice (less Rd), on accented syllables */
  stressPs: number;
  stressRd: number;
  /** how a phrase ends: over its last stretch (s) the pressure falls by a share and the voice gets breathier (more Rd) */
  endWindow: number;
  endPs: number;
  endRd: number;
  /** statements end in creak (vocal fry), 0 = never ... 1 = always: low, irregular pulses instead of a breathy fade */
  endCreak: number;
  /** the breath taken in at a full stop: how hard the lungs pull, cmH2O (0 = a silent pause) */
  breath: number;
  /**
   * how long before a voiceless fricative that follows a voiced sound the folds start to part, s: the voice
   * thins out over the end of the sound before (0 = they part as the fricative starts)
   */
  voicelessLead: number;
  /**
   * how long after a voiceless fricative the folds take to come together again, s: the sound after it starts
   * breathy (0 = they are together as the fricative ends)
   */
  voicelessLag: number;
  /**
   * how much a living speaker varies, from one syllable to the next and from
   * one saying to the next: the length of the syllables and pauses, the
   * height of the accents, the push and tension of the stressed syllables,
   * and a slow wander of the breath and the voice (0 = a machine, the same
   * every time; 1 = usual). Only where the score has a seed.
   */
  variation: number;
}

/** one semitone in log units of F0 */
export const ST = Math.LN2 / 12;

export const DEFAULT_STYLE: Readonly<ProsodyStyle> = Object.freeze({
  floor: 4,
  phrase: 1,
  phraseSpan: 0,
  downstep: 0.9,
  downstepFloor: 0.6,
  finalFall: 0.13 / ST,
  questionRise: 0.5 / ST,
  continuation: 0.13 / ST,
  peakDelay: 0,
  nuclearPeak: 0,
  questionRiseFall: 0,
  micro: 1,
  flutter: 25,
  pauseLong: 0.3,
  pauseShort: 0.16,
  finalLengthening: 1,
  lastStressLengthening: 0,
  declination: 0.12,
  stressPs: 0.14,
  stressRd: 0.12,
  endWindow: 0.28,
  endPs: 0.18,
  endRd: 0.55,
  endCreak: 0,
  breath: 3,
  voicelessLead: 0,
  voicelessLag: 0,
  variation: 1,
});

/** a style with every field, from a partial one */
export const styleOf = (s?: Partial<ProsodyStyle>): ProsodyStyle => ({ ...DEFAULT_STYLE, ...(s ?? {}) });

/** a lengthening factor f (1.4: 40 % longer) made stronger or weaker by the style */
export const lengthen = (f: number, st: ProsodyStyle): number => 1 + (f - 1) * st.finalLengthening;
