import { Anatomy, Articulators, ARTICULATOR_RANGES, DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH, Teeth } from '../tract/types';
import { computeGeometry, EPILARYNX_PASSAGE } from '../tract/geometry';
import { PHONEMES, VOWELS, Phoneme, Manner, NASAL_VELUM, FlickKey, ApproxCode } from './phonemes';
import { IPA_CONSONANTS, IPA_VOWELS, ChartConsonant, ChartVowel, Modifier, Place, ChartManner, IPA_SPELLINGS } from './ipa';
import { segmentOf, Segment, readIpa } from './ipaReader';

/**
 * Every IPA symbol as an articulatory target, from rules (in the spirit of
 * Browman & Goldstein's articulatory phonology: a gesture is an organ, a
 * place and a degree of constriction).
 *
 * - A consonant takes the posture of its place (a recipe: the articulators
 *   the place sets, and the one whose movement narrows the passage there) and
 *   its manner gives the degree: closed for stops and nasals, about 0.1 cm²
 *   for fricatives (Stevens 1998), 0.3 cm² for approximants, a narrow resting
 *   passage with ballistic contacts for trills, one contact for taps. A
 *   bisection on the geometry finds the value of the degree key that gives
 *   that area within the place's window, as the tuning scripts did by hand
 *   for the fitted consonants. The places were laid out with
 *   scripts/posture.ts.
 * - A vowel is interpolated over the fitted vowels by its height and
 *   backness on the chart (the tongue and jaw), with the lips of the rounded
 *   or unrounded fitted vowels of the same height: [y] is [i] with the lips
 *   of [u], [ɯ] is [u] with spread lips.
 * - Diacritics change the result: voicing and phonation, aspiration,
 *   secondary articulations (lips, palate, velum, pharynx), nasalization,
 *   place shifts, degree steps, rounding, tongue root.
 *
 * The fitted phonemes of phonemes.ts are used as they are wherever the
 * symbol is one of them; a diacritic on a fitted phoneme starts from its
 * fitted posture. Results are cached per symbol.
 */

/** below this the passage is closed (the waveguide's closure, areaFunction.ts) */
const CLOSED = 0.004;
const FRICATIVE = 0.1;
const APPROXIMANT = 0.3;
/** the resting passage of a trill between its contacts */
const TRILL = 0.12;
/** a raised fricative (ř: the trill's passage narrow enough to hiss) */
const NARROW = 0.05;
/** how far a fricative trill opens between its contacts, cm² (about a fricative's channel) */
const TRILL_OPEN = 0.12;
/** the body of the tongue behind the blade of a fricative trill (ř) */
const LAMINAL_TRILL: Partial<Articulators> = { tongueX: 0.7, tongueY: 1.0, tongueRoot: 1.2, tipX: 0.5 };
const WIDE = 0.6;
/** the narrowest passage is looked for above the epilaryngeal tube (engine.ts) */
const S_START = 2.6;

type Degree = 'closed' | number;

interface Recipe {
  /** the articulators the place sets, besides its degree key */
  art: Partial<Articulators>;
  /** the articulator that narrows the passage at this place, from open to closed */
  key: keyof Articulators;
  open: number;
  closed: number;
  /** where the constriction must be, cm from the lips (default anatomy) */
  window: [number, number];
  /** how far past the contact a closure aims, in units of the key */
  overshoot: number;
  /** a ready closure (a fitted stop's posture) instead of solving one */
  closure?: Partial<Articulators>;
}

const art = (ipa: string): Partial<Articulators> => ({ ...PHONEMES[ipa].art });
const without = (a: Partial<Articulators>, ...keys: (keyof Articulators)[]) => {
  const o = { ...a };
  for (const k of keys) delete o[k];
  return o;
};

/** where the edge of the upper incisors is, cm from the lips (the default head, lips at rest) */
const TEETH_FROM_LIPS = (() => {
  const g = computeGeometry({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art }, DEFAULT_ANATOMY, DEFAULT_TEETH);
  return g.length - g.teethPos;
})();

const RECIPES: Record<Place, Recipe> = {
  // rounded lips narrow with the lip opening; the closure is that of /p/
  bilabial: {
    art: { jaw: 0.15, lipRound: 1, lipProtrude: 0.2, lipTuck: 0 }, key: 'lipOpen', open: 0.3, closed: -0.3,
    window: [0, 1.2], overshoot: 0.1, closure: without(art('p'), 'velum'),
  },
  // the lower lip under the upper incisors: lipOpen 0.5 .. 1 (below it the lip rises past their edge)
  labiodental: {
    art: { jaw: 0.12, lipTuck: 1, lipRound: 0, lipProtrude: 0 }, key: 'lipOpen', open: 1.0, closed: 0.5,
    window: [0.8, 2.4], overshoot: 0, closure: { jaw: 0.12, lipTuck: 1, lipRound: 0, lipProtrude: 0, lipOpen: -0.25 },
  },
  dental: {
    // the tip against the back of the upper incisors: raised further it
    // slides back to the ridge. The window runs from just in front of their
    // edge to where their back meets the gum (the contact of a dental stop
    // lies there, about 1.5 cm behind the edge: TEETH_FROM_LIPS)
    art: { jaw: 0.12, tipX: 0.8, groove: 0, lipTuck: 0 }, key: 'tipY', open: -0.3, closed: 0.9, window: [TEETH_FROM_LIPS - 0.55, TEETH_FROM_LIPS + 1.85], overshoot: 0.15,
  },
  alveolar: {
    art: { jaw: 0.12, tipX: 0.25, groove: 0, lipTuck: 0 }, key: 'tipY', open: 0.6, closed: 2.2, window: [3.4, 5.0], overshoot: 0.3,
    closure: without(art('t'), 'velum'),
  },
  postalveolar: {
    art: { jaw: 0.1, tipX: 0.0, groove: 0, tongueRoot: 1.2, lipTuck: 0 }, key: 'tipY', open: 0.6, closed: 2.2, window: [3.8, 5.8], overshoot: 0.3,
  },
  // the tip up and back (scripts/posture.ts: closed from tipY 2.0, 0.1 cm² at 1.8)
  retroflex: {
    art: { jaw: 0.1, tipX: -0.4, groove: 0, tongueRoot: 1.2, lipTuck: 0 }, key: 'tipY', open: 1.2, closed: 2.2, window: [4.0, 6.2], overshoot: 0.2,
  },
  // the blade and front of the body against the front of the palate, the tip down, the lips spread
  alveolopalatal: {
    art: { jaw: 0.1, tipX: 0.3, tipY: -0.2, groove: 0.3, tongueX: 1.25, tongueRoot: 1.2, lipRound: 0, lipProtrude: -0.3, lipOpen: 0.2, lipTuck: 0 },
    key: 'tongueY', open: 0.4, closed: 1.4, window: [2.6, 4.6], overshoot: 0.2,
  },
  palatal: {
    art: { jaw: 0.1, tongueX: 0.9, tongueRoot: 1.2, tipY: 0.1, lipTuck: 0 }, key: 'tongueY', open: 0.7, closed: 1.6, window: [4.8, 7.4], overshoot: 0.15,
    closure: without(art('ɲ'), 'velum'),
  },
  velar: {
    art: { tongueX: -0.25, tongueRoot: 1.2, tipY: 0, groove: 0 }, key: 'tongueY', open: 0.6, closed: 1.7, window: [7.8, 10.6], overshoot: 0.3,
    closure: without(art('k'), 'velum'),
  },
  // the dorsum backed against the uvula, the root forward so the pharynx stays open
  uvular: {
    art: { jaw: 0.4, tongueY: 0.3, tongueRoot: 1.2, tipY: 0, groove: 0 }, key: 'tongueX', open: -0.7, closed: -1.5, window: [10.6, 13.2], overshoot: 0.15,
  },
  pharyngeal: {
    art: { jaw: 0.4, tongueX: -1.0, tongueY: -0.6, tipY: 0, groove: 0 }, key: 'tongueRoot', open: 1.2, closed: -0.2, window: [11.6, 14.6], overshoot: 0.2,
  },
  // the aryepiglottic sphincter: the arytenoids drawn forward under the
  // epiglottis, the folds above the vocal folds drawn in, the tongue root
  // a little back with them (Esling 2005)
  epiglottal: {
    art: { jaw: 0.4, tongueX: -0.3, tongueY: -0.4, tongueRoot: 0.3, tipY: 0, groove: 0 }, key: 'epilarynx', open: 0, closed: 1, window: [14.6, 17.6], overshoot: 0.1,
  },
  glottal: { art: {}, key: 'jaw', open: 0, closed: 0, window: [0, 30], overshoot: 0 },
};

