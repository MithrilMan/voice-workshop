import { Articulators, ARTICULATOR_KEYS, ARTICULATOR_RANGES, DEFAULT_ARTICULATORS } from '../tract/types';
import { PHONEMES, Phoneme, FlickKey } from './phonemes';
import { Phone, Lang } from './g2p';
import { Score, ScoreFrame, ScorePhone } from '../engine/params';
import { TamChannel, TAM_TAU } from './tam';
import { phonemeFor, constrictionOf, contactPoint, passageIn, closingKey, CLOSED_AREA, Head, shapeOf, shapeKey } from './derive';
import { IPA_CONSONANTS, IPA_VOWELS, Place } from './ipa';
import { normalizeIpa } from './ipaReader';
import { ProsodyStyle, styleOf, lengthen, ST } from './style';
import { Setting, settingOf, isNeutral, adjust, nasalizable } from '../voice/setting';
import { LanguageProsody, prosodyOf } from './languages';
import { Rng } from '../util/rng';

/**
 * Turns phones into a gestural score: piecewise targets for every articulator
 * and for the source (abduction, F0, lung pressure, voice quality). The engine
 * smooths the articulator targets with critically damped dynamics (TAM), so
 * movements overlap.
 *
 * What makes it sound like speech, each part switchable (NaturalnessOptions):
 *
 * - timing: segment durations from context rules. English follows Klatt
 *   (1979): every sound has an inherent and a minimum duration, and
 *   multiplicative rules shorten or lengthen the compressible part (phrase-final
 *   lengthening, unstressed and polysyllabic shortening, the voicing of the
 *   next consonant, clusters). Italian uses rules of the same kind from the
 *   phonetics of Italian: long stressed vowels in open syllables, short ones
 *   before geminates and clusters, geminates about twice as long as single
 *   consonants, phrase-final lengthening.
 * - intonation: the Fujisaki model (Fujisaki & Hirose 1984). log F0 is a floor
 *   plus the responses to phrase commands (impulses, a slow rise and decay:
 *   declination) and accent commands (steps on stressed syllables of content
 *   words, smoothed). Statements end with a final lowering, yes/no questions
 *   with a rise, phrases before a comma with a small continuation rise.
 * - micro: microprosody (high vowels have a slightly higher F0, voiceless
 *   consonants raise the onset of the next vowel, voiced ones lower it) and
 *   flutter, the slow F0 wander of a living voice.
 * - voiceQuality: stressed syllables get more lung pressure and a slightly
 *   tenser source, phrase ends relax into a breathier voice.
 * - coarticulation (Öhman 1966): a consonant only sets the articulators it
 *   needs; the others are interpolated from the surrounding vowels, so the
 *   tongue body glides from vowel to vowel through /p/ or /t/, and the lips
 *   round ahead of /u/. Without it every sound sets every articulator.
 */
export interface NaturalnessOptions {
  timing: boolean;
  intonation: boolean;
  micro: boolean;
  voiceQuality: boolean;
  coarticulation: boolean;
}

export const NATURAL_ALL: NaturalnessOptions = { timing: true, intonation: true, micro: true, voiceQuality: true, coarticulation: true };

export interface ProsodyOptions {
  /** base pitch, Hz (the speaker's usual speaking pitch) */
  f0: number;
  /** strength of the pitch accents, semitones */
  accent: number;
  /** speaking rate multiplier (>1 faster) */
  rate: number;
  /** lung pressure, cm H2O */
  ps: number;
  /** language: durations, aspiration, accent alignment (rules for 'it' and 'en'; another language comes as literal phones) */
  lang: Lang | string;
  /**
   * said as written, with no language's rules: durations from the sounds and
   * the length marks, aspiration only where it is written, syllables from the
   * breaks or the sonority of the clusters (a [phonetic] transcription; by
   * default when its phones say so)
   */
  literal?: boolean;
  /** optional user contour: points (t in 0..1 of the utterance, f0 in Hz) */
  contour?: { t: number; f0: number }[];
  /** articulatory lead of targets before the acoustic segment, s */
  lead: number;
  natural: NaturalnessOptions;
  /**
   * how much slower (>1) or faster (<1) each articulator moves than usual: its
   * time constant is multiplied by this while the utterance plays, and the
   * planner's own runs of the target dynamics use the same
   */
  tauScale?: Partial<Record<keyof Articulators, number>>;
  /** the speaker's way of speaking: melody, pauses, accents, phrase ends (the planner's own values by default) */
  style?: Partial<ProsodyStyle>;
  /**
   * a living speaker: with a seed every syllable, pause and accent is a
   * little different, by the style's variation, and differently for each
   * seed (the same seed, the same saying); without one the rules alone,
   * the same every time
   */
  seed?: number;
  /** the speaker's articulatory setting: the posture kept beneath every sound (none by default) */
  setting?: Partial<Setting>;
  /**
   * how carefully the speaker articulates, -1 (slack, hypoarticulated) .. 0
   * (as usual) .. 1 (crisp, hyperarticulated): the tongue body, jaw and lip
   * rounding move faster or slower, aim further past a short vowel or less
   * far, and the vowels spread out toward the corners of the vowel space or
   * fall in toward schwa, the unstressed ones most (Lindblom 1990)
   */
  precision?: number;
  /**
   * the speaker's head (anatomy and teeth): every sound is aimed at the same
   * constriction in the same place as on the drawing's head (the reference
   * head by default)
   */
  head?: Head;
}

/** Options of buildScore: any prosody option, and any subset of the naturalness ingredients. */
export type ScoreOptions = Partial<Omit<ProsodyOptions, 'natural'>> & { natural?: Partial<NaturalnessOptions> };

export const DEFAULT_PROSODY: ProsodyOptions = { f0: 120, accent: 5, rate: 1, ps: 8, lang: 'it', lead: 0.03, natural: NATURAL_ALL };

type Part = 'closure' | 'release' | 'aspiration' | 'frication';

interface Seg {
  ipa: string;
  ph: Phoneme;
  t0: number;
  t1: number;
  /** index of the phone in the input */
  unit: number;
  part?: Part;
  label: string;
}

/** A phone with its prosodic context. */
interface Unit {
  p: Phone;
  ph: Phoneme;
  vowel: boolean;
  word: number;
  /** syllable index in the utterance, and the vowel that is its nucleus */
  syl: number;
  /** first and last phone index of the word */
  w0: number;
  w1: number;
  /** syllable has a primary stress */
  stressed: boolean;
  /** consonant after the nucleus of its syllable */
  coda: boolean;
  /** the syllable is the last one before a pause or the end */
  phraseFinal: boolean;
  /** kind of boundary that ends the phrase of this phone */
  boundary: 'comma' | 'stop' | 'question' | 'wh';
  wordFinalSyl: boolean;
  polysyllabic: boolean;
  dur: number;
  /** the part of its duration that a faster voice cannot take away, s */
  floor: number;
}

const FRAME = 0.005;
/** how much earlier than its sound a consonant gesture starts (s) */
const CONS_ONSET = 0.02;
/** how long before its sound a closure may be found shut already, when its timing is measured (s) */
const SHUT_EARLY = 0.02;
/** the articulators that set out earlier for a closure that would be late: the slow ones of the mouth (the tip and the lips are quick, and wait) */
const EARLY = new Set<keyof Articulators>(ARTICULATOR_KEYS.filter((k) => TAM_TAU[k] > 0.01 && k !== 'velum' && k !== 'larynx' && k !== 'epilarynx'));
/** a fricative is taken for made when its passage is within this of the one it is held with */
const FRIC_NEAR = 1.5;
/** how far into its sound a fricative may still be narrowing (s) */
const FRIC_ONSET = 0.015;
/** how long before its planned release a consonant lets its target go (s) */
const RELEASE_LEAD = 0.012;
/** articulators that keep the middle of a vowel for the vowel, and how many of
 *  their time constants before that middle a consonant may claim them */
const PROTECTED = new Set<string>(['tipX', 'tipY', 'tongueX', 'tongueY', 'velum']);
const CORE = 0.75;
/** a click: how long its back closure outlasts the front one (s), the keys that make it, and where each closure lies (cm from the lips) */
const CLICK_LAG = 0.025;
const CLICK_BACK = new Set<string>(['tongueX', 'tongueY', 'tongueRoot', 'jaw']);
const CLICK_FRONT: [number, number] = [0, 6];
const CLICK_BACK_WINDOW: [number, number] = [6.2, 12];
const trillContacts = new Map<string, number>();
/** where the trilling articulator of a phoneme meets the other side (cached: it takes a dozen geometries) */
function trillContact(ph: Phoneme, key: FlickKey, toward: number, shape?: Head): number {
  const id = `${ph.ipa}|${key}|${toward}|${JSON.stringify(ph.art)}|${shapeKey(shape)}`;
  let c = trillContacts.get(id);
  if (c === undefined) {
    if (trillContacts.size > 2000) trillContacts.clear();
    c = contactPoint(ph.art, key, toward, shape);
    trillContacts.set(id, c);
  }
  return c;
}
/** articulators whose vowel targets are aimed so that the middle of the vowel
 *  reaches them, and how far past the target they may aim, as a share of the
 *  way still to go */
const COMPENSATED: (keyof Articulators)[] = ['tongueX', 'tongueY', 'tongueRoot', 'jaw', 'lipRound', 'lipProtrude'];
const OVERSHOOT = 0.6;
/** precision: the articulators that move faster or slower, and the ones whose vowel targets spread out or fall in toward schwa */
const SLOW_KEYS: (keyof Articulators)[] = ['tongueX', 'tongueY', 'tongueRoot', 'jaw', 'lipRound', 'lipProtrude'];
const VOWEL_KEYS = new Set<string>(['tongueX', 'tongueY', 'tongueRoot', 'jaw', 'lipRound', 'lipProtrude', 'lipOpen']);
/** how far the voice drops into vocal fry, semitones (fry is about 25-70 Hz: Hollien & Michel 1968) */
const FRY_DROP = 7;
const isObstruent = (ph: Phoneme | undefined) => !!ph && (ph.manner === 'stop' || ph.manner === 'fricative' || ph.manner === 'affricate');
const isCons = (u: Unit | undefined) => !!u && !u.vowel && u.ph.manner !== 'silence';
/** the nucleus of a syllable: a vowel unless marked non-syllabic, or a consonant marked syllabic */
const isNucleus = (ph: Phoneme) => (ph.manner === 'vowel' && !ph.nonSyllabic) || !!ph.syllabic;

