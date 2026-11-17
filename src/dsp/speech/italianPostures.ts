import type { Postures } from './derive';

/**
 * The postures of the Italian sounds, learnt against a listener: the
 * articulators each sound sets, in place of those of the tables and the
 * chart ("x:0", "x:1": the closure and the hiss of the affricate x).
 *
 * How they were found: our own engine said 42 Italian sentences covering
 * every sound, with two voices (the drawing's and a smaller, higher one); a
 * phoneme recogniser (wav2vec 2.0 XLSR-53 fine-tuned on IPA, Apache-2.0)
 * gave every sound said the probability of being heard as itself; an
 * evolutionary search moved the posture of each sound, group by group
 * (voiced and voiceless partners share one posture), and kept a change only
 * where that sound and its neighbours were heard better AND the physical
 * checks of this suite held on it: no tick at a closure, a burst of the
 * right level and no pop, the place of the release, the voice onset of the
 * stops, the dip of the sonorants, the hiss of the sibilants, measured on
 * every sound of the sentences and on the words of the tests. Changes that
 * helped alone were kept only once they also helped said together.
 *
 * On 36 sentences the search never heard, the sounds heard wrong, missing or
 * added fell from 33.5 % to 31.6 % with the drawing's voice and from 43.8 %
 * to 42.0 % with the smaller one (a recording of a real voice: 4 %). Without
 * the checks the search reached 18 % and 29 %, but with ticks at the
 * closures of l and t, pops of t, w and v without their dip and the velar
 * places out of order: what a listener rewards in a sound is partly what a
 * mouth cannot do.
 *
 * What it moved: the tip of t d n a little higher, m with the jaw higher,
 * gn further forward and lower, j with the jaw a little more open, the hiss
 * of sc with the tongue lower and the lips rounder and that of c and g
 * before e and i with the tongue lower, the closure of the affricates longer
 * than their hiss, small changes of e i o u. Left as the tables have them: the open e and o (the recogniser does not
 * tell them from the closed ones), gl, r (its trill), and f v (their learnt
 * lips took the dip from v).
 *
 * Then (2026-11-17) the same search was run against a recorded Italian voice
 * itself: our engine said 23 of its sentences on its own timing and pitch,
 * each sound measured against the same sound in the recording (its spectrum
 * over time, its level, its noise) and judged by the recogniser, with the
 * rules of consonants made at their own place, a single r of one strike and
 * the folds drawn as two areas. Of what it found, only what keeps every
 * physical check of this suite is taken: the open e and o, the closed o,
 * the hisses of s, z and sc, and the affricates (closure and hiss, with z and
 * the voiced affricates said with the folds a little apart). The rest broke
 * the checks: pops of t, bursts of p, t, k too loud against their vowels,
 * ticks inside a, e, u and the nasals, an f with voice in it.
 */
export const ITALIAN_POSTURES: Postures = {
  e: { jaw: 0.455, tongueRoot: -0.163, lipOpen: 0.702, lipProtrude: -0.201 },
  i: { jaw: 0.251, tongueY: 0.818, lipRound: 0.175 },
  u: { tongueRoot: 0.271 },
  p: { jaw: 0.361 },
  b: { jaw: 0.361 },
  t: { jaw: 0.142, tipX: 0.243, tipY: 1.818 },
  d: { jaw: 0.142, tipX: 0.243, tipY: 1.818 },
  m: { jaw: 0.15, lipOpen: -0.248 },
  n: { jaw: 0.299, tipX: 0.202, tipY: 2.044 },
  'ɲ': { jaw: 0.353, tongueX: 1.4, tongueY: 0.996, tongueRoot: 0.187, tipY: 0.894 },
  j: { jaw: 0.091, tongueY: 0.881, tongueRoot: 1.095, lipRound: 0.051 },
  'ɛ': { jaw: 0.544, tongueX: 0.721, tongueY: 0.644, tongueRoot: -0.51, lipOpen: 0.971, lipRound: 0.001, lipProtrude: -0.219 },
  o: { jaw: 0.338, tongueX: -0.43, tongueY: 0.257, tongueRoot: 0.954, lipOpen: -0.055, lipRound: 0.944, lipProtrude: 0.438 },
  'ɔ': { jaw: 0.736, tongueX: -0.271, tongueY: 0.595, tongueRoot: 0.979, lipOpen: 0.073, lipRound: 0.59, lipProtrude: 0.236 },
  s: { jaw: 0.217, tongueX: 0.199, tongueY: 0.109, tongueRoot: 1.062, tipX: 0.675, tipY: 0.769, groove: 0.916, lipOpen: 0.64, lipRound: 0.056, lipProtrude: 0.174 },
  z: { jaw: 0.089, tongueX: -0.341, tongueY: -0.126, tongueRoot: 1.2, tipX: 0.613, tipY: 0.522, groove: 1, lipOpen: 0.04, lipRound: 0.015, lipProtrude: -0.173, abduction: 0.165 },
  'ʃ': { jaw: 0.088, tongueX: 0.882, tongueY: 0.963, tongueRoot: 1.101, tipX: 0.585, tipY: 0.601, groove: 0.895, lipOpen: 1.2, lipRound: 0.731, lipProtrude: 1 },
  'tʃ:0': { jaw: 0, tipX: 1.38, tipY: 1.87 },
  'dʒ:0': { jaw: 0.19, tipX: 1.4, tipY: 1.715, abduction: 0.07 },
  'tʃ:1': { jaw: 0.171, tongueX: 0.913, tongueY: 0.739, tongueRoot: 1.2, tipX: 0.7, tipY: 0.168, groove: 0.71, lipOpen: 0.958, lipRound: 0.713, lipProtrude: 0.993 },
  'dʒ:1': { jaw: 0, tongueX: 0.013, tongueY: 0.04, tongueRoot: 1.184, tipX: 0.487, tipY: 0.549, groove: 0.961, lipOpen: 0.532, lipRound: 0.542, lipProtrude: 0.613, abduction: 0.084 },
  'ts:0': { jaw: 0.232, tipX: 0.992, tipY: 0.533 },
  'dz:0': { jaw: 0.1, tipX: 1.194, tipY: 1.029, abduction: 0.08 },
  'ts:1': { jaw: 0.078, tongueX: 0.81, tongueY: 0.083, tongueRoot: 1.2, tipX: 1.4, tipY: 1.457, groove: 0.878, lipOpen: 0.217, lipRound: 0.177, lipProtrude: -0.277 },
  'dz:1': { jaw: 0.164, tongueX: 0.337, tongueY: 0.225, tongueRoot: 1.2, tipX: 0.68, tipY: 0.517, groove: 1, lipOpen: 0.18, lipRound: 0, lipProtrude: -0.35, abduction: 0.12 },
};

/** the share of an affricate's time its closure takes, learnt with the postures (0.45 where none is given) */
export const ITALIAN_CLOSURE_SHARE: Readonly<Record<string, number>> = { 'tʃ': 0.56, 'dʒ': 0.56, ts: 0.61, dz: 0.61 };