const CORONAL = new Set<Place>(['dental', 'alveolar', 'postalveolar', 'retroflex']);
/** the back passage of ɧ, cm² (its front one is a fricative's) */
const DOUBLE_BACK = 0.12;
/** the blade of the palatal click a little forward of a postalveolar's, laminal */
const PALATAL_CLICK_BLADE = 0.3;
const DORSAL = new Set<Place>(['alveolopalatal', 'palatal', 'velar', 'uvular']);

// ----------------------------------------------------------- measurement

const baseArt = (a: Partial<Articulators>): Articulators => ({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...a });

/**
 * A speaker's head, as far as the sounds are concerned: the anatomy and the
 * teeth. Every posture of the tables and the recipes was made on the
 * drawing's head; a head of another shape gets them adapted (adapt()).
 */
export interface Head { anatomy: Anatomy; teeth: Teeth }

/**
 * The anatomy that changes where the tongue must go to make a sound: the
 * shape of the mouth and of the throat. The size, the length of the pharynx
 * and the nose do not (a posture scales with the head, and the passages of
 * a consonant are measured at the drawing's size); nor do the teeth, whose
 * effect on a hiss (a lisp through an open bite) is theirs to give.
 */
const SHAPE: (keyof Anatomy)[] = ['pharynxWidth', 'palateHeight', 'archWidth', 'tongueSize', 'tipReach', 'mouthWidth', 'lipThickness'];

/** The shape of a head at the drawing's size, or undefined when it is the drawing's own. */
export function shapeOf(head?: { anatomy: Partial<Anatomy> }): Head | undefined {
  if (!head) return undefined;
  const an: Anatomy = { ...DEFAULT_ANATOMY };
  let same = true;
  for (const k of SHAPE) {
    const v = head.anatomy[k] ?? DEFAULT_ANATOMY[k];
    an[k] = v;
    if (Math.abs(v - DEFAULT_ANATOMY[k]) > 1e-6) same = false;
  }
  return same ? undefined : { anatomy: an, teeth: DEFAULT_TEETH };
}

/** a short name of a shape, for the caches */
export const shapeKey = (h?: Head): string => (h ? SHAPE.map((k) => h.anatomy[k].toFixed(4)).join(',') : '');

/** narrowest passage above the epilaryngeal tube, and the narrowest inside a window (cm from the lips) */
function measure(a: Articulators, win?: [number, number], head?: Head): { min: number; at: number; inWindow: number } {
  const g = computeGeometry(a, head?.anatomy ?? DEFAULT_ANATOMY, head?.teeth ?? DEFAULT_TEETH);
  let min = Infinity, at = 0, inWindow = Infinity;
  const take = (area: number, fromLips: number) => {
    if (area < min) { min = area; at = fromLips; }
    if (win && fromLips >= win[0] && fromLips <= win[1] && area < inWindow) inWindow = area;
  };
  // the tube above the folds is always narrow (about 0.5 cm²): it is a
  // sound's constriction only when the sphincter draws it in
  const from = (a.epilarynx ?? 0) > EPILARYNX_PASSAGE ? 0 : S_START;
  for (let i = 0; i <= g.lastRay; i++) if (g.s[i] >= from) take(g.hits[i].area, g.length - g.s[i]);
  if (g.teethPos > 0) take(g.slit.area, g.length - g.teethPos);
  return { min: Math.max(0, min), at, inWindow: Math.max(0, inWindow) };
}

/** where the narrowest passage of a posture is, cm from the lips */
/** narrowest passage of a posture between `win[0]` and `win[1]` cm from the lips */
export function passageIn(a: Partial<Articulators>, win: [number, number], head?: Head): number {
  return measure(baseArt(a), win, head).inWindow;
}

export function constrictionOf(a: Partial<Articulators>, head?: Head): { area: number; fromLips: number } {
  const m = measure(baseArt(a), undefined, head);
  return { area: m.min, fromLips: m.at };
}

/**
 * Where an articulator meets the other side in a posture: the value of `key`,
 * between the posture's own and `toward` (shut), at which the passage closes.
 * Returns `toward` if it never closes.
 */
export function contactPoint(a: Partial<Articulators>, key: keyof Articulators, toward: number, head?: Head): number {
  const at = (v: number) => measure(baseArt({ ...a, [key]: v }), undefined, head).min;
  let lo = baseArt(a)[key], hi = toward;
  if (at(hi) >= CLOSED) return toward;
  if (at(lo) < CLOSED) return lo;
  for (let it = 0; it < 12; it++) {
    const m = 0.5 * (lo + hi);
    if (at(m) < CLOSED) hi = m; else lo = m;
  }
  return hi;
}

/**
 * The value of the recipe's key that gives the degree inside the window,
 * by bisection (the area falls as the key goes from open to closed).
 */
function solveDegree(start: Partial<Articulators>, r: Recipe, degree: Degree, win: [number, number]): { value: number; reached: boolean } {
  const area = (u: number) => measure(baseArt({ ...start, [r.key]: r.open + (r.closed - r.open) * u }), win).inWindow;
  const target = degree === 'closed' ? CLOSED : degree;
  let lo = 0, hi = 1;
  if (area(1) >= target) return { value: r.closed, reached: false };
  if (area(0) < target) return { value: r.open, reached: degree !== 'closed' && area(0) > 0.5 * target };
  for (let it = 0; it < 14; it++) {
    const m = 0.5 * (lo + hi);
    if (area(m) < target) hi = m; else lo = m;
  }
  let value = r.open + (r.closed - r.open) * (degree === 'closed' ? hi : 0.5 * (lo + hi));
  if (degree === 'closed') {
    const dir = Math.sign(r.closed - r.open);
    const [a, b] = ARTICULATOR_RANGES[r.key];
    value = Math.max(a, Math.min(b, value + dir * r.overshoot));
  }
  return { value: Math.round(value * 1000) / 1000, reached: true };
}