/** place of articulation of a stop, from the chart for the fitted ones */
const placeOf = (ph: Phoneme): Place | undefined => ph.place ?? IPA_CONSONANTS[ph.ipa]?.place;
/** voice onset time of aspirated stops by place (Cho & Ladefoged 1999: further back, longer) */
const VOT: Partial<Record<Place, number>> = {
  bilabial: 0.055, labiodental: 0.055, dental: 0.065, alveolar: 0.065, postalveolar: 0.065, retroflex: 0.065,
  alveolopalatal: 0.07, palatal: 0.07, velar: 0.075, uvular: 0.08, pharyngeal: 0.08, epiglottal: 0.08,
};
/** the short voice lag of unaspirated voiceless stops by place */
const SHORT_LAG: Partial<Record<Place, number>> = {
  bilabial: 0.008, labiodental: 0.008, dental: 0.012, alveolar: 0.012, postalveolar: 0.012, retroflex: 0.012,
  alveolopalatal: 0.016, palatal: 0.016, velar: 0.02, uvular: 0.022, pharyngeal: 0.022, epiglottal: 0.022,
};
/** the folds of such a stop: how long before the release they come together again (s), and how far apart they stay */
const STIFF_LEAD = 0.045;
/** how far the walls are let go behind a voiced stop (1: as an implosive's) */
const VOICED_SLACK = 0.2;
const STIFF_ABD = 0.12;
/** height of a vowel on the chart (its first symbol), for its intrinsic pitch */
const vowelHeight = (ipa: string): number | undefined => IPA_VOWELS[normalizeIpa(ipa)[0]]?.height;

/** sonority of a sound, for the syllables of a [phonetic] transcription */
function sonority(ph: Phoneme): number {
  switch (ph.manner) {
    case 'stop': case 'affricate': case 'glottalStop': return 0;
    case 'fricative': case 'glottal': return 1;
    case 'nasal': return 2;
    case 'lateral': case 'trill': case 'tap': return 3;
    case 'approximant': return 4;
    default: return 5;
  }
}

// ------------------------------------------------------------------ context

/** Legal two-consonant onsets (both languages): stop/f + liquid or glide, s + consonant. */
function legalOnset(a: string, b: string): boolean {
  const liquids = ['l', 'ɫ', 'r', 'ɹ', 'w', 'j', 'ɾ'];
  if (a === 's' || a === 'z' || a === 'ʃ') return b !== 's' && b !== 'z';
  if (['p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ'].includes(a)) return liquids.includes(b);
  return false;
}

/**
 * How many consonants before a vowel open its syllable: a written syllable
 * break decides; otherwise English and Italian keep at most a legal two-sound
 * onset, and a [phonetic] transcription the longest one rising in sonority
 * toward the vowel (with /s/ before a stop, as in most languages that allow
 * clusters).
 */
function onsetStart(onset: Unit[], literal: boolean): number {
  const n = onset.length;
  for (let j = n - 1; j >= 0; j--) if (onset[j].p.sylStart) return j;
  if (!literal) {
    if (n >= 2 && legalOnset(onset[n - 2].p.ipa, onset[n - 1].p.ipa)) return n - 2;
    return Math.max(0, n - 1);
  }
  let first = n - 1;
  while (first > 0 && sonority(onset[first - 1].ph) < sonority(onset[first].ph)) first--;
  if (first > 0 && /^[sʃ]$/.test(onset[first - 1].p.ipa) && sonority(onset[first].ph) === 0) first--;
  return Math.max(0, first);
}

function analyse(phones: Phone[], literal = false, shape?: Head): Unit[] {
  const units: Unit[] = [];
  let word = 0;
  for (let i = 0; i < phones.length; i++) {
    const p = phones[i];
    const ph = phonemeFor(p.ipa, shape);
    if (!ph) continue;
    const prevU = units[units.length - 1];
    if (p.wordStart && prevU && !prevU.p.wordEnd && !prevU.p.pause) word++;
    units.push({
      p, ph, vowel: isNucleus(ph), word, syl: -1, w0: 0, w1: 0, stressed: false, coda: false,
      phraseFinal: false, boundary: 'stop', wordFinalSyl: false, polysyllabic: false, dur: 0, floor: 0,
    });
    if (p.wordEnd || p.pause) word++;
  }
  if (!units.length) return units;
  // word extents
  for (let i = 0; i < units.length; i++) {
    let a = i, b = i;
    while (a > 0 && units[a - 1].word === units[i].word) a--;
    while (b < units.length - 1 && units[b + 1].word === units[i].word) b++;
    units[i].w0 = a; units[i].w1 = b;
  }
  // syllables: one per vowel; consonants go to the next vowel if they form a legal onset
  let syl = -1;
  const nucleus: number[] = [];
  for (let i = 0; i < units.length; i++) if (units[i].vowel) nucleus.push(i);
  for (let s = 0; s < nucleus.length; s++) {
    const v = nucleus[s];
    const u = units[v];
    syl = s;
    u.syl = syl;
    u.stressed = !!u.p.stress;
    // consonants before the vowel within the word
    let k = v - 1;
    const onset: number[] = [];
    while (k >= u.w0 && !units[k].vowel) { onset.unshift(k); k--; }
    // word-initial clusters are all onset; word-internal ones keep at most a legal onset
    let first = 0;
    if (k >= u.w0) {
      const n = onset.length;
      // a break written just before the vowel leaves all the consonants to the syllable before
      first = u.p.sylStart ? n : onsetStart(onset.map((j) => units[j]), literal);
      // the first half of a geminate closes the previous syllable
      if (n >= 1 && units[onset[n - 1]].p.long) first = n - 1;
    }
    for (let j = 0; j < onset.length; j++) {
      const c = units[onset[j]];
      if (j >= first) { c.syl = syl; c.coda = false; } else { c.syl = s - 1; c.coda = true; }
    }
    // word-final consonants belong to the last syllable
    if (s === nucleus.length - 1 || units[nucleus[s + 1]].word !== u.word) {
      for (let j = v + 1; j <= u.w1; j++) if (!units[j].vowel) { units[j].syl = syl; units[j].coda = true; }
    }
  }
  // geminates close their syllable too
  for (const u of units) if (u.p.long && !u.vowel) u.coda = false;
  // words without a vowel (rare): attach to the previous syllable
  for (const u of units) if (u.syl < 0) u.syl = Math.max(0, syl);
  // stress of a syllable from its nucleus
  const sylStress = new Map<number, boolean>();
  for (const v of nucleus) sylStress.set(units[v].syl, !!units[v].p.stress);
  for (const u of units) u.stressed = sylStress.get(u.syl) ?? false;
  // phrases: up to a pause or the end; the last syllable of each is phrase-final
  let start = 0;
  for (let i = 0; i < units.length; i++) {
    const last = i === units.length - 1;
    const pz = units[i].p.pause;
    if (!pz && !last) continue;
    const end = i;
    const boundary: Unit['boundary'] = units[i].p.whQuestion ? 'wh' : units[i].p.question ? 'question' : pz === 'short' ? 'comma' : 'stop';
    let lastSyl = -1;
    for (let j = end; j >= start; j--) if (units[j].vowel) { lastSyl = units[j].syl; break; }
    for (let j = start; j <= end; j++) {
      units[j].boundary = boundary;
      if (units[j].syl === lastSyl) units[j].phraseFinal = true;
    }
    start = i + 1;
  }
  // word-level flags
  for (const u of units) {
    let nv = 0, lastSyl = -1;
    for (let j = u.w0; j <= u.w1; j++) if (units[j].vowel) { nv++; lastSyl = units[j].syl; }
    u.polysyllabic = nv > 1;
    u.wordFinalSyl = u.syl === lastSyl;
  }
  return units;
}

// ---------------------------------------------------------------- durations

/** Klatt (1979) inherent and minimum durations, ms (American English). */
const KLATT: Record<string, [number, number]> = {
  i: [155, 55], 'ɪ': [135, 40], 'eɪ': [190, 100], 'ɛ': [150, 70], 'æ': [230, 80], 'ɑ': [240, 100], 'ɔ': [240, 100], 'oʊ': [220, 80],
  'ʊ': [160, 60], u: [210, 70], 'ʌ': [140, 60], 'ə': [120, 60], 'ɝ': [180, 80], 'ɚ': [180, 80], 'aɪ': [250, 150], 'aʊ': [260, 100],
  'ɔɪ': [280, 150], a: [230, 80], e: [190, 100], o: [220, 80],
  p: [90, 50], t: [75, 50], k: [80, 60], b: [85, 60], d: [75, 50], g: [80, 60], 'tʃ': [140, 90], 'dʒ': [120, 80], ts: [130, 90], dz: [120, 80],
  f: [100, 80], 'θ': [90, 60], s: [105, 60], 'ʃ': [105, 80], v: [60, 40], 'ð': [50, 30], z: [75, 40], 'ʒ': [70, 40], h: [80, 20],
  m: [70, 60], n: [60, 50], 'ŋ': [95, 60], l: [80, 40], 'ɫ': [80, 40], 'ɹ': [80, 30], w: [80, 60], j: [80, 40], 'ɾ': [20, 20], 'ʔ': [50, 30],
  r: [80, 40], 'ɲ': [90, 60], 'ʎ': [90, 60],
};

/**
 * The breath taken in a pause, s: how long after the last sound it begins,
 * how long before the next one it is over, how long it takes to start and to
 * stop, and the shortest one worth taking.
 */
const BREATH = { after: 0.03, before: 0.07, edge: 0.06, least: 0.12 };

/** the share of a sound that cannot be shortened, where no table gives its minimum duration */
const NEUTRAL_FLOOR = { vowel: 0.45, consonant: 0.65 };

/**
 * The least that is left, in the fastest speech, of the part of a sound that
 * can be shortened. With a quarter left the vowels are near their minimum
 * durations and the whole is about 1.5 times as fast: past that, everything
 * is shortened together.
 */
const RATE_LEAST = 0.25;
/** how far past the channel of its hiss the tip of a fricated /t/ is pressed to shut it */
const FRICATED_PRESS = 0.5;
/** the passage through which the breath behind a fricated stop is first heard (cm²) */
const FRICATED_OPEN = 0.01;

/** Inherent and minimum durations for Italian, ms (stops: closure plus release). */
const ITALIAN: Record<string, [number, number]> = {
  a: [120, 55], e: [115, 50], 'ɛ': [118, 52], o: [115, 50], 'ɔ': [118, 52], i: [100, 45], u: [100, 45], 'ə': [80, 40],
  p: [95, 60], t: [88, 55], k: [95, 60], b: [78, 50], d: [72, 45], g: [78, 50], 'tʃ': [115, 75], 'dʒ': [100, 65], ts: [120, 80], dz: [105, 70],
  f: [100, 65], v: [70, 45], s: [105, 65], z: [75, 45], 'ʃ': [105, 75], m: [75, 50], n: [70, 45], 'ɲ': [95, 65], 'ŋ': [70, 45], 'ɱ': [70, 45],
  l: [65, 40], 'ʎ': [95, 65], r: [70, 50], 'ɾ': [25, 20], j: [60, 40], w: [60, 40], h: [70, 30],
};

