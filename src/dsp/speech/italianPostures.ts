import type { Articulators } from '../tract/types';

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
 */
export const ITALIAN_POSTURES: Readonly<Record<string, Partial<Articulators>>> = {
  e: { jaw: 0.455, tongueRoot: -0.163, lipOpen: 0.702, lipProtrude: -0.201 },
  i: { jaw: 0.251, tongueY: 0.818, lipRound: 0.175 },
  o: { jaw: 0.437, tongueX: -0.524, tongueY: 0.496, tongueRoot: 0.634 },
  u: { tongueRoot: 0.271 },
  p: { jaw: 0.361 },
  b: { jaw: 0.361 },
  t: { jaw: 0.142, tipX: 0.243, tipY: 1.818 },
  d: { jaw: 0.142, tipX: 0.243, tipY: 1.818 },
  'ʃ': { jaw: 0.035, tongueX: 0.263, tongueY: 0.525, tongueRoot: 1.137, tipX: 0.49, tipY: 0.643, groove: 0.801, lipOpen: 0.913, lipRound: 0.823, lipProtrude: 0.94 },
  'tʃ:0': { jaw: 0, tipX: 1.4, tipY: 1.724 },
  'dʒ:0': { jaw: 0, tipX: 1.4, tipY: 1.724 },
  'tʃ:1': { jaw: 0.13, tongueX: 0.287, tongueY: 0.392, tipX: 0.552, tipY: 0.444, groove: 0.689, lipOpen: 0.866, lipRound: 0.686, lipProtrude: 0.951 },
  'dʒ:1': { jaw: 0.13, tongueX: 0.287, tongueY: 0.392, tipX: 0.552, tipY: 0.444, groove: 0.689, lipOpen: 0.866, lipRound: 0.686, lipProtrude: 0.951 },
  'ts:0': { jaw: 0.1, tipX: 1.194, tipY: 1.029 },
  'dz:0': { jaw: 0.1, tipX: 1.194, tipY: 1.029 },
  'ts:1': { jaw: 0.164, tongueX: 0.337, tongueY: 0.225, tipY: 0.517 },
  'dz:1': { jaw: 0.164, tongueX: 0.337, tongueY: 0.225, tipY: 0.517 },
  m: { jaw: 0.15, lipOpen: -0.248 },
  n: { jaw: 0.299, tipX: 0.202, tipY: 2.044 },
  'ɲ': { jaw: 0.353, tongueX: 1.4, tongueY: 0.996, tongueRoot: 0.187, tipY: 0.894 },
  j: { jaw: 0.091, tongueY: 0.881, tongueRoot: 1.095, lipRound: 0.051 },
};

/** the share of an affricate's time its closure takes, learnt with the postures (0.45 where none is given) */
export const ITALIAN_CLOSURE_SHARE: Readonly<Record<string, number>> = { 'tʃ': 0.56, 'dʒ': 0.56, ts: 0.61, dz: 0.61 };