// ----------------------------------------------------------- consonants

interface Built { ph: Phoneme; recipe?: Recipe; win?: [number, number]; degree?: Degree; place?: Place }

const MANNER_OF: Record<ChartManner, Manner> = {
  plosive: 'stop', nasal: 'nasal', trill: 'trill', tap: 'tap', fricative: 'fricative', lateralFricative: 'fricative',
  approximant: 'approximant', lateralApproximant: 'lateral', lateralTap: 'tap', implosive: 'stop', click: 'stop',
};

const DUR: Record<Manner, [number, number]> = {
  stop: [0.09, 0.07], fricative: [0.12, 0.09], nasal: [0.08, 0.08], approximant: [0.06, 0.06], lateral: [0.07, 0.07],
  trill: [0.08, 0.08], tap: [0.025, 0.025], affricate: [0.13, 0.11], glottal: [0.08, 0.08], glottalStop: [0.05, 0.05],
  vowel: [0.14, 0.14], silence: [0.2, 0.2],
};

function abductionOf(manner: Manner, voiced: boolean): number {
  if (manner === 'glottal') return voiced ? 0.3 : 0.5;
  if (manner === 'glottalStop' || manner === 'silence') return manner === 'silence' ? 0.9 : 0;
  if (manner === 'stop') return voiced ? 0.08 : 0.5;
  if (manner === 'fricative' || manner === 'affricate') return voiced ? 0.12 : 0.55;
  // voiceless sonorants (m̥ l̥ r̥): the glottis open, the air hissing through the passage
  return voiced ? 0 : 0.45;
}

const degreeOf = (m: ChartManner): Degree =>
  m === 'plosive' || m === 'nasal' || m === 'implosive' || m === 'click' ? 'closed'
    : m === 'fricative' || m === 'lateralFricative' ? FRICATIVE
      : m === 'trill' ? TRILL : APPROXIMANT;

function make(ipa: string, manner: Manner, voiced: boolean, a: Partial<Articulators>, extra: Partial<Phoneme> = {}): Phoneme {
  const [dv, dvd] = DUR[manner];
  return { ipa, manner, voiced, art: a, abduction: abductionOf(manner, voiced), dur: voiced ? dvd : dv, derived: true, ...extra };
}

/** an articulator offset kept inside its range */
const clampKey = (k: keyof Articulators, v: number) => Math.max(ARTICULATOR_RANGES[k][0], Math.min(ARTICULATOR_RANGES[k][1], v));

function consonantFromChart(sym: string, k: ChartConsonant): Built | null {
  const manner = MANNER_OF[k.manner];
  const place: Place = k.place;
  let approx: ApproxCode | undefined;
  if (place === 'glottal') {
    if (k.manner === 'plosive') return { ph: PHONEMES['ʔ'] };
    return { ph: make(sym, 'glottal', k.voiced, {}, { place }) };
  }
  // a voiceless /w/: the hiss is at the rounded lips
  if (sym === 'ʍ') return { ph: make(sym, 'fricative', false, { ...PHONEMES.w.art }, { place: 'velar' }), place: 'velar' };
  const r = RECIPES[place];
  let degree = degreeOf(k.manner);
  const lateral = k.manner === 'lateralApproximant' || k.manner === 'lateralFricative' || k.manner === 'lateralTap';
  let a: Partial<Articulators>;
  let solved = true;
  if (lateral) {
    // a central closure with the sides of the tongue lowered: the sides set the degree
    const c = r.closure ?? { ...r.art, [r.key]: solveDegree(r.art, r, 'closed', r.window).value };
    const side: Recipe = { art: c, key: 'tongueSides', open: 1, closed: 0, window: [0, 30], overshoot: 0 };
    const target = k.manner === 'lateralFricative' ? FRICATIVE : APPROXIMANT;
    const s = solveDegree(c, side, target, [0, 30]);
    a = { ...c, tongueSides: s.value, groove: 0 };
    if (k.manner === 'lateralTap') { a.tipY = 1.2; degree = APPROXIMANT; }
  } else if (degree === 'closed' && r.closure) a = { ...r.closure };
  else {
    const s = solveDegree(r.art, r, degree, r.window);
    a = { ...r.art, [r.key]: s.value };
    solved = s.reached;
  }
  if (!lateral && (CORONAL.has(place) || DORSAL.has(place) || place === 'pharyngeal' || place === 'epiglottal')) a.tongueSides = 0;
  a.velum = manner === 'nasal' ? NASAL_VELUM : 0;
  if (place === 'bilabial' || place === 'labiodental') a.lipTuck = place === 'labiodental' ? 1 : 0;
  const extra: Partial<Phoneme> = { place };
  if (approx) extra.approx = approx;
  if (!solved) extra.approx = extra.approx ?? 'degree';
  if (DORSAL.has(place) && degree === 'closed') extra.dorsal = true;
  // an implosive lowers the larynx through its closure with the folds vibrating
  if (k.manner === 'implosive') { extra.airstream = 'implosive'; a.larynx = -1.5; }
  if (k.manner === 'click') {
    // a click: the front closure and a velar one at once; the tongue body
    // rarefies the air between them, and the front opens first (the sequencer
    // and the engine do that). A lateral click keeps its sides shut through
    // the closure and opens them to release it
    extra.airstream = 'click';
    // the palatal click ǂ is laminal: the blade seals on the ridge and the
    // front of the hard palate with the tip down (Ladefoged & Traill 1984),
    // so the blade makes its front closure while the body makes the velar one
    if (place === 'alveolopalatal') {
      const blade: Recipe = { ...RECIPES.postalveolar, art: { ...RECIPES.postalveolar.art, tipX: PALATAL_CLICK_BLADE } };
      const start = { ...without(RECIPES.velar.closure!, 'tipY', 'groove'), ...blade.art };
      a = { ...blade.art, tipY: solveDegree(start, blade, 'closed', blade.window).value, tongueSides: 0, velum: 0 };
    }
    // a dental click is laminal: the blade seals from the back of the
    // incisors up to the ridge, which keeps the cavity behind it small
    // (Ladefoged & Traill 1984); a dental stop needs only the tip on the teeth
    if (place === 'dental') a.tipY = r.closed;
    a = { ...without(RECIPES.velar.closure!, 'tipY', 'groove'), ...a };
    if (k.lateral) { a.tongueSides = 0; extra.lateralRelease = true; }
    if (DORSAL.has(place) && place !== 'alveolopalatal') extra.approx = 'click';
  }
  // taps and trills: the articulator that strikes, and where it touches
  if (k.manner === 'trill' || k.manner === 'tap' || k.manner === 'lateralTap') {
    const key: FlickKey = place === 'bilabial' || place === 'labiodental' ? 'lipOpen' : place === 'uvular' ? 'tongueX' : 'tipY';
    // past the contact: where a tap aims, and the bound within which the contact of a trill is looked for
    // (the uvula closes from tongueX -1.3, the lips from -0.2)
    const contact = place === 'labiodental' ? 0.42 : place === 'bilabial' ? -0.45 : place === 'uvular' ? -1.55 : 2.2;
    extra.flick = { key, contact };
    if (k.manner === 'tap' && place === 'labiodental') a.lipOpen = 0.9;
  }
  if (k.rounded) { a.lipRound = 1; a.lipProtrude = 0.8; a.lipOpen = Math.min(a.lipOpen ?? 0.2, 0.05); }
  // ɧ, "simultaneous ʃ and x" (the IPA chart): the tip hisses at the ridge
  // and the body at the velum at once, with air between them; the back
  // passage a little wider, so that the front one's jet still hits the
  // teeth; the lips rounded and pushed out. The tip rides on the body, so
  // each is solved again with the other in place
  if (k.also === 'velar') {
    const v = RECIPES.velar;
    a = { ...a, tongueX: v.art.tongueX! };
    for (let it = 0; it < 2; it++) {
      a = { ...a, tongueY: solveDegree(a, v, DOUBLE_BACK, v.window).value };
      const front = solveDegree(a, r, degree, r.window);
      a = { ...a, [r.key]: front.value };
      solved = front.reached;
    }
    a.lipRound = 0.5; a.lipProtrude = 0.4;
    if (!solved) extra.approx = 'degree';
  }
  return { ph: make(sym, manner, k.voiced, a, extra), recipe: r, win: r.window, degree, place };
}