function englishDuration(u: Unit, next: Unit | undefined, prev: Unit | undefined, st: ProsodyStyle): number {
  const [inh, min0] = KLATT[u.p.ipa] ?? [u.ph.dur * 1000, u.ph.dur * 500];
  let min = min0;
  let pr = 1;
  const clauseFinal = u.phraseFinal && u.boundary !== 'comma';
  if (u.vowel) {
    if (u.phraseFinal) pr *= lengthen(clauseFinal ? 1.4 : 1.2, st); // phrase-final lengthening
    else pr *= 0.6; // non-phrase-final shortening
    if (!u.wordFinalSyl) pr *= 0.85;
    if (u.polysyllabic) pr *= 0.8;
    if (!u.p.stress && !u.p.stress2) { pr *= u.p.reduced || u.p.func ? 0.5 : 0.7; min *= 0.5; }
    // the next consonant in the word (or none at the end of the word)
    const nx = next && next.word === u.word ? next : undefined;
    let f = 1;
    if (!nx) f = u.phraseFinal ? 1.2 : 1;
    else if (nx.vowel) f = 1.2;
    else if (nx.ph.manner === 'fricative' && nx.ph.voiced) f = 1.6;
    else if (nx.ph.manner === 'stop' && nx.ph.voiced) f = 1.2;
    else if (nx.ph.manner === 'nasal') f = 0.85;
    else if ((nx.ph.manner === 'stop' || nx.ph.manner === 'affricate') && !nx.ph.voiced) f = 0.7;
    pr *= u.phraseFinal ? f : 1 + 0.5 * (f - 1);
  } else {
    if (!(u.p.wordStart || prev?.word !== u.word)) pr *= 0.85; // non-initial consonants
    if (!u.stressed) pr *= 0.7;
    const pc = isCons(prev) && prev!.word === u.word, nc = isCons(next) && next!.word === u.word;
    if (pc && nc) pr *= 0.5; else if (pc || nc) pr *= 0.7;
    if (u.phraseFinal && u.coda) pr *= lengthen(1.4, st);
  }
  u.floor = min / 1000;
  return (min + (inh - min) * pr) / 1000;
}

function italianDuration(u: Unit, next: Unit | undefined, prev: Unit | undefined, st: ProsodyStyle): number {
  const [inh, min0] = ITALIAN[u.p.ipa] ?? KLATT[u.p.ipa] ?? [u.ph.dur * 1000, u.ph.dur * 500];
  let min = min0;
  let pr = 1;
  if (u.vowel) {
    const nx = next && next.word === u.word ? next : undefined;
    // a syllable is closed by a coda consonant or by the first half of a geminate
    const closed = !!nx && !nx.vowel && (nx.coda || !!nx.p.long);
    if (u.p.stress) pr *= closed ? 0.75 : 1.55;
    else if (u.p.func) { pr *= 0.35; min *= 0.7; }
    else { pr *= 0.45; min *= 0.75; }
    if (u.phraseFinal) pr *= lengthen(u.boundary === 'comma' ? 1.2 : 1.4, st);
    if (!u.p.stress && u.wordFinalSyl && !u.p.func) pr *= 1.1;
  } else {
    if (u.p.wordStart) pr *= 1.05;
    const pc = isCons(prev) && prev!.word === u.word, nc = isCons(next) && next!.word === u.word;
    if (pc || nc) pr *= 0.8;
    if (!u.stressed) pr *= 0.9;
    if (u.phraseFinal && u.coda) pr *= lengthen(1.3, st);
  }
  let d = min + (inh - min) * pr;
  if (u.p.long && !u.vowel) d *= 1.85;
  u.floor = (min * (u.p.long && !u.vowel ? 1.85 : 1)) / 1000;
  return d / 1000;
}

/**
 * Durations of a [phonetic] transcription, which belongs to no language
 * whose rules are known: the nominal duration of each sound, longer when
 * stressed, at the end of a phrase or written long, shorter unstressed, in a
 * closed syllable or in a cluster. Syllabic consonants last about as long as
 * a short vowel.
 */
function neutralDuration(u: Unit, next: Unit | undefined, prev: Unit | undefined, st: ProsodyStyle, lp?: LanguageProsody): number {
  let d = u.ph.dur;
  const final = (f: number) => lengthen(Math.pow(f, lp?.final ?? 1), st);
  if (u.vowel) {
    if (u.ph.manner !== 'vowel') d *= 1.6;
    const rhythm = lp?.rhythm;
    // stress feet squeeze the unstressed vowels; morae leave the stress out of the length
    if (rhythm === 'stress') { if (u.p.stress) d *= 1.35; else if (!u.p.stress2) d *= u.p.func ? 0.5 : 0.62; }
    else if (rhythm !== 'mora') { if (u.p.stress) d *= rhythm ? 1.15 : 1.25; else if (!u.p.stress2) d *= rhythm ? 0.9 : 0.85; }
    if (u.phraseFinal) d *= final(u.boundary === 'comma' ? 1.2 : 1.4);
    const nx = next && next.word === u.word ? next : undefined;
    if (rhythm !== 'mora' && nx && !nx.vowel && (nx.coda || nx.p.long)) d *= 0.85;
    if (u.p.long) d *= rhythm === 'mora' ? 2 : 1.7;
  } else {
    const pc = isCons(prev) && prev!.word === u.word, nc = isCons(next) && next!.word === u.word;
    if (pc || nc) d *= 0.85;
    if (u.phraseFinal && u.coda) d *= final(1.25);
    if (u.p.long) d *= lp?.rhythm === 'mora' ? 2.2 : 1.85;
    // a tense (fortis) consonant holds its closure longer (Korean: Cho, Jun & Ladefoged 2002)
    if (u.ph.fortis) d *= 1.3;
  }
  // (no table of minimum durations for a language read from its transcription:
  // the share they have in the Italian and English ones)
  u.floor = d * (u.vowel ? NEUTRAL_FLOOR.vowel : NEUTRAL_FLOOR.consonant);
  return d;
}

// ------------------------------------------------------------------ Fujisaki

const ALPHA = 2.0; // phrase control, 1/s
const GAMMA = 0.9; // ceiling of the accent response
const gp = (t: number) => (t > 0 ? ALPHA * ALPHA * t * Math.exp(-ALPHA * t) : 0);
const ga = (t: number, beta: number) => (t > 0 ? Math.min(1 - (1 + beta * t) * Math.exp(-beta * t), GAMMA) : 0);

interface Command { t1: number; t2: number; a: number; beta: number }

/**
 * How much a living speaker varies at variation 1: the standard deviations
 * of log-normal factors on the length of each syllable (half of it a tempo
 * that drifts over a few syllables), of each pause, on the height of each
 * pitch accent, of the phrase commands and of the boundary tones, and on
 * the push and tension of each stressed syllable and the relaxing of each
 * phrase end. Chosen, not measured.
 */
const VARY = { tempo: 0.08, drift: 0.7, pause: 0.2, accent: 0.2, phrase: 0.15, boundary: 0.15, push: 0.3, end: 0.2 };

// ---------------------------------------------------------------- the score

