import { Articulators, ARTICULATOR_RANGES } from '../tract/types';
import type { Phoneme } from '../speech/phonemes';

/**
 * A speaker's articulatory setting (Laver 1980; Honikman 1964): the posture
 * the vocal organs keep through everything the speaker says, beneath the
 * movements of each sound. A low larynx, rounded lips, a fronted tongue, a
 * velum that never quite closes, folds that never quite meet: each colours
 * every vowel, and the consonants as far as they leave the organ free.
 *
 * The offsets are in the articulators' own units. A consonant keeps the
 * articulators that make its constriction as they are (a /t/ is made on the
 * ridge whatever the speaker's habits), and gets the setting on the others:
 * the larynx and the lips always (a pharyngeal or labial setting colours the
 * consonants too), the velum only on sonorants (an obstruent needs its air).
 */
export interface Setting {
  /** jaw more open (+) or closer (-) than usual, 0..1 units */
  jaw: number;
  /** tongue body fronted (+) or backed (-), cm */
  tongueX: number;
  /** tongue body raised (+) or lowered (-), cm */
  tongueY: number;
  /** tongue root advanced (+) or retracted toward the pharyngeal wall (-), cm */
  tongueRoot: number;
  /** lips rounded (+) or spread (-), 0..1 units */
  lipRound: number;
  /** lips protruded (+) or drawn back (-), cm */
  lipProtrude: number;
  /** larynx raised (+) or lowered (-), cm */
  larynx: number;
  /** the velum never closes more than this on vowels and sonorants: a nasal voice, 0..1 */
  velum: number;
  /** the folds never come closer than this, except where they must shut: a breathy or whispering voice, 0..1 */
  abduction: number;
}

export const NO_SETTING: Readonly<Setting> = Object.freeze({ jaw: 0, tongueX: 0, tongueY: 0, tongueRoot: 0, lipRound: 0, lipProtrude: 0, larynx: 0, velum: 0, abduction: 0 });

/** the articulators a setting moves by an offset */
export const SETTING_OFFSETS = ['jaw', 'tongueX', 'tongueY', 'tongueRoot', 'lipRound', 'lipProtrude', 'larynx'] as const;

/** the setting moves these even where a consonant sets them */
const ALWAYS = new Set<string>(['larynx', 'lipRound', 'lipProtrude']);

export const settingOf = (s?: Partial<Setting>): Setting => ({ ...NO_SETTING, ...(s ?? {}) });

/** a setting that changes nothing */
export const isNeutral = (s: Setting): boolean => Object.values(s).every((v) => v === 0);

/** sounds that let the velum down with the setting: vowels and the sonorant consonants (not trills or taps, which need the air) */
export const nasalizable = (ph: Phoneme): boolean =>
  ph.manner === 'vowel' || ph.manner === 'nasal' || ph.manner === 'lateral' || ph.manner === 'approximant';

/**
 * The value of one articulator in a sound said with a setting. `own` is true
 * when the sound sets that articulator itself (as opposed to a default or a
 * value it leaves to its neighbours).
 */
export function adjust(k: keyof Articulators, v: number, ph: Phoneme, own: boolean, s: Setting): number {
  if (k === 'velum') return nasalizable(ph) ? Math.max(v, s.velum) : v;
  const off = (s as unknown as Record<string, number>)[k] ?? 0;
  if (!off) return v;
  if (ph.manner === 'vowel' || !own || ALWAYS.has(k)) {
    const [lo, hi] = ARTICULATOR_RANGES[k];
    return Math.max(lo, Math.min(hi, v + off));
  }
  return v;
}

/** A whole posture of a sound with the setting (for a sound held by hand). */
export function settle(art: Articulators, ph: Phoneme, s: Setting): Articulators {
  const out = { ...art };
  for (const k of Object.keys(out) as (keyof Articulators)[]) out[k] = adjust(k, art[k], ph, ph.art[k] !== undefined, s);
  return out;
}