// ----------------------------------------------------------- vowels

const VOWEL_TONGUE: (keyof Articulators)[] = ['jaw', 'tongueX', 'tongueY', 'tongueRoot'];
const VOWEL_LIPS: (keyof Articulators)[] = ['lipOpen', 'lipRound', 'lipProtrude'];
/** the fitted vowels and where they sit on the chart (the r-coloured one aside) */
const ANCHORS = Object.keys(VOWELS).filter((v) => v !== 'ɝ' && IPA_VOWELS[v]).map((v) => ({ v, at: IPA_VOWELS[v], art: VOWELS[v].art }));

function idw(points: { at: ChartVowel; art: Partial<Articulators> }[], h: number, b: number, keys: (keyof Articulators)[]): Partial<Articulators> {
  const near = points.map((p) => ({ p, d: Math.hypot(p.at.height - h, 0.8 * (p.at.back - b)) })).sort((x, y) => x.d - y.d).slice(0, 4);
  if (near[0].d < 1e-6) return Object.fromEntries(keys.map((k) => [k, near[0].p.art[k] ?? 0]));
  const out: Partial<Articulators> = {};
  for (const k of keys) {
    let s = 0, w = 0;
    for (const { p, d } of near) { const wi = 1 / (d * d); s += wi * (p.art[k] ?? 0); w += wi; }
    out[k] = Math.round((s / w) * 1000) / 1000;
  }
  return out;
}

function vowelArt(at: ChartVowel): Partial<Articulators> {
  const tongue = idw(ANCHORS, at.height, at.back, VOWEL_TONGUE);
  const lipAnchors = ANCHORS.filter((p) => p.at.rounded === at.rounded);
  // rounded vowels take the lips of the rounded fitted vowels of the same height
  // (they are all back: their lips do not depend on the tongue's backness)
  const lips = idw(lipAnchors, at.height, at.rounded ? 1 : at.back, VOWEL_LIPS);
  if (at.rounded && at.height < 0.33) {
    // open rounded vowels (ɒ ɶ): the lips of /ɔ/, opened with the jaw
    lips.lipOpen = (lips.lipOpen ?? 0) + 0.6 * (0.33 - at.height) / 0.33;
    lips.lipRound = 0.6;
  }
  return { tipX: 0, tipY: 0, groove: 0, tongueSides: 0, lipTuck: 0, velum: 0, ...tongue, ...lips };
}

function vowelFromChart(sym: string, at: ChartVowel): Phoneme {
  return make(sym, 'vowel', true, vowelArt(at));
}

// ----------------------------------------------------------- diacritics

const STEP_UP: [number, number][] = [[WIDE, APPROXIMANT], [APPROXIMANT, FRICATIVE], [FRICATIVE, NARROW], [TRILL, NARROW]];
const STEP_DOWN: [number, number][] = [[NARROW, FRICATIVE], [FRICATIVE, APPROXIMANT], [APPROXIMANT, WIDE], [TRILL, APPROXIMANT]];

function stepDegree(d: Degree, up: boolean): Degree {
  if (d === 'closed') return up ? 'closed' : FRICATIVE;
  const table = up ? STEP_UP : STEP_DOWN;
  for (const [from, to] of table) if (Math.abs(d - from) < 1e-9) return to;
  return up ? d * 0.5 : d * 2;
}

function placeRecipeFor(ph: Phoneme): Place | undefined {
  return ph.place ?? IPA_CONSONANTS[ph.ipa]?.place;
}

/**
 * The articulator that closes a consonant at its place, and which way it
 * goes to close (+1: up or forward; -1: down or back), with the jaw's help
 * where the jaw carries it (the lips, the tip, the blade and the dorsum).
 */
export function closingKey(ph: Phoneme): { key: keyof Articulators; dir: number; jaw: boolean } | undefined {
  const place = placeRecipeFor(ph);
  if (!place || place === 'glottal') return undefined;
  const r = RECIPES[place];
  return { key: r.key, dir: Math.sign(r.closed - r.open), jaw: place !== 'uvular' && place !== 'pharyngeal' && place !== 'epiglottal' };
}

/** below this the passage is shut */
export const CLOSED_AREA = CLOSED;

/** the window around where a fitted posture narrows */
function windowAround(a: Partial<Articulators>): [number, number] {
  const c = constrictionOf(a);
  return [Math.max(0, c.fromLips - 1.1), c.fromLips + 1.1];
}