export function buildScore(phones: Phone[], opts: ScoreOptions = {}): Score {
  const o: ProsodyOptions = { ...DEFAULT_PROSODY, ...opts, natural: { ...NATURAL_ALL, ...(opts.natural ?? {}) } };
  const nat = o.natural;
  const st = styleOf(o.style);
  // a living speaker (a seed): one random stream for each kind of variation,
  // so that one kind does not shift another's draws
  const live = o.seed !== undefined && st.variation > 0 ? st.variation : 0;
  const streams = new Map<number, Rng>();
  const draw = (stream: number): number => {
    let r = streams.get(stream);
    if (!r) streams.set(stream, (r = new Rng(((o.seed! | 0) * 7919 + stream * 104729) | 0)));
    return r.gauss();
  };
  /** a random factor around 1 (log-normal, sd at variation 1), 1 without a seed */
  const vary = (stream: number, sd: number): number => (live ? Math.exp(live * sd * draw(stream)) : 1);
  const rate = Math.max(0.3, o.rate);
  const literal = o.literal ?? (phones.length > 0 && phones.every((p) => p.literal));
  const en = !literal && o.lang === 'en';
  // a language read by the phonemizer: its rhythm, accents and questions
  const lp = literal ? prosodyOf(o.lang) : undefined;
  // the shape of the speaker's mouth, if it is not the drawing's: the sounds are aimed for it
  const shape = shapeOf(o.head);
  const units = analyse(phones, literal, shape);

  // durations
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    u.floor = 0;
    if (nat.timing) u.dur = (literal ? neutralDuration : en ? englishDuration : italianDuration)(u, units[i + 1], units[i - 1], st, lp);
    else u.dur = u.ph.dur * (u.p.long && !u.vowel ? 1.9 : 1);
    const hard = u.dur > 0 ? Math.min(1, u.floor / u.dur) : 0;
    if (u.p.halfLong) u.dur *= 1.3;
    if (u.p.extraShort) u.dur *= 0.55;
    // the nasal of a prenasalized stop is a short lead-in to it
    if (u.p.prenasal) u.dur *= 0.45;
    // the larynx needs time to move: ejective and implosive closures are long (Lindau 1984)
    if (u.ph.airstream === 'ejective' || u.ph.airstream === 'implosive') u.dur *= 1.5;
    if (u.ph.manner === 'trill') {
      // the number of contacts sets the duration of a trill (each about 38 ms)
      const contacts = u.p.long ? 4 : u.p.wordStart ? 3 : isCons(units[i - 1]) ? 1 : 2;
      u.dur = Math.max(u.dur, contacts * 0.036);
    }
    u.floor = hard * u.dur;
  }
  // a living speaker's syllables are each a little longer or shorter than the
  // rules have them, and the tempo drifts over a few syllables (a trill keeps
  // the length of its contacts)
  if (live) {
    let syl = -1, drift = 0, f = 1;
    for (const u of units) {
      if (u.syl !== syl) {
        syl = u.syl;
        drift = VARY.drift * drift + Math.sqrt(1 - VARY.drift ** 2) * draw(1);
        f = Math.exp((live * VARY.tempo * (drift + draw(1))) / Math.SQRT2);
      }
      if (u.ph.manner === 'trill') continue;
      u.dur *= f;
      u.floor *= f;
    }
  }
  // The speaking rate. A faster voice does not shorten every sound alike:
  // each has a part that gives and a minimum that does not (Klatt 1979), and
  // the minimum is a larger share of a consonant than of a vowel, of an
  // unstressed vowel than of a stressed one. Said fast instead of slowly,
  // vowels lose 25 % where consonants lose 10 % (Gay 1978), or 26 % against
  // the 20 % of the stop after them (Port 1981); in Arabic, said
  // fast vowels lose 25 % and said slowly gain 50 %, consonants 12 % either way
  // (Port et al. 1980; all three as reviewed by Katsuda & Kang 2026).
  // The part that gives is scaled by whatever
  // makes the whole last 1/rate of what it lasts at the usual rate.
  if (rate !== 1) {
    let all = 0, hard = 0;
    for (const u of units) { all += u.dur; hard += u.floor; }
    const soft = all - hard;
    if (hard <= 0 || soft <= 0) for (const u of units) u.dur /= rate;
    else {
      let give = (all / rate - hard) / soft, squeeze = 1;
      if (give < RATE_LEAST) { give = RATE_LEAST; squeeze = all / rate / (hard + soft * give); }
      for (const u of units) u.dur = squeeze * (u.floor + (u.dur - u.floor) * give);
    }
  }

  // segments
  const segs: Seg[] = [];
  let t = 0.06; // breath onset
  const label = (u: Unit) => u.p.ipa;
  /** the sonorants an aspirated stop devoices: the stop's unit, and how long the folds stay apart after its release */
  const devoiced: { unit: number; t0: number; t1: number }[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const ph = u.ph;
    const parts: [string, number][] = ph.manner === 'affricate' && ph.parts ? [[ph.parts[0], 0.45], [ph.parts[1], 0.55]] : [[u.p.ipa, 1]];
    for (const [ipa, frac] of parts) {
      let q = ipa === u.p.ipa ? ph : phonemeFor(ipa, shape)!;
      // the parts of an ejective affricate share its larynx and its glottis
      if (q !== ph && ph.airstream) q = { ...q, airstream: ph.airstream, voiced: ph.voiced, abduction: ph.abduction, art: { ...q.art, larynx: ph.art.larynx } };
      const dur = u.dur * frac;
      if (q.manner === 'stop') {
        const rel = Math.min(0.015, dur * 0.35);
        // aspiration where it is written (ʰ); English voiceless stops are also
        // aspirated at the start of a stressed syllable (not after s)
        const nx = units[i + 1];
        const afterS = units[i - 1]?.p.ipa === 's' && units[i - 1].word === u.word;
        const written = !!q.aspirated && !q.voiced && ph.manner === 'stop' && !ph.airstream;
        const aspirates = written || (en && !q.voiced && ph.manner === 'stop' && !!nx?.vowel && !u.coda && !afterS);
        // English lets the tip of the tongue go slowly: what follows the burst
        // of /t/ is a short hiss at the ridge, a [s], more than a breath of the
        // glottis, and it ends in the voice as a fricative does. The closure is
        // made where the hiss will be, so that it opens into its channel
        const hiss = aspirates && en && !written && placeOf(q) === 'alveolar' ? phonemeFor('s', shape) : null;
        if (hiss?.art.tipX !== undefined && hiss.art.tipY !== undefined) q = { ...q, art: { ...q.art, tipX: hiss.art.tipX, tipY: hiss.art.tipY + FRICATED_PRESS } };
        segs.push({ ipa, ph: q, t0: t, t1: t + dur - rel, unit: i, part: 'closure', label: label(u) });
        t += dur - rel;
        segs.push({ ipa, ph: q, t0: t, t1: t + rel, unit: i, part: 'release', label: label(u) });
        t += rel;
        if (aspirates) {
          const vot = (VOT[placeOf(q) ?? 'alveolar'] ?? 0.065) * (u.stressed ? 1 : written ? 0.8 : 0.55) / Math.sqrt(rate);
          const asp = Math.max(0.005, vot - rel);
          if (hiss) segs.push({ ipa, ph: hiss, t0: t, t1: t + asp, unit: i, part: 'frication', label: label(u) });
          else segs.push({ ipa, ph: q, t0: t, t1: t + asp, unit: i, part: 'aspiration', label: label(u) });
          t += asp;
          // the aspiration takes over the start of the vowel (Klatt)
          if (nx?.vowel) nx.dur = Math.max(0.04, nx.dur - 0.5 * asp);
        } else if (en && !q.voiced && ph.manner === 'stop' && !ph.airstream && !u.coda && !afterS && !u.p.glottalized
          && nx && nx.word === u.word && !nx.vowel && !nx.coda && nx.ph.voiced && (nx.ph.manner === 'approximant' || nx.ph.manner === 'lateral') && units[i + 2]?.vowel) {
          // before l r w j of the same onset ("play", "tree", "queen") the
          // aspiration falls on that sound instead: the folds stay apart through
          // most of it, and the voice starts later than before a vowel (Klatt 1975)
          const vot = 1.25 * (VOT[placeOf(q) ?? 'alveolar'] ?? 0.065) * (u.stressed ? 1 : 0.55) / Math.sqrt(rate);
          devoiced.push({ unit: i, t0: t, t1: t + Math.min(nx.dur, Math.max(0.005, vot - rel)) });
        }
      } else {
        segs.push({ ipa, ph: q, t0: t, t1: t + dur, unit: i, label: label(u) });
        t += dur;
      }
    }
    // a pause inside the utterance; after the last sound the voice simply stops
    if (u.p.pause && i < units.length - 1) {
      const d = ((u.p.pause === 'long' ? st.pauseLong : st.pauseShort) / rate) * vary(2, VARY.pause);
      segs.push({ ipa: '_', ph: PHONEMES._, t0: t, t1: t + d, unit: i, label: '_' });
      t += d;
    }
  }
  const duration = t + 0.05;
  const lead = o.lead;
  const prec = Math.max(-1, Math.min(1, o.precision ?? 0));
  const tauScale: Partial<Record<keyof Articulators, number>> = { ...(o.tauScale ?? {}) };
  if (prec) for (const k of SLOW_KEYS) tauScale[k] = (tauScale[k] ?? 1) * Math.pow(2, -0.6 * prec);
  const tau = (k: keyof Articulators) => TAM_TAU[k] * (tauScale[k] ?? 1);
  const overshoot = OVERSHOOT * (1 + 0.5 * prec);

  // ---------------------------------------------------------- articulation
  // per-key anchor points: (interval, value) at the segments that specify the key
  const anchors: Record<string, { t0: number; t1: number; v: number; cons?: boolean; mid?: number; piston?: Seg; seg?: Seg; floor?: number }[]> = {};
  for (const k of ARTICULATOR_KEYS) anchors[k] = [];
  const neutral: Articulators = { ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art };
  // the speaker's setting, on every value a sound gives an articulator (`own`: the sound sets it itself)
  const setting = settingOf(o.setting);
  const habit = !isNeutral(setting);
  const schwa = PHONEMES['ə'];
  const habitual = (k: keyof Articulators, v: number, ph: Phoneme, own: boolean) => (habit ? adjust(k, v, ph, own, setting) : v);
  for (const s of segs) {
    const m = s.ph.manner;
    if (m === 'silence' || ((m === 'glottal' || m === 'glottalStop') && nat.coarticulation)) continue;
    // at the release the closing articulator opens toward the next vowel: leave it free
    if (s.part === 'release' || s.part === 'aspiration') continue;
    const art = s.ph.art;
    let keys = m === 'vowel' || !nat.coarticulation ? ARTICULATOR_KEYS : (Object.keys(art) as (keyof Articulators)[]);
    // a nasal voice still shuts the port for an obstruent, which needs its air
    if (habit && setting.velum > 0 && !nasalizable(s.ph) && !keys.includes('velum')) keys = [...keys, 'velum'];
    const off = s.ph.offglide ? phonemeFor(s.ph.offglide, shape)?.art ?? null : null;
    // precision: a vowel falls in toward schwa (slack: unstressed ones most) or spreads out from it (crisp)
    const strong = !!(units[s.unit].p.stress || units[s.unit].p.stress2);
    const r = m !== 'vowel' || !prec ? 0 : prec < 0 ? -prec * (strong ? 0.15 : 0.5) : -prec * (strong ? 0.05 : 0.15);
    const toward = (k: keyof Articulators, v: number) => {
      if (!r || !VOWEL_KEYS.has(k)) return v;
      const [lo, hi] = ARTICULATOR_RANGES[k];
      return Math.max(lo, Math.min(hi, v + (neutral[k] - v) * r));
    };
    for (const k of keys) {
      const v = habitual(k, toward(k, art[k] ?? (nat.coarticulation ? DEFAULT_ARTICULATORS[k] : neutral[k])), s.ph, art[k] !== undefined);
      if (off) {
        // diphthong: hold the nucleus, then glide to the offglide target
        // (the nucleus is aimed to be reached a quarter of the way in)
        const d = s.t1 - s.t0;
        anchors[k].push({ t0: s.t0 - lead, t1: s.t0 + 0.35 * d - lead, v, mid: s.t0 + 0.25 * d });
        anchors[k].push({ t0: s.t1 - 0.2 * d - lead, t1: s.t1 - lead, v: off[k] !== undefined ? habitual(k, toward(k, off[k]!), s.ph, true) : v });
      } else if (m !== 'vowel') {
        // a consonant gesture starts earlier than its sound (it overlaps the
        // vowel before), so that a short fricative or nasal still reaches its
        // target; a stop aims beyond the contact and closes in time anyway.
        // The target is let go just before the planned release: the opening
        // of a closure clears it within a few milliseconds, a fricative's
        // narrow slit needs a little longer to open, and a slow articulator
        // (tongue body, jaw, velum) lets go earlier than the tip, so that all
        // open together (a velar released late behind a velum already raised
        // would cut off both mouth and nose)
        // The middle of the vowel before is its own: the tongue may head for
        // the consonant only from about one time constant before it, so a
        // short vowel between alveolars is not said with the tip already up
        // (an r-coloured, retroflex vowel) nor one before a velar with the
        // dorsum on its way to it. The velum too, in Italian; English lowers
        // it from the start of a vowel before a nasal (Cohn 1990), and the
        // nasalized vowel is part of the word
        const prev = anchors[k][anchors[k].length - 1];
        const own = PROTECTED.has(k) && !(en && k === 'velum');
        const core = own && prev && !prev.cons && prev.mid !== undefined ? prev.mid - CORE * tau(k) : -Infinity;
        // the larynx of an ejective or an implosive stays where it was until
        // the mouth is shut (a piston needs a closed cylinder), then moves
        // through the closure up to the release
        const piston = k === 'larynx' && (s.ph.airstream === 'ejective' || s.ph.airstream === 'implosive');
        const t0 = piston ? s.t0 + 0.4 * (s.t1 - s.t0) : Math.max(core, s.t0 - lead - (m === 'stop' ? 0 : CONS_ONSET));
        if (prev && (prev.t1 > t0 || piston)) prev.t1 = Math.max(prev.t0, t0);
        const release = (m === 'fricative' ? 2 : 1) * RELEASE_LEAD * (tau(k) / TAM_TAU.tipY);
        anchors[k].push({ t0: Math.max(t0, prev ? prev.t1 : -Infinity), t1: piston ? s.t1 : Math.max(t0 + 0.01, s.t1 - release), v, cons: true, seg: s, floor: core, ...(piston ? { piston: s } : {}) });
        // a click opens its front first: the back closure (and the tip of a
        // lateral click) holds on a little longer, while the sides of a
        // lateral click open
        if (s.ph.airstream === 'click' && s.part === 'closure') {
          if (CLICK_BACK.has(k) || (s.ph.lateralRelease && k === 'tipY')) anchors[k][anchors[k].length - 1].t1 = s.t1 + CLICK_LAG;
          if (s.ph.lateralRelease && k === 'tongueSides') anchors[k].push({ t0: s.t1 - 0.004, t1: s.t1 + CLICK_LAG, v: 1, cons: true });
        }
      } else anchors[k].push({ t0: s.t0 - lead, t1: s.t1 - lead, v, mid: 0.5 * (s.t0 + s.t1) });
    }
  }
  // after the last sound the mouth relaxes to rest (and a final stop is released)
  for (const k of ARTICULATOR_KEYS) anchors[k].push({ t0: t + 0.03, t1: t + 1, v: habitual(k, neutral[k], schwa, false) });
  const valueAt = (k: keyof Articulators, time: number): number => {
    const a = anchors[k];
    if (!a.length) return habitual(k, DEFAULT_ARTICULATORS[k], schwa, false);
    if (time <= a[0].t0) return a[0].v;
    for (let i = 0; i < a.length; i++) {
      if (time >= a[i].t0 && time <= a[i].t1) return a[i].v;
      if (i + 1 < a.length && time > a[i].t1 && time < a[i + 1].t0) {
        // after a consonant the articulator it used is released at once
        // toward its next target (the tip leaves the ridge, the lip the teeth);
        // between vowels it glides, through the consonants that leave it free
        if (a[i].cons) return a[i + 1].v;
        const w = (time - a[i].t1) / (a[i + 1].t0 - a[i].t1);
        return a[i].v + (a[i + 1].v - a[i].v) * w;
      }
    }
    return a[a.length - 1].v;
  };

  // a short vowel would end before the slow articulators reach it (the tongue
  // body takes about 85 ms for 90 % of its way): its target is aimed past the
  // vowel, as a speaker does who means to reach it, so that the middle of the
  // vowel gets there. The engine's own dynamics are run here to find out by how
  // much; the aim goes past the vowel by at most OVERSHOOT of the way, and
  // never outside the articulator's range
  for (const k of COMPENSATED) {
    const vowels = anchors[k].filter((a) => a.mid !== undefined).map((a) => ({ a, v0: a.v, from: a.v }));
    if (!vowels.length) continue;
    const [lo, hi] = ARTICULATOR_RANGES[k];
    for (let iter = 0; iter < 3; iter++) {
      const tr = new TamChannel(valueAt(k, 0), tau(k));
      const y: number[] = [];
      for (let i = 0; i * FRAME <= duration; i++) y.push(tr.step(valueAt(k, i * FRAME), FRAME));
      const at = (time: number) => y[Math.max(0, Math.min(y.length - 1, Math.round(time / FRAME)))];
      for (const w of vowels) {
        if (iter === 0) w.from = at(w.a.t0);
        const miss = w.v0 - at(w.a.mid!);
        const room = overshoot * Math.abs(w.v0 - w.from);
        w.a.v = Math.max(lo, Math.min(hi, Math.max(w.v0 - room, Math.min(w.v0 + room, w.a.v + miss))));
      }
    }
  }

  // a stop or a nasal closes whatever the rate, the setting or the speaker's
  // precision. Coming from an open vowel, the jaw (the slowest of the
  // organs that carry the lips, the tip and the dorsum) may still be low
  // when the closure is due, and the closing articulator falls short of the
  // other side: a speaker then pushes it further and brings the jaw up (in
  // fast speech the jaw moves less and the tongue and lips do more: Kuehn &
  // Moll 1976). The engine's target dynamics are run here, and the targets
  // of a closure that does not shut are pushed until it does
  const shutting = segs.filter((s) => (s.part === 'closure' && s.ph.manner === 'stop') || s.ph.manner === 'nasal')
    // (a click has its own two closures; a glottalized or unreleased stop needs no pressure behind it)
    .filter((s) => s.ph.airstream !== 'click' && !units[s.unit].p.glottalized && !s.ph.unreleased)
    .map((s) => ({ s, ck: closingKey(s.ph) }))
    .filter((c) => c.ck && anchors[c.ck.key].some((a) => a.seg === c.s));
  const moved = () => {
    const trs = {} as Record<keyof Articulators, TamChannel>;
    for (const k of ARTICULATOR_KEYS) trs[k] = new TamChannel(valueAt(k, 0), tau(k));
    const ys = {} as Record<keyof Articulators, number[]>;
    for (const k of ARTICULATOR_KEYS) ys[k] = [];
    for (let i = 0; i * FRAME <= duration; i++) for (const k of ARTICULATOR_KEYS) ys[k].push(trs[k].step(valueAt(k, i * FRAME), FRAME));
    return (time: number) => {
      const i = Math.max(0, Math.min(ys.jaw.length - 1, Math.round(time / FRAME)));
      const a = {} as Articulators;
      for (const k of ARTICULATOR_KEYS) a[k] = ys[k][i];
      return a;
    };
  };
  for (let iter = 0; iter < 5 && shutting.length; iter++) {
    const artAt = moved();
    let pushed = false;
    for (const { s, ck } of shutting) {
      // shut at some point in the second half of the closure
      let least = Infinity;
      for (let q = 0; q < 3 && least >= CLOSED_AREA; q++) least = Math.min(least, constrictionOf(artAt(s.t0 + (0.5 + 0.2 * q) * (s.t1 - s.t0)), shape).area);
      if (least < CLOSED_AREA) continue;
      const { key, dir, jaw } = ck!;
      const a = anchors[key].find((x) => x.seg === s)!;
      const [lo, hi] = ARTICULATOR_RANGES[key];
      // past its range by up to 0.6: pressed against the other side
      a.v = dir > 0 ? Math.min(Math.max(a.v, hi + 0.6), a.v + 0.25) : Math.max(Math.min(a.v, lo - 0.6), a.v - 0.25);
      if (jaw) {
        let j = anchors.jaw.find((x) => x.seg === s);
        if (!j) {
          // a velar sets no jaw of its own: it borrows the vowels'. Here it takes the jaw for the closure
          const t0 = s.t0 - lead, t1 = Math.max(t0 + 0.01, s.t1 - RELEASE_LEAD * (tau('jaw') / TAM_TAU.tipY));
          const list = anchors.jaw;
          let at = list.findIndex((x) => x.t0 > s.t0);
          if (at < 0) at = list.length;
          const prev = list[at - 1], next = list[at];
          j = { t0: prev ? Math.max(t0, Math.min(prev.t1, t0)) : t0, t1: next ? Math.min(t1, next.t0) : t1, v: artAt(0.5 * (s.t0 + s.t1)).jaw, cons: true, seg: s };
          if (prev && prev.t1 > j.t0) prev.t1 = Math.max(prev.t0, j.t0);
          list.splice(at, 0, j);
        }
        j.v = Math.max(0, j.v - 0.1);
      }
      pushed = true;
    }
    if (!pushed) break;
  }

  // and it closes when its sound is due. The lips shut some 40 ms after they
  // set out, the tongue leaving an open vowel 70-80 ms after, with the jaw
  // it rides on: a gesture that set out a fixed time before its sound would
  // shut late, its closure would last a few milliseconds, and the breath of a
  // voiceless one, whose folds part on time, would hiss through the passage
  // still closing. The gesture sets out as much earlier as it would be late
  // (the vowel before keeps its middle), and the moment the mouth is shut is
  // kept for the folds
  const shutAt = new Map<Seg, number>();
  // (a click keeps the timing of its two closures: only its folds wait for them)
  // A fricative is as narrow as it is meant when its sound is due, by the
  // same means: coming from an open vowel its channel would still be closing
  // through most of it (a sibilant twice as wide as it is held has no hiss
  // to speak of), and narrow enough only where it ends
  const hissing = new Map<Seg, number>();
  for (const s of segs) {
    if (s.ph.manner !== 'fricative' || s.part || s.ph.airstream === 'click' || !closingKey(s.ph)) continue;
    const a = constrictionOf(s.ph.art, shape).area;
    if (a > CLOSED_AREA && a < 1) hissing.set(s, FRIC_NEAR * a);
  }
  const closing = [...shutting.map((c) => c.s), ...segs.filter((s) => s.part === 'closure' && s.ph.airstream === 'click'), ...hissing.keys()];
  for (let iter = 0; iter < 3 && closing.length; iter++) {
    const artAt = moved();
    let earlier = false;
    for (const s of closing) {
      const click = s.ph.airstream === 'click';
      const two = click && s.ph.approx !== 'click';
      const near = hissing.get(s);
      const shut = (a: Articulators) => (two ? passageIn(a, CLICK_FRONT, shape) <= 0.004 && passageIn(a, CLICK_BACK_WINDOW, shape) <= 0.004 : constrictionOf(a, shape).area < (near ?? CLOSED_AREA));
      let at = s.t0 - SHUT_EARLY;
      while (at < s.t1 && !shut(artAt(at))) at += FRAME;
      if (at >= s.t1) continue;
      if (near === undefined) shutAt.set(s, at);
      const late = at - s.t0 - (near === undefined ? 0 : FRIC_ONSET);
      if (late < FRAME || iter === 2) continue;
      for (const k of ARTICULATOR_KEYS) {
        if (!EARLY.has(k)) continue;
        const i = anchors[k].findIndex((x) => x.seg === s);
        if (i < 0 || anchors[k][i].piston) continue;
        const a = anchors[k][i], prev = anchors[k][i - 1];
        const t0 = Math.max(a.t0 - late, a.floor ?? -Infinity, prev ? (prev.cons ? prev.t1 : prev.t0 + FRAME) : -Infinity);
        if (t0 >= a.t0) continue;
        a.t0 = t0;
        if (prev && prev.t1 > t0) prev.t1 = t0;
        earlier = true;
      }
    }
    if (!earlier) break;
  }

  // A fricated stop opens when its release is due. Its tip comes down from a
  // closure pressed past the channel of the hiss, and how long that takes
  // depends on the jaw under it (with the jaw high the channel is nearly
  // shut, and the tip has most of its way to go before any air passes): the
  // tip is let go as much earlier as the passage would open late
  const fricated = segs.filter((s) => s.part === 'frication');
  for (let iter = 0; iter < 6 && fricated.length; iter++) {
    const artAt = moved();
    let shifted = false;
    for (const s of fricated) {
      const c = segs.find((x) => x.unit === s.unit && x.part === 'closure');
      if (!c) continue;
      let at = FRAME * Math.round((0.5 * (c.t0 + c.t1)) / FRAME), before = 0, area = 0;
      while (at < s.t1 && (area = constrictionOf(artAt(at), shape).area) < FRICATED_OPEN) { before = area; at += FRAME; }
      // (between two frames, where the passage would cross the threshold; the
      // motion simulated for a frame is where the engine, which steps toward
      // a frame's targets through the frame, will be at the end of it. The
      // targets are read once a frame: the tip is let go whole frames earlier,
      // and by less than it is late after the first tries, since a tip let go
      // earlier has also been pressed less far)
      if (area > before) at -= FRAME * Math.min(1, (area - FRICATED_OPEN) / (area - before));
      const late = FRAME * Math.round((at + FRAME - c.t1) / (iter < 2 ? 1 : 2) / FRAME);
      if (!late) continue;
      for (const k of ARTICULATOR_KEYS) {
        const i = anchors[k].findIndex((x) => x.seg === s);
        if (i < 1 || anchors[k][i - 1].seg !== c) continue;
        const a = anchors[k][i], held = anchors[k][i - 1];
        const t1 = Math.max(held.t0 + FRAME, Math.min(a.t1 - FRAME, held.t1 - late));
        if (Math.abs(t1 - held.t1) < 1e-6) continue;
        a.t0 = Math.max(t1, Math.min(a.t1 - FRAME, a.t0 - late));
        held.t1 = t1;
        shifted = true;
      }
    }
    if (!shifted) break;
  }

  // the piston of an ejective or an implosive starts when the mouth is shut,
  // anywhere from a few to 70 ms into the closure (the lips close fast, the
  // dorsum leaving an open vowel is slow): the target dynamics of the engine
  // are run here and the passage they leave is measured, until it is closed
  // (a fricative: nearly as narrow as it will get)
  const pistons = anchors.larynx.filter((a) => a.piston);
  if (pistons.length) {
    const trs = {} as Record<keyof Articulators, TamChannel>;
    for (const k of ARTICULATOR_KEYS) trs[k] = new TamChannel(valueAt(k, 0), tau(k));
    const art = { ...DEFAULT_ARTICULATORS };
    const shut = pistons.map((a) => Math.max(0.003, 1.3 * constrictionOf(a.piston!.ph.art, shape).area));
    let p = 0;
    for (let i = 0; i * FRAME <= duration && p < pistons.length; i++) {
      const time = i * FRAME;
      for (const k of ARTICULATOR_KEYS) art[k] = trs[k].step(valueAt(k, time), FRAME);
      const w = pistons[p], s = w.piston!;
      if (time < s.t0) continue;
      // never closed: the planned start stays
      if (time >= s.t1) { p++; continue; }
      if (constrictionOf(art, shape).area > shut[p]) continue;
      w.t0 = Math.min(time, w.t1 - 0.01);
      const prev = anchors.larynx[anchors.larynx.indexOf(w) - 1];
      if (prev) prev.t1 = Math.max(prev.t0, w.t0);
      p++;
    }
  }

  // the tongue body of a click rarefies the air between its closures once
  // both are made, until the front one opens: the moment is found as for
  // the piston above (a palatal click, with one closure, has nothing to rarefy)
  const clickSegs = segs.filter((s) => s.part === 'closure' && s.ph.airstream === 'click' && s.ph.approx !== 'click');
  const clicks: { t0: number; t1: number; end: number }[] = [];
  if (clickSegs.length) {
    const trs = {} as Record<keyof Articulators, TamChannel>;
    for (const k of ARTICULATOR_KEYS) trs[k] = new TamChannel(valueAt(k, 0), tau(k));
    const art = { ...DEFAULT_ARTICULATORS };
    let p = 0;
    for (let i = 0; i * FRAME <= duration && p < clickSegs.length; i++) {
      const time = i * FRAME;
      for (const k of ARTICULATOR_KEYS) art[k] = trs[k].step(valueAt(k, time), FRAME);
      const s = clickSegs[p];
      if (time < s.t0) continue;
      if (time >= s.t1) { p++; continue; }
      if (passageIn(art, CLICK_FRONT, shape) > 0.004 || passageIn(art, CLICK_BACK_WINDOW, shape) > 0.004) continue;
      clicks.push({ t0: time, t1: s.t1, end: s.t1 + CLICK_LAG + 0.03 });
      p++;
    }
  }
  const clickAt = (time: number): number => {
    for (const c of clicks) {
      if (time < c.t0 || time >= c.end) continue;
      return time >= c.t1 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (time - c.t0)) / (c.t1 - c.t0));
    }
    return 0;
  };

  // contacts of taps (raised-cosine flicks up to the contact: the tongue tip
  // to the ridge, the lips to the teeth). Their size is measured from where
  // the smoothed articulator really is, so the same target dynamics as the
  // engine are run here. The fitted tap keeps the height it was tuned with.
  // Trills are left to the air: the tip, the lips or the dorsum is held on a
  // spring lightly past its contact, and the engine lets the pressure behind
  // the closure blow it open, as many times as the air allows
  const tracks = {} as Record<FlickKey, number[]>;
  for (const key of ['tipY', 'lipOpen', 'tongueX'] as FlickKey[]) {
    const tr = new TamChannel(valueAt(key, 0), tau(key));
    const y: number[] = [];
    for (let k = 0; k * FRAME <= duration + 0.05; k++) y.push(tr.step(valueAt(key, k * FRAME), FRAME));
    tracks[key] = y;
  }
  const now = (key: FlickKey, time: number) => tracks[key][Math.max(0, Math.min(tracks[key].length - 1, Math.round(time / FRAME)))];
  const flicks: Record<FlickKey, { c: number; w: number; a: number }[]> = { tipY: [], lipOpen: [], tongueX: [] };
  const trills: { t0: number; t1: number; key: FlickKey; at: number; open?: number }[] = [];
  for (const s of segs) {
    if (s.ph.manner !== 'tap' && s.ph.manner !== 'trill') continue;
    const fl = s.ph.flick;
    const key: FlickKey = fl?.key ?? 'tipY';
    // the tip strikes upward; the lips and the dorsum close by going down
    const up = key === 'tipY';
    const toward = (contact: number, time: number, least: number) => {
      const d = contact - now(key, time);
      return up ? Math.max(least, d) : Math.min(-least, d);
    };
    if (s.ph.manner === 'tap') {
      // the flick is added after the smoothing, so it is not led like the
      // postures; it overshoots the ridge so that the contact lasts about
      // 10-15 ms (American flaps 10-40 ms, Zue & Laferriere 1979)
      const c = 0.5 * (s.t0 + s.t1);
      flicks[key].push({ c, w: Math.max(0.04, (s.t1 - s.t0) * 1.6), a: toward(fl?.contact ?? 2.2, c, 0) });
    } else {
      const at = trillContact(s.ph, key, fl?.contact ?? 2.3, shape);
      trills.push({ t0: s.t0 - lead * 0.3, t1: s.t1, key, at, ...(fl?.open ? { open: fl.open } : {}) });
    }
  }
  const flickAt = (key: FlickKey, time: number): number => {
    let y = 0;
    for (const f of flicks[key]) {
      const d = Math.abs(time - f.c);
      if (d < f.w / 2) {
        const v = f.a * 0.5 * (1 + Math.cos((2 * Math.PI * d) / f.w));
        if (Math.abs(v) > Math.abs(y)) y = v;
      }
    }
    return y;
  };

  // ---------------------------------------------------------------- melody
  const vowelSeg = (ui: number) => segs.find((s) => s.unit === ui && s.ph.manner === 'vowel');

  // lexical tones. Each toned syllable has pitch targets in the speaker's
  // range: Chao's five levels over `span` semitones, level 3 in the middle;
  // a contour tone is a line through its rhyme. The voice approaches them as
  // a critically damped third-order system (the quantitative target
  // approximation model, Prom-on, Xu & Thipakorn 2009), so neighbouring
  // tones shape each other as in speech: a high tone after a low one starts
  // low. Downstep and upstep move the register by 2 semitones, the global
  // rise and fall by 3; a toneless syllable continues from the tone before,
  // drifting down. The targets lead by the system's lag, so that a falling
  // tone gets near its end within its syllable
  const toned = units.some((u) => u.vowel && !!u.p.tone?.length);
  let toneTrack: number[] | null = null;
  if (toned) {
    const span = (12 * Math.max(0, o.accent)) / 5;
    const level = (lv: number) => ((lv - 3) / 4) * span;
    const lag = 0.015;
    const pts: { t: number; v: number }[] = [];
    let register = 0, last = 0;
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (!u.vowel) continue;
      register += 2 * (u.p.toneStep ?? 0) + 3 * (u.p.globalPitch ?? 0);
      const ss = segs.filter((s) => units[s.unit].syl === u.syl && s.ph.manner !== 'silence');
      const nuc = segs.find((s) => s.unit === ui);
      if (!nuc || !ss.length) continue;
      // the target is the syllable's, from its first sound (qTA aligns it with the whole syllable)
      const r0 = ss[0].t0 - lag, r1 = Math.max(nuc.t1, ss[ss.length - 1].t1) - lag;
      const lv = u.p.tone;
      if (!lv?.length) {
        pts.push({ t: r0, v: last }, { t: r1, v: last - 1 });
        last -= 1;
      } else if (lv.length === 1) {
        last = level(lv[0]) + register;
        pts.push({ t: r0, v: last }, { t: r1, v: last });
      } else {
        lv.forEach((l, k) => { last = level(l) + register; pts.push({ t: r0 + ((r1 - r0) * k) / (lv.length - 1), v: last }); });
      }
    }
    const target = (time: number) => {
      if (time <= pts[0].t) return pts[0].v;
      for (let k = 1; k < pts.length; k++) {
        if (time <= pts[k].t) {
          const d = pts[k].t - pts[k - 1].t;
          return d > 1e-9 ? pts[k - 1].v + ((pts[k].v - pts[k - 1].v) * (time - pts[k - 1].t)) / d : pts[k].v;
        }
      }
      return pts[pts.length - 1].v;
    };
    const tr = new TamChannel(target(0), 0.011);
    toneTrack = [];
    for (let k = 0; k * FRAME <= duration + 0.3; k++) toneTrack.push(tr.step(target(k * FRAME), FRAME));
  }
  const toneAt = (time: number) => toneTrack![Math.max(0, Math.min(toneTrack!.length - 1, Math.round(time / FRAME)))];
  const sylStart = (ui: number) => segs.find((s) => units[s.unit].syl === units[ui].syl)?.t0 ?? 0;
  const phraseCmds: { t: number; a: number }[] = [];
  const accentCmds: Command[] = [];
  // accent commands must last long enough for the step response to get near
  // its top (1 - (1 + βt) e^(-βt) is 0.8 at βt = 3), or short syllables lose their accent
  const betaAcc = en ? 26 : 28;
  {
    // phrases
    let phraseStart = 0;
    let first = true;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const isEnd = i === units.length - 1 || !!u.p.pause;
      if (!isEnd) continue;
      const startT = segs.find((s) => s.unit === phraseStart)?.t0 ?? 0;
      phraseCmds.push({ t: startT - 0.25, a: st.phrase * (first ? 0.32 : u.boundary === 'comma' || units[phraseStart - 1]?.boundary === 'comma' ? 0.16 : 0.26) * vary(4, VARY.phrase) });
      first = false;
      // accents on the stressed vowels of content words
      const acc: number[] = [];
      // (in a tone language the tones take the place of the pitch accents)
      if (!toned && lp?.accents !== 'none') for (let j = phraseStart; j <= i; j++) if (units[j].vowel && units[j].p.stress && !units[j].p.func) acc.push(j);
      const boundary = u.boundary;
      const yesNo = boundary === 'question';
      // an accent of the phrase, not of the word (French): only on its last syllable
      if (lp?.accents === 'phrase') {
        acc.length = 0;
        for (let j = i; j >= phraseStart; j--) if (units[j].vowel) { acc.push(j); break; }
      }
      // a question that rises on its last stress and falls after it
      const riseFall = yesNo && lp?.question === 'riseFall';
      const lastV = (() => { for (let j = i; j >= phraseStart; j--) if (units[j].vowel) return j; return -1; })();
      let height = o.accent * ST;
      acc.forEach((j, n) => {
        const vs = vowelSeg(j);
        if (!vs) return;
        const nuclear = n === acc.length - 1;
        let a = height * vary(3, VARY.accent);
        // a yes/no question has a low nuclear accent before its final rise
        if (nuclear && yesNo) a = riseFall ? a * 1.3 : 0;
        if (en || lp?.peak === 'early' || riseFall && nuclear) {
          // English H*: rise through the stressed syllable, peak inside its vowel
          const t2 = vs.t1 - 0.03;
          if (a > 0) accentCmds.push({ t1: Math.min(sylStart(j) - 0.03, t2 - 0.17), t2, a, beta: betaAcc });
        } else if (nuclear && !yesNo && boundary !== 'comma') {
          // Italian statement nucleus H+L*: high on the syllable before, falling onto the stressed one
          accentCmds.push({ t1: vs.t0 - 0.24, t2: vs.t0 + 0.02, a: a * 1.1, beta: betaAcc });
        } else if (a > 0) {
          // Italian L+H*: the rise starts with the stressed vowel and peaks late,
          // still inside it (a peak on the next voiceless consonant is not heard)
          const t2 = vs.t1 - 0.015;
          accentCmds.push({ t1: Math.min(vs.t0 - 0.03, t2 - 0.13), t2, a, beta: betaAcc });
        }
        // downstep: each accent a little lower than the one before, never below 60 %
        height = Math.max(st.downstepFloor * o.accent * ST, height * st.downstep);
      });
      // boundary tones
      const lv = lastV >= 0 ? vowelSeg(lastV) : undefined;
      const endT = segs.filter((s) => s.unit <= i).reduce((m, s) => Math.max(m, s.t1), 0);
      if (lv) {
        const bv = vary(5, VARY.boundary);
        if (riseFall) accentCmds.push({ t1: lv.t0 + 0.02, t2: endT + 0.2, a: -st.finalFall * ST * bv, beta: 12 });
        else if (yesNo) accentCmds.push({ t1: lv.t0 - 0.1, t2: endT + 0.2, a: st.questionRise * ST * bv, beta: 16 });
        else if (boundary === 'comma') accentCmds.push({ t1: lv.t0, t2: endT + 0.1, a: st.continuation * ST * bv, beta: 16 });
        else accentCmds.push({ t1: lv.t0 - 0.02, t2: endT + 0.2, a: -st.finalFall * ST * bv, beta: 12 }); // final lowering
      }
      phraseStart = i + 1;
    }
  }
  const floor = o.f0 * Math.pow(2, -st.floor / 12);
  // microprosody: intrinsic F0 of vowels and the push of the preceding consonant
  const micro: { t0: number; t1: number; st: number; decay?: number }[] = [];
  if (nat.micro) {
    for (const s of segs) {
      if (s.ph.manner !== 'vowel') continue;
      // close vowels are a little higher, open ones a little lower (by their place on the chart)
      const h = vowelHeight(s.ipa);
      const intrinsic = h === undefined ? 0 : h >= 0.85 ? 0.7 : h <= 0.17 ? -0.5 : 0;
      if (intrinsic) micro.push({ t0: s.t0, t1: s.t1, st: st.micro * intrinsic });
      const prevSeg = segs[segs.indexOf(s) - 1];
      if (prevSeg && isObstruent(prevSeg.ph)) micro.push({ t0: s.t0, t1: s.t0 + 0.12, st: st.micro * (prevSeg.ph.voiced ? -0.8 : prevSeg.ph.fortis ? 3.5 : 1.3), decay: prevSeg.ph.fortis ? 0.08 : 0.035 });
    }
  }
  // a creaky (laryngealized) sound is said low in the voice
  for (const s of segs) if (s.ph.phonation === 'creaky' && s.part !== 'release') micro.push({ t0: s.t0, t1: s.t1, st: -3 });
  const microAt = (time: number): number => {
    let sum = 0;
    for (const m of micro) {
      if (time < m.t0 - 0.03 || time > m.t1 + 0.03) continue;
      if (m.decay) sum += m.st * Math.exp(-Math.max(0, time - m.t0) / m.decay);
      else {
        const e = Math.min(1, Math.max(0, (time - m.t0 + 0.03) / 0.06), Math.max(0, (m.t1 + 0.03 - time) / 0.06));
        sum += m.st * e;
      }
    }
    return sum;
  };
  const f0At = (time: number): number => {
    let f: number;
    if (o.contour && o.contour.length >= 2) {
      const u = Math.min(1, Math.max(0, time / duration));
      const c = o.contour;
      f = c[c.length - 1].f0;
      if (u <= c[0].t) f = c[0].f0;
      else {
        for (let i = 1; i < c.length; i++) {
          if (u <= c[i].t) {
            const w = (u - c[i - 1].t) / Math.max(1e-6, c[i].t - c[i - 1].t);
            f = c[i - 1].f0 * Math.pow(c[i].f0 / c[i - 1].f0, w);
            break;
          }
        }
      }
    } else if (!nat.intonation) f = o.f0 * (toneTrack ? Math.pow(2, toneAt(time) / 12) : 1);
    else {
      let lf = Math.log(floor);
      for (const pc of phraseCmds) lf += pc.a * gp(time - pc.t);
      for (const ac of accentCmds) lf += ac.a * (ga(time - ac.t1, ac.beta) - ga(time - ac.t2, ac.beta));
      // the tones ride on the phrase's declination (the tones are lexical: they stay with the intonation off)
      if (toneTrack) lf += ST * toneAt(time);
      f = Math.exp(lf);
    }
    return f * Math.pow(2, microAt(time) / 12);
  };

  // ------------------------------------------------------ source per frame
  const segAt = (time: number): Seg | null => {
    for (const s of segs) if (time >= s.t0 && time < s.t1) return s;
    return null;
  };
  const stressedVowels = segs.filter((s) => s.ph.manner === 'vowel' && units[s.unit].p.stress && !units[s.unit].p.func);
  // where each phrase ends, and whether it falls (a statement: it may end in creak)
  const falls = (u: Unit) => u.boundary === 'stop' || u.boundary === 'wh';
  const phraseEnds = segs.filter((s) => s.ph.manner === 'silence').map((s) => ({ t: s.t0, fall: falls(units[s.unit]) }))
    .concat([{ t, fall: units.length > 0 && falls(units[units.length - 1]) }]);
  // a living speaker pushes each stressed syllable, and relaxes into each phrase end, by its own amount
  const push = stressedVowels.map(() => vary(6, VARY.push));
  const relax = phraseEnds.map(() => vary(7, VARY.end));
  // breath groups: the lungs are refilled at a full stop, so their pressure
  // falls from the start of each sentence to its end, not once over them all
  const breaths: { t0: number; t1: number }[] = [];
  let breath0 = 0;
  for (const s of segs) if (s.ph.manner === 'silence' && units[s.unit].p.pause === 'long') { breaths.push({ t0: breath0, t1: s.t0 }); breath0 = s.t1; }
  breaths.push({ t0: breath0, t1: duration });
  // unaspirated voiceless stops (Italian, English after s) part the folds in
  // the closure and have them nearly together again, held stiff, when it
  // opens: little air follows the burst, and the voice starts with a short
  // lag, longest behind the slow release of the tongue body (Italian: short
  // lag, under about 30 ms, /k/ the longest)
  const held = (u: Unit) => !!u.p.glottalized || !!u.ph.unreleased;
  // The edges of the utterance. The lungs wait for the first sound: pushing
  // from the start, while the mouth was still on its way from rest, they gave
  // the word a short vowel of its own before it. Before a first sound without
  // voice the folds are already apart. After a last sound without voice the
  // folds stay apart and the lungs stop with it: brought together again, as
  // before a vowel, they voiced the air that was left, another short vowel
  // after the consonant
  const sounding = segs.filter((s) => s.ph.manner !== 'silence');
  const firstSeg = sounding[0], lastSeg = sounding[sounding.length - 1];
  const mute = (s?: Seg) => !!s && !s.ph.voiced && s.ph.manner !== 'glottalStop' && !held(units[s.unit]);
  const startsMute = mute(firstSeg), endsMute = mute(lastSeg);
  // (they push once the mouth of a first stop without voice is shut, and a little before any other first
  // sound: the pressure takes some 30 ms to rise)
  const lungsFrom = !firstSeg ? 0 : startsMute && firstSeg.ph.manner === 'stop' ? (shutAt.get(firstSeg) ?? firstSeg.t0) - 0.005 : firstSeg.t0 - 0.03;
  // (a last stop is let go on the air it holds: the lungs stop as it opens)
  const lungsTo = !endsMute ? Infinity : lastSeg.part === 'release' ? lastSeg.t0 : lastSeg.t1;
  /** a stop let go into silence: the end of the utterance, or a pause */
  const intoSilence = (s: Seg) => { const next = segs[segs.indexOf(s) + 1]; return !next || next.ph.manner === 'silence'; };
  const shortLag = segs.filter((s) => s.part === 'release' && !s.ph.voiced && units[s.unit].ph.manner === 'stop' && !held(units[s.unit]) && !intoSilence(s)
    && !units[s.unit].ph.airstream && !segs.some((a) => a.unit === s.unit && (a.part === 'aspiration' || a.part === 'frication')) && !devoiced.some((d) => d.unit === s.unit))
    .map((s) => ({ t0: Math.max(s.t0 - STIFF_LEAD, (segs.find((a) => a.unit === s.unit)?.t0 ?? s.t0) + 0.01), t1: s.t0 + (SHORT_LAG[placeOf(s.ph) ?? 'alveolar'] ?? 0.012) }));
  // a breathy-voiced stop (bʱ) is released into murmur: the folds vibrate
  // apart, with a breathy pulse shape, for the first part of the vowel
  const murmur = segs.filter((s) => s.part === 'release' && s.ph.voiced && units[s.unit].ph.phonation === 'breathy')
    .map((s) => ({ t0: s.t0, t1: s.t0 + 0.07 }));
  // an ejective holds the glottis shut through its closure and burst, and a
  // moment after, as does a voiceless implosive, whose larynx draws the air in
  // (a stop, a fricative, an affricate: from its first part to the end of its last)
  const glottalHold = units.map((u, i) => ({ u, own: segs.filter((s) => s.unit === i) }))
    .filter(({ u, own }) => (u.ph.airstream === 'ejective' || (u.ph.airstream === 'implosive' && !u.ph.voiced)) && own.length)
    .map(({ own }) => ({ t0: own[0].t0, t1: own[own.length - 1].t1 + 0.03 }));
  // an implosive lets the walls of its pharynx and its cheeks go through the
  // closure, drawn outward with the falling larynx, so that the vibrating
  // glottis can keep filling the cavity without the pressure rising behind it
  const expand = segs.filter((s) => s.part === 'closure' && units[s.unit].ph.airstream === 'implosive' && units[s.unit].ph.voiced).map((s) => ({ t0: s.t0, t1: s.t1 }));
  // a voiced stop does a little of the same: the speaker slackens the walls and makes room behind the
  // closure (Westbury 1983: voiced stops come with large increases of the volume above the glottis), or
  // the pressure would stop the voice within the closure
  const slack = segs.filter((s) => s.part === 'closure' && !units[s.unit].ph.airstream && units[s.unit].ph.voiced).map((s) => ({ t0: s.t0, t1: s.t1 }));
  // A breath is taken at a full stop, where the lungs are refilled: they
  // pull instead of holding back, the folds part wide and the air is heard
  // going in. It begins once the last sound has died away and ends in time
  // for the folds to come together again; a pause too short for it stays
  // silent.
  const inhaling = (s: Seg | null | undefined, time: number): number => {
    if (!s || st.breath <= 0 || s.ph.manner !== 'silence' || units[s.unit].p.pause !== 'long') return 0;
    const from = s.t0 + BREATH.after, to = s.t1 - BREATH.before;
    if (to - from < BREATH.least) return 0;
    const x = Math.min(1, (time - from) / BREATH.edge, (to - time) / BREATH.edge);
    return x <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * x);
  };
  const frames: ScoreFrame[] = [];
  const n = Math.ceil((duration + 0.25) / FRAME);
  let abdWas = 0;
  for (let i = 0; i <= n; i++) {
    const time = i * FRAME;
    const art = {} as Articulators;
    for (const k of ARTICULATOR_KEYS) art[k] = valueAt(k, time);
    // glottal gestures lead the acoustic segment slightly
    const sg = segAt(time + 0.01);
    let abd = 0;
    let gate = 1;
    let wait = false;
    // before the first sound the folds are already together, ready to vibrate
    // (no breathy [h] onset); after the last one they part a little while the
    // lungs stop pushing, so the voice ends without a hiss of escaping air
    if (!sg) abd = time < (firstSeg?.t0 ?? 0.06) ? (startsMute ? (firstSeg.ph.manner === 'stop' ? 0.5 : Math.max(0.4, firstSeg.ph.abduction)) : 0.08) : endsMute ? 0.6 : 0.4;
    else {
      const m = sg.ph.manner;
      const unit = units[sg.unit];
      if (m === 'silence') abd = 0.6 + 0.4 * inhaling(sg, time + 0.01);
      else if (m === 'glottalStop') { abd = 0; gate = 0; }
      else if (m === 'stop' && held(unit)) {
        // [ʔt̚]: the folds close with the tongue, so no pressure builds up
        // behind the closure and nothing bursts out at its release
        abd = 0;
        if (sg.part === 'closure') gate = 0;
      } else if (m === 'stop' && !sg.ph.voiced) {
        // the stop part of an affricate keeps the glottis open into its hiss
        const aspirated = (unit.ph.manner === 'affricate' && !unit.ph.voiced) || segs.some((s) => s.unit === sg.unit && (s.part === 'aspiration' || s.part === 'frication')) || devoiced.some((d) => d.unit === sg.unit);
        if (sg.part === 'release') abd = aspirated ? 0.55 : intoSilence(sg) ? 0.5 : 0.04;
        else {
          abd = 0.5;
          // the folds part as the mouth shuts, not before
          wait = time + 0.01 < (shutAt.get(sg) ?? -Infinity);
        }
      } else if (m === 'stop') abd = unit.ph.airstream === 'implosive' ? 0 : en && unit.p.wordStart ? 0.12 : 0.02;
      else abd = sg.ph.abduction;
    }
    if (wait) abd = abdWas;
    else abdWas = abd;
    let stiff = 0;
    for (const w of shortLag) {
      if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) abd = STIFF_ABD;
      if (time >= w.t0 && time < w.t1) stiff = 1;
    }
    for (const w of devoiced) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) abd = Math.max(abd, 0.55);
    // a breathy or whispering speaker's folds never quite meet (except where they must shut)
    if (habit && gate > 0) abd = Math.max(abd, setting.abduction);
    // and tenses the walls of the pharynx, so that the rising larynx compresses the air instead of stretching them
    let tense = 0;
    for (const w of glottalHold) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) { abd = 0; gate = 0; tense = 1; }
    for (const w of slack) if (time >= w.t0 && time < w.t1) tense = -VOICED_SLACK;
    for (const w of expand) if (time >= w.t0 && time < w.t1) tense = -1;
    // the voice quality of the segment: murmur (breathy) or creak
    let quality = 0;
    const phon = sg && sg.ph.manner !== 'stop' ? units[sg.unit].ph.phonation : undefined;
    if (phon === 'breathy') { abd = Math.max(abd, 0.22); quality = 1.0; }
    // a creaky sound: slow, irregular pulses, alternate ones weaker (Gordon & Ladefoged 2001)
    let creak = 0, fry = 0;
    if (phon === 'creaky') { quality = -0.6; creak = 0.7; }
    for (const w of murmur) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) { abd = Math.max(abd, 0.28); quality = 1.2; }
    // lungs: on during the utterance, lower during pauses, off at the end
    let ps = time < duration && time >= lungsFrom && time < lungsTo ? o.ps : 0;
    let rd = quality;
    if (time < duration) {
      if (nat.voiceQuality) {
        let br = breaths[0];
        for (const b of breaths) if (time >= b.t0) br = b;
        ps *= 1 - st.declination * (br.t1 > br.t0 ? Math.min(1, (time - br.t0) / (br.t1 - br.t0)) : 0);
        stressedVowels.forEach((v, k) => {
          const c = 0.5 * (v.t0 + v.t1), w = (v.t1 - v.t0) + 0.08;
          const d = Math.abs(time - c);
          if (d < w) { const e = 0.5 * (1 + Math.cos((Math.PI * d) / w)) * push[k]; ps *= 1 + st.stressPs * e; rd -= st.stressRd * e; }
        });
        // the end of each phrase relaxes: less pressure, breathier voice
        // (a speaker who ends statements in creak, vocal fry, drops into it instead)
        phraseEnds.forEach((pe, k) => {
          const d = pe.t - time;
          if (d >= 0 && d < st.endWindow) {
            const e = 1 - d / st.endWindow, c = pe.fall ? st.endCreak : 0;
            ps *= 1 - Math.min(0.9, st.endPs * relax[k]) * e; rd += (st.endRd * relax[k] * (1 - c) - 0.6 * c) * e;
            if (c > 0) fry = Math.max(fry, c * Math.min(1, 1.6 * e));
          }
        });
      }
      // a pause is quiet: the lungs hold back instead of blowing through the open glottis
      if (sg?.ph.manner === 'silence' && sg.t1 - sg.t0 > 0.1 && time > sg.t0 + 0.04 && time < sg.t1 - 0.06) ps *= 0.08;
      // ... or pull, where a breath is taken
      const pull = inhaling(segAt(time), time);
      if (pull > 0) ps = ps * (1 - pull) - st.breath * pull;
    }
    const tip = flickAt('tipY', time), lips = flickAt('lipOpen', time), dorsum = flickAt('tongueX', time);
    const tr = trills.find((w) => time >= w.t0 && time < w.t1);
    frames.push({
      t: time, art, abduction: abd, f0: f0At(time) * (fry > 0 ? Math.pow(2, (-FRY_DROP * fry) / 12) : 1), ps, ...(Math.max(creak, fry) > 0 ? { creak: Math.max(creak, fry) } : {}), tip, ...(lips ? { lips } : {}), ...(dorsum ? { dorsum } : {}), rd, gate, ...(stiff ? { stiff } : {}), ...(tense ? { tense } : {}),
      ...(tr ? { trill: 1, trillKey: tr.key, trillAt: tr.at, ...(tr.open ? { trillOpen: tr.open } : {}) } : {}),
      ...(clickAt(time) > 0 ? { click: clickAt(time) } : {}),
    });
  }
  const sp: ScorePhone[] = [];
  for (const s of segs) {
    const prev = sp[sp.length - 1];
    if (prev && prev.ipa === s.label && (s.part === 'release' || s.part === 'aspiration' || s.part === 'frication' || units[s.unit].ph.manner === 'affricate') && sp.length && segs[segs.indexOf(s) - 1]?.unit === s.unit) { prev.t1 = s.t1; continue; }
    sp.push({ ipa: s.label, t0: s.t0, t1: s.t1 });
  }
  // the melody is already a smooth curve (Fujisaki's filters, the drawn
  // contour): the engine only rounds off the 5 ms frame steps, without the
  // slower glide it gives to a slider, which would shave the accent peaks
  const scaled = Object.values(tauScale).some((v) => v !== undefined && v !== 1);
  return { frames, phones: sp, duration, flutter: nat.micro ? st.flutter : 0, f0Tau: 0.006, ...(scaled ? { tauScale } : {}), ...(live ? { seed: o.seed, variation: live } : {}) };
}

/** A sustained vowel or a glide between targets, for the singing / A-B demos. */
export function sustainScore(
  targets: { art: Articulators; dur: number; f0: number; f0End?: number }[],
  ps = 8,
): Score {
  const frames: ScoreFrame[] = [];
  const phones: ScorePhone[] = [];
  let t = 0;
  for (const tg of targets) {
    const n = Math.max(1, Math.round(tg.dur / FRAME));
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const f0 = tg.f0End ? tg.f0 * Math.pow(tg.f0End / tg.f0, u) : tg.f0;
      frames.push({ t: t + i * FRAME, art: { ...tg.art }, abduction: 0, f0, ps });
    }
    phones.push({ ipa: '', t0: t, t1: t + tg.dur });
    t += tg.dur;
  }
  const last = frames[frames.length - 1];
  for (let i = 1; i < 30; i++) frames.push({ ...last, t: t + i * FRAME, ps: 0 });
  return { frames, phones, duration: t };
}