function applyConsonantMods(b: Built, mods: Modifier[], sym: string): Phoneme {
  let ph: Phoneme = { ...b.ph, art: { ...b.ph.art }, ipa: sym };
  const place = b.place ?? placeRecipeFor(ph);
  let r = place ? RECIPES[place] : undefined;
  let degree: Degree | undefined = b.degree ?? (ph.manner === 'stop' || ph.manner === 'nasal' ? 'closed'
    : ph.manner === 'fricative' ? FRICATIVE : ph.manner === 'trill' ? TRILL : ph.manner === 'approximant' ? APPROXIMANT : undefined);
  let win = b.win;
  let resolve = false;
  let moved = false;
  for (const m of mods) {
    if ((m === 'dental' || m === 'advanced' || m === 'retracted' || m === 'apical' || m === 'laminal') && r && place) {
      // an apical sibilant is made with the tip a little back and up (the Basque s̺, near [ʃ] to an English ear),
      // a laminal one with the blade a little forward (s̻)
      const d = m === 'dental' ? 0.55 : m === 'advanced' ? 0.25 : m === 'retracted' ? -0.25 : m === 'apical' ? -0.2 : 0.2;
      if (CORONAL.has(place) && 'tipX' in ph.art) {
        ph.art.tipX = clampKey('tipX', (ph.art.tipX ?? 0) + d);
        // (a small shift of the tip: the degree it had is kept)
        if (m !== 'apical' && m !== 'laminal') resolve = true;
        moved = true;
        if (m === 'dental') { win = RECIPES.dental.window; r = RECIPES.dental; }
      }
      else if (DORSAL.has(place) && (m === 'advanced' || m === 'retracted')) { ph.art.tongueX = clampKey('tongueX', (ph.art.tongueX ?? 0) + (m === 'advanced' ? 0.3 : -0.3)); resolve = true; moved = true; }
    }
    if ((m === 'raised' || m === 'lowered') && degree !== undefined && ph.manner !== 'lateral') {
      const nd = stepDegree(degree, m === 'raised');
      if (nd !== degree) { degree = nd; resolve = true; }
    }
  }
  if (resolve && r && place && degree !== undefined && ph.manner !== 'lateral' && place !== 'glottal') {
    // a fitted posture is solved again around where it narrows; a derived one in its place's window
    if (!b.recipe && !(moved && win)) win = moved ? [0, 30] : windowAround(ph.art);
    const fricTrill = ph.manner === 'trill' && degree !== 'closed' && degree <= FRICATIVE;
    // a coronal trill narrowed until it hisses (Czech ř) is laminal, with the
    // body of the tongue raised and fronted behind the blade, as for [ʒ]: the
    // blade runs along the front of the ridge (Dankovičová 1999; Howson,
    // Komova & Gick 2014)
    if (fricTrill && CORONAL.has(place)) Object.assign(ph.art, LAMINAL_TRILL);
    const s = solveDegree(ph.art, r, degree, win ?? r.window);
    ph.art[r.key] = s.value;
    if (!s.reached) ph.approx = ph.approx ?? 'degree';
    if (fricTrill) {
      // it lets more air through the glottis, as a voiced fricative does, or
      // the jet is too slow to hiss; and between its contacts it opens only
      // into a narrow channel: how far from the contact that is
      ph.abduction = Math.max(ph.abduction, abductionOf('fricative', ph.voiced));
      // (a fitted trill strikes with the tip up to 2.3, as the sequencer assumes)
      const fl = ph.flick ?? (r.key === 'tipY' ? { key: 'tipY' as FlickKey, contact: 2.3 } : undefined);
      if (fl && fl.key === r.key) {
        const contact = contactPoint(ph.art, r.key, fl.contact);
        const dir = Math.sign(r.closed - r.open);
        const w = win ?? r.window;
        let lo = 0, hi = 1;
        for (let it = 0; it < 12; it++) {
          const m = 0.5 * (lo + hi);
          if (passageIn({ ...ph.art, [r.key]: contact - dir * m }, w) > TRILL_OPEN) hi = m; else lo = m;
        }
        ph.flick = { ...fl, open: Math.round(0.5 * (lo + hi) * 1000) / 1000 };
      }
    }
    if (ph.manner !== 'trill' && ph.manner !== 'tap') {
      // the degree sets the manner: a raised approximant hisses, a lowered fricative does not
      const manner: Manner = degree === 'closed' ? ph.manner : degree <= FRICATIVE ? 'fricative' : 'approximant';
      if (manner !== ph.manner) ph = { ...ph, manner, abduction: abductionOf(manner, ph.voiced), dur: DUR[manner][ph.voiced ? 1 : 0] };
    }
  }
  return applyCommonMods(ph, mods, place);
}

function applyCommonMods(ph: Phoneme, mods: Modifier[], place?: Place): Phoneme {
  const a = ph.art;
  const vowel = ph.manner === 'vowel';
  const labial = place === 'bilabial' || place === 'labiodental';
  for (const m of mods) {
    switch (m) {
      // a voiceless implosive (Owerri Igbo, Lendu) lowers the larynx with the glottis shut: the air is drawn in
      case 'voiceless': ph.voiced = false; ph.abduction = vowel ? 0.55 : ph.airstream === 'implosive' ? 0 : abductionOf(ph.manner, false); break;
      case 'voiced': ph.voiced = true; ph.abduction = abductionOf(ph.manner, true); break;
      case 'aspirated': ph.aspirated = true; break;
      case 'breathy': ph.phonation = 'breathy'; break;
      case 'creaky': ph.phonation = 'creaky'; break;
      case 'glottalized': if (ph.manner === 'stop') ph.unreleased = true; else ph.phonation = 'creaky'; break;
      // an ejective raises the closed larynx through its closure, like a piston
      case 'ejective': ph.airstream = 'ejective'; ph.voiced = false; ph.abduction = 0; a.larynx = 1.2; break;
      case 'noRelease': ph.unreleased = true; break;
      case 'nasalized': a.velum = vowel ? 0.3 : NASAL_VELUM; break;
      case 'labialized': if (!labial) { a.lipRound = 1; a.lipProtrude = 0.8; if (vowel) break; a.lipOpen = Math.min(a.lipOpen ?? 0.3, 0.1); } break;
      case 'palatalized': if (!DORSAL.has(place as Place)) { a.tongueX = 1.0; a.tongueY = 0.9; a.tongueRoot = 1.2; } break;
      case 'velarized': if (place !== 'velar' && place !== 'uvular') { a.tongueX = -0.8; a.tongueY = 0.5; } break;
      case 'pharyngealized':
        if (place !== 'pharyngeal') {
          if (vowel) a.tongueRoot = Math.min(a.tongueRoot ?? 0, -0.3);
          else { a.tongueRoot = -0.6; a.tongueX = -0.4; a.tongueY = 0.2; }
        }
        break;
      case 'rhotic': a.tipX = VOWELS['ɝ'].art.tipX; a.tipY = VOWELS['ɝ'].art.tipY; a.lipRound = Math.max(a.lipRound ?? 0, 0.2); break;
      case 'moreRounded': a.lipRound = clampKey('lipRound', (a.lipRound ?? 0) + 0.3); a.lipProtrude = clampKey('lipProtrude', (a.lipProtrude ?? 0) + 0.3); break;
      case 'lessRounded': a.lipRound = clampKey('lipRound', (a.lipRound ?? 0) - 0.3); a.lipProtrude = clampKey('lipProtrude', (a.lipProtrude ?? 0) - 0.3); break;
      case 'atr': a.tongueRoot = clampKey('tongueRoot', (a.tongueRoot ?? 0) + 0.5); break;
      case 'rtr': a.tongueRoot = clampKey('tongueRoot', (a.tongueRoot ?? 0) - 0.5); break;
      case 'syllabic': ph.syllabic = true; break;
      // a tense consonant: the glottis narrow and stiff, the larynx up, no breath after it
      case 'fortis':
        ph.fortis = true; ph.aspirated = false;
        if (!ph.voiced) ph.abduction = Math.min(ph.abduction, 0.2);
        a.larynx = clampKey('larynx', (a.larynx ?? 0) + 0.5);
        break;
      case 'compressed': a.lipRound = Math.max(a.lipRound ?? 0, 0.55); a.lipProtrude = Math.min(a.lipProtrude ?? 0, -0.1); if (vowel) a.lipOpen = Math.min(a.lipOpen ?? 0.3, 0.2); break;
      case 'nonSyllabic': ph.nonSyllabic = true; ph.dur *= 0.5; break;
      default: break;
    }
  }
  // a secondary articulation must not close the tract where the primary one does not
  if (!vowel && mods.some((m) => m === 'palatalized' || m === 'velarized' || m === 'pharyngealized')) keepOpen(ph);
  return ph;
}

/** relaxes the tongue body of a secondary articulation until it leaves a passage of 0.3 cm² behind the primary one */
function keepOpen(ph: Phoneme): void {
  const a = ph.art;
  const primary = constrictionOf(without(a, 'tongueX', 'tongueY', 'tongueRoot'));
  const behind = (x: Partial<Articulators>) => {
    const g = measure(baseArt(x), [primary.fromLips + 1.2, 30]);
    return g.inWindow;
  };
  if (behind(a) >= 0.3) return;
  const keys: (keyof Articulators)[] = ['tongueX', 'tongueY', 'tongueRoot'];
  const neutral = PHONEMES['ə'].art;
  const from = Object.fromEntries(keys.map((k) => [k, a[k] ?? neutral[k] ?? 0])) as Record<string, number>;
  let lo = 0, hi = 1;
  for (let it = 0; it < 10; it++) {
    const m = 0.5 * (lo + hi);
    const x = { ...a };
    for (const k of keys) x[k] = from[k] + ((neutral[k] ?? 0) - from[k]) * m;
    if (behind(x) >= 0.3) hi = m; else lo = m;
  }
  for (const k of keys) a[k] = Math.round((from[k] + ((neutral[k] ?? 0) - from[k]) * hi) * 1000) / 1000;
}

// ----------------------------------------------------------- symbols

const cache = new Map<string, Phoneme | null>();

function baseOf(seg: Segment): Built | null {
  const b = IPA_SPELLINGS[seg.base] ?? seg.base;
  const fitted = PHONEMES[b];
  if (fitted) return { ph: fitted, place: placeRecipeFor(fitted) };
  const k = IPA_CONSONANTS[b];
  if (k) return consonantFromChart(b, k);
  const vw = IPA_VOWELS[b];
  if (vw) return { ph: vowelFromChart(b, vw) };
  if (b !== seg.base) { const p = phonemeFor(b); return p ? { ph: p, place: placeRecipeFor(p) } : null; }
  return null;
}

/** vowel modifiers that move it on the chart before it is interpolated */
function shiftedVowel(base: string, mods: Modifier[]): ChartVowel | null {
  const at = IPA_VOWELS[base];
  if (!at || !mods.some((m) => ['raised', 'lowered', 'advanced', 'retracted', 'centralized', 'midCentralized'].includes(m))) return null;
  let { height, back } = at;
  for (const m of mods) {
    if (m === 'raised') height += 0.15;
    if (m === 'lowered') height -= 0.15;
    if (m === 'advanced') back -= 0.15;
    if (m === 'retracted') back += 0.15;
    if (m === 'centralized') back += (0.5 - back) * 0.5;
    if (m === 'midCentralized') { back += (0.5 - back) * 0.5; height += (0.5 - height) * 0.5; }
  }
  return { height: Math.max(0, Math.min(1, height)), back: Math.max(0, Math.min(1, back)), rounded: at.rounded };
}

function fromSegment(sym: string, seg: Segment): Phoneme | null {
  if (seg.tied) {
    const a = fromSegment(seg.base, { base: seg.base, mods: [] });
    const b = fromSegment(seg.tied.base, seg.tied);
    if (!a || !b) return null;
    let ph: Phoneme;
    if (a.manner === 'vowel' && b.manner === 'vowel') ph = { ...a, art: { ...a.art }, ipa: sym, dur: 0.2, offglide: b.ipa, derived: true };
    else if (a.manner === 'stop' && (b.manner === 'fricative' || b.manner === 'lateral' || b.manner === 'trill')) {
      ph = { ...make(sym, 'affricate', b.voiced, {}), parts: [a.ipa, b.ipa], place: b.place ?? placeRecipeFor(b) };
    } else if (a.manner === 'nasal' && b.manner === 'stop') {
      ph = { ...make(sym, 'affricate', b.voiced, {}), parts: [a.ipa, b.ipa], place: b.place ?? placeRecipeFor(b), abduction: b.abduction };
    } else {
      // a double articulation (k͡p, ŋ͡m): both closures at once, released together
      ph = { ...a, ipa: sym, art: { ...a.art, ...b.art, velum: a.manner === 'nasal' ? NASAL_VELUM : 0 }, derived: true, dorsal: a.dorsal || b.dorsal };
    }
    return applyCommonMods(ph, seg.mods, ph.place);
  }
  const shifted = shiftedVowel(IPA_SPELLINGS[seg.base] ?? seg.base, seg.mods);
  if (shifted) {
    const ph = vowelFromChart(sym, shifted);
    return applyCommonMods(ph, seg.mods.filter((m) => !['raised', 'lowered', 'advanced', 'retracted', 'centralized', 'midCentralized'].includes(m)));
  }
  const b = baseOf(seg);
  if (!b) return null;
  if (!seg.mods.length) return b.ph.ipa === sym ? b.ph : { ...b.ph, ipa: sym };
  if (b.ph.manner === 'vowel') return applyCommonMods({ ...b.ph, art: { ...b.ph.art }, ipa: sym, derived: true }, seg.mods);
  return { ...applyConsonantMods(b, seg.mods, sym), derived: true };
}

/**
 * The phoneme of a written sound: a fitted one where it exists, otherwise
 * derived from the IPA chart and the diacritics (cached). Undefined for
 * symbols that are not IPA.
 */
export function phonemeFor(symbol: string, head?: Head): Phoneme | undefined {
  const base = canonPhoneme(symbol);
  if (!base || !head) return base;
  const shape = shapeOf(head);
  if (!shape) return base;
  const key = shapeKey(shape);
  let heads = adapted.get(key);
  if (!heads) {
    // a few heads at a time: the voice that speaks, the one being edited
    if (adapted.size >= 6) adapted.delete(adapted.keys().next().value!);
    heads = new Map();
    adapted.set(key, heads);
  }
  let ph = heads.get(symbol);
  if (!ph) { ph = adapt(base, shape); heads.set(symbol, ph); }
  return ph;
}

function canonPhoneme(symbol: string): Phoneme | undefined {
  const fitted = PHONEMES[symbol];
  if (fitted) return fitted;
  const hit = cache.get(symbol);
  if (hit !== undefined) return hit ?? undefined;
  const seg = segmentOf(symbol);
  const ph = seg ? fromSegment(symbol, seg) : null;
  cache.set(symbol, ph);
  return ph ?? undefined;
}

/** the phonemes adapted to each head shape lately asked for */
const adapted = new Map<string, Map<string, Phoneme>>();

/** on another head a sound's passage at its constriction stays between these shares of the one it has on the drawing's head */
const NARROWEST = 0.85;
const WIDEST = 1.2;
/** a vowel is aimed with the tongue body only when its narrowest passage is in the mouth, this far from the lips at most (cm); behind, with the root */
const VOWEL_MOUTH = 10;
/** no vowel narrows below this anywhere, cm² (narrower, it would start to hiss) */
const VOWEL_SAFE = 0.3;
/** a consonant's passage counts as the same within this share */
const SAME_PASSAGE = 0.06;
/** a consonant whose posture leaves a wider passage than this has no constriction to keep (a tap's posture) */
const CONSTRICTION = 0.4;
/** on another head an articulator may go this far past the range it keeps on the drawing's head */
const REACH = 0.6;
/** how far an articulator may move the opening way to keep a passage */
const OPENING = 1.5;
/** how far past its contact a closure made by a helping articulator presses */
const PRESS = 0.05;
/** where the front and the back closures of a click lie, cm from the lips (as the sequencer looks for them) */
const CLICK_FRONT: [number, number] = [0, 6];
const CLICK_BACK: [number, number] = [6.2, 12];

/** the values an articulator may take on another head: its range, a little further, and wherever it already is */
function reach(key: keyof Articulators, v0: number): [number, number] {
  const [lo, hi] = ARTICULATOR_RANGES[key];
  return [Math.min(v0, lo) - REACH, Math.max(v0, hi) + REACH];
}

/**
 * Moves one articulator of a posture until `open` holds and, if given,
 * `tooWide` does not: the least move from where it is. `dir` is the way the
 * articulator narrows the passage. Undefined if it is already right; `ok`
 * false if the articulator cannot get there.
 */
function aim(a: Articulators, key: keyof Articulators, dir: number, open: (x: Articulators) => boolean,
  tooWide?: (x: Articulators) => boolean): { value: number; ok: boolean; opening: boolean } | undefined {
  const v0 = a[key];
  const [lo, hi] = reach(key, v0);
  // opening, no further than OPENING from where it is (past that a posture stops making sense: a tongue pushed into the teeth)
  const shutEnd = dir > 0 ? hi : lo, openEnd = Math.max(lo, Math.min(hi, v0 - dir * OPENING));
  const at = (v: number) => ({ ...a, [key]: v });
  /** bisection between a value where `good` holds and one where it does not: the last one where it holds */
  const edge = (good: (v: number) => boolean, yes: number, no: number) => {
    for (let it = 0; it < 16; it++) {
      const m = 0.5 * (yes + no);
      if (good(m)) yes = m; else no = m;
    }
    return yes;
  };
  const isOpen = (v: number) => open(at(v));
  if (!isOpen(v0)) {
    if (!isOpen(openEnd)) return { value: openEnd, ok: false, opening: true };
    return { value: edge(isOpen, openEnd, v0), ok: true, opening: true };
  }
  if (tooWide && tooWide(at(v0))) {
    const narrow = (v: number) => !tooWide(at(v));
    let v = narrow(shutEnd) ? edge(narrow, shutEnd, v0) : shutEnd;
    const ok = narrow(v);
    if (!isOpen(v)) v = edge(isOpen, v0, v);
    return { value: v, ok, opening: false };
  }
  return undefined;
}

const rounded = (ph: Phoneme, key: keyof Articulators, v: number): Phoneme => ({ ...ph, art: { ...ph.art, [key]: Math.round(v * 1000) / 1000 } });

/** articulators and the way each narrows the passage */
type Lever = [keyof Articulators, number];
const BODY: Lever = ['tongueY', 1];
const TIP: Lever = ['tipY', 1];
const ROOT: Lever = ['tongueRoot', -1];
/** the whole body of the tongue back narrows the pharynx */
const FRONT: Lever = ['tongueX', -1];
const LIPS: Lever = ['lipOpen', -1];
const DORSAL_KEYS = new Set<keyof Articulators>(['tongueY', 'tongueX', 'tongueRoot']);

/**
 * The first articulator, in order, that brings a sound where `open` holds
 * and `tooWide` does not, moved as little as it takes; the sound as it was
 * if it is already there. If none can, the first one goes as far as it can
 * (a vowel left as open as the head allows rather than shut) and the sound
 * is marked approximate ('anatomy').
 */
function withLevers(ph: Phoneme, levers: Lever[], open: (x: Articulators) => boolean, tooWide?: (x: Articulators) => boolean): Phoneme {
  const a = baseArt(ph.art);
  let best: Phoneme | undefined;
  for (const [key, dir] of levers) {
    const r = aim(a, key, dir, open, tooWide);
    if (!r) return ph;
    if (r.ok) return rounded(ph, key, r.value);
    // as open as it gets, rather than shut; an articulator that cannot narrow the passage is not moved for nothing
    if (r.opening) best ??= rounded(ph, key, r.value);
  }
  return { ...(best ?? ph), approx: ph.approx ?? 'anatomy' };
}

/**
 * A sound made on the drawing's head, made again on another head: the same
 * constriction at the same place (motor equivalence: a speaker aims at the
 * constriction, not at a posture; Perkell et al. 1993).
 * - A stop or a nasal closes, pressing as far past the new contact as it
 *   pressed past the old one.
 * - A fricative, an approximant or a trill leaves the same passage at its
 *   place, with the articulator that makes it (or the body of the tongue if
 *   that one cannot); a dorsal one, wherever the body narrows the tract. If
 *   the head narrows the tract somewhere else (a low palate over the dorsum
 *   of a [ɻ]), the body comes down, or the root forward, until it is no
 *   narrower there than NARROWEST of the sound's passage.
 * - A lateral keeps the passage at its sides with the margins of the tongue
 *   (or, behind a closure of the tip, with the body or the root).
 * - A vowel keeps its passage between NARROWEST and WIDEST at its own
 *   constriction (only from narrowing if that is in the pharynx: a wide
 *   pharynx stays the head's timbre) and no narrower than VOWEL_SAFE
 *   anywhere, with the body of the tongue, the tip (an r-coloured vowel) or
 *   the root.
 * What is left of the difference is the head's timbre. Where the head does
 * not let the tongue get there, the sound is marked approximate
 * ('anatomy'). A click keeps both its closures shut. Affricates (their parts
 * are adapted one by one) and the glottals keep their posture.
 */
function adapt(ph: Phoneme, head: Head): Phoneme {
  if (ph.manner === 'vowel') return adaptVowel(ph, head);
  if (ph.parts) return ph;
  const a = baseArt(ph.art);
  const canon = measure(a);
  const anywhere = (x: Articulators) => measure(x, undefined, head).min;
  const ck = closingKey(ph);
  if (ph.airstream === 'click') {
    // both closures stay shut: the front one with its articulator, the back one with the body
    let out = ph;
    const closures: [[number, number], Lever[]][] = [[CLICK_FRONT, ck ? [[ck.key, ck.dir], ['jaw', -1]] : [BODY]], [CLICK_BACK, [BODY]]];
    for (const [w, levers] of closures) {
      if (measure(a, w).inWindow >= CLOSED) continue;
      const shut = (x: Articulators) => measure(x, w, head).inWindow < CLOSED;
      let done = false;
      for (const [k, d] of levers) {
        const r = aim(baseArt(out.art), k, -d, shut);
        if (!r) { done = true; break; }
        if (r.ok) { out = rounded(out, k, r.value + d * PRESS); done = true; break; }
      }
      if (!done) out = { ...out, approx: out.approx ?? 'anatomy' };
    }
    return out;
  }
  if (ph.manner === 'lateral') {
    // the passage at the sides; a closure of the dorsum (a velar lateral) must not be opened to widen it
    const own = canon.min;
    if (own < CLOSED || Math.abs(anywhere(a) - own) <= SAME_PASSAGE * own) return ph;
    const levers: Lever[] = ck && DORSAL_KEYS.has(ck.key) ? [['tongueSides', -1]] : [['tongueSides', -1], BODY, ROOT, FRONT];
    return withLevers(ph, levers, (x) => anywhere(x) >= NARROWEST * own, (x) => anywhere(x) > WIDEST * own);
  }
  if (!ck) return ph;
  const { key, dir } = ck;
  const v0 = a[key];
  const [lo, hi] = reach(key, v0);
  const shutEnd = dir > 0 ? hi : lo;
  const passage = (v: number, h?: Head) => measure(baseArt({ ...ph.art, [key]: v }), undefined, h).min;
  if (canon.min < CLOSED) {
    // where the passage shuts, coming from open: null if it never opens, undefined if it never shuts
    const contact = (h?: Head): number | null | undefined => {
      let o = Math.max(lo, Math.min(hi, v0 - 2 * dir)), c = shutEnd;
      if (passage(o, h) < CLOSED) return null;
      if (passage(c, h) >= CLOSED) return undefined;
      for (let it = 0; it < 16; it++) {
        const m = 0.5 * (o + c);
        if (passage(m, h) < CLOSED) c = m; else o = m;
      }
      return c;
    };
    const c0 = contact();
    if (c0 == null) return ph;
    const c1 = contact(head);
    if (c1 === null) return ph;
    if (c1 === undefined) {
      // the articulator alone cannot shut it on this head (a tip held back by a short frenulum): the jaw
      // comes up with it (and the tip with the jaw), or else the body of the tongue
      const shut = rounded(ph, key, shutEnd);
      const closes = (x: Articulators) => measure(x, undefined, head).min < CLOSED;
      for (const [k2, d2] of [['jaw', -1], BODY] as Lever[]) {
        if (k2 === key) continue;
        // aim() moves the opening way of its `dir`: asked for the other way, it closes
        const r = aim(baseArt(shut.art), k2, -d2, closes);
        if (!r) return shut;
        // and a little past the contact, as a closure presses
        if (r.ok) return rounded(shut, k2, r.value + d2 * PRESS);
      }
      return { ...shut, approx: ph.approx ?? 'anatomy' };
    }
    return Math.abs(c1 - c0) < 1e-3 ? ph : rounded(ph, key, v0 + (c1 - c0));
  }
  if (canon.min > CONSTRICTION) return ph;
  const dorsal = DORSAL_KEYS.has(key);
  // a dorsal sound's passage is wherever the body narrows the tract; another's is at its place
  const win: [number, number] = [Math.max(0, canon.at - 1.1), canon.at + 1.1];
  const own = dorsal ? canon.min : measure(a, win).inWindow;
  const atPlace = dorsal ? anywhere : (x: Articulators) => measure(x, win, head).inWindow;
  let out = ph;
  if (Math.abs(atPlace(a) - own) > SAME_PASSAGE * own) {
    // (a rounded one, [w], also narrows at the lips)
    const levers: Lever[] = dorsal ? [[key, dir], key === 'tongueX' ? BODY : FRONT, LIPS] : [[key, dir], BODY, LIPS];
    out = withLevers(ph, levers, (x) => atPlace(x) >= (1 - SAME_PASSAGE) * own, (x) => atPlace(x) > (1 + SAME_PASSAGE) * own);
  }
  if (dorsal) return out;
  // nowhere else narrower than the sound's own passage allows
  const keep = NARROWEST * canon.min;
  const placed = out.approx === 'anatomy' && ph.approx !== 'anatomy' ? 0 : NARROWEST * own;
  return withLevers(out, [BODY, ROOT, FRONT], (x) => anywhere(x) >= keep && atPlace(x) >= placed);
}

function adaptVowel(ph: Phoneme, head: Head): Phoneme {
  const a = baseArt(ph.art);
  const c = measure(a);
  const mouth = c.at <= VOWEL_MOUTH;
  const win: [number, number] = [Math.max(0, c.at - 1.5), c.at + 1.5];
  const own = measure(a, win).inWindow;
  const safe = Math.min(NARROWEST * c.min, VOWEL_SAFE);
  const open = (x: Articulators) => {
    const m = measure(x, win, head);
    return m.inWindow >= NARROWEST * own && m.min >= safe;
  };
  const tooWide = mouth ? (x: Articulators) => measure(x, win, head).inWindow > WIDEST * own : undefined;
  return withLevers(ph, mouth ? [BODY, LIPS, TIP, ROOT, FRONT] : [ROOT, FRONT, BODY], open, tooWide);
}

/** Something about a transcription the listener should know: a symbol not read, or a sound only approximated. */
export interface SoundNote {
  symbol: string;
  kind: 'unknown' | 'ignored' | 'approximate';
  /** why it is approximate (approximate notes) */
  code?: ApproxCode;
}

/** What the model does not read or only approximates in an IPA transcription (without its delimiters). */
export function notesForIpa(ipa: string): SoundNote[] {
  const r = readIpa(ipa);
  const out: SoundNote[] = r.notes.map((n) => ({ symbol: n.symbol, kind: n.kind }));
  const seen = new Set<string>();
  for (const p of r.phones) {
    if (seen.has(p.ipa)) continue;
    seen.add(p.ipa);
    const ph = phonemeFor(p.ipa);
    if (!ph) out.push({ symbol: p.ipa, kind: 'unknown' });
    else {
      const parts = ph.parts?.map((s) => phonemeFor(s)) ?? [];
      const code = ph.approx ?? parts.find((q) => q?.approx)?.approx;
      if (code) out.push({ symbol: p.ipa, kind: 'approximate', code });
    }
  }
  return out;
}


/** Every symbol of the chart, with the phoneme the model makes of it. */
export function chartPhonemes(): Phoneme[] {
  return [...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS)].map((s) => phonemeFor(s)).filter((p): p is Phoneme => !!p);
}
