import { Articulators, ARTICULATOR_KEYS, ARTICULATOR_RANGES, DEFAULT_ARTICULATORS } from '../tract/types';
import { PHONEMES, Phoneme, FlickKey } from './phonemes';
import { Phone, Lang } from './g2p';
import { Score, ScoreFrame, ScorePhone } from '../engine/params';
import { TamChannel, TAM_TAU } from './tam';
import { phonemeFor, constrictionOf, contactPoint, passageIn } from './derive';
import { IPA_CONSONANTS, IPA_VOWELS, Place } from './ipa';
import { normalizeIpa } from './ipaReader';
import { ProsodyStyle, styleOf, lengthen, ST } from './style';

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
}

/** Options of buildScore: any prosody option, and any subset of the naturalness ingredients. */
export type ScoreOptions = Partial<Omit<ProsodyOptions, 'natural'>> & { natural?: Partial<NaturalnessOptions> };

export const DEFAULT_PROSODY: ProsodyOptions = { f0: 120, accent: 5, rate: 1, ps: 8, lang: 'it', lead: 0.03, natural: NATURAL_ALL };

type Part = 'closure' | 'release' | 'aspiration';

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
}

const FRAME = 0.005;
/** how much earlier than its sound a consonant gesture starts (s) */
const CONS_ONSET = 0.02;
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
function trillContact(ph: Phoneme, key: FlickKey, toward: number): number {
  const id = `${ph.ipa}|${key}|${toward}|${JSON.stringify(ph.art)}`;
  let c = trillContacts.get(id);
  if (c === undefined) { c = contactPoint(ph.art, key, toward); trillContacts.set(id, c); }
  return c;
}
/** articulators whose vowel targets are aimed so that the middle of the vowel
 *  reaches them, and how far past the target they may aim, as a share of the
 *  way still to go */
const COMPENSATED: (keyof Articulators)[] = ['tongueX', 'tongueY', 'tongueRoot', 'jaw', 'lipRound', 'lipProtrude'];
const OVERSHOOT = 0.6;
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

function analyse(phones: Phone[], literal = false): Unit[] {
  const units: Unit[] = [];
  let word = 0;
  for (let i = 0; i < phones.length; i++) {
    const p = phones[i];
    const ph = phonemeFor(p.ipa);
    if (!ph) continue;
    const prevU = units[units.length - 1];
    if (p.wordStart && prevU && !prevU.p.wordEnd && !prevU.p.pause) word++;
    units.push({
      p, ph, vowel: isNucleus(ph), word, syl: -1, w0: 0, w1: 0, stressed: false, coda: false,
      phraseFinal: false, boundary: 'stop', wordFinalSyl: false, polysyllabic: false, dur: 0,
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

/** Inherent and minimum durations for Italian, ms (stops: closure plus release). */
const ITALIAN: Record<string, [number, number]> = {
  a: [120, 55], e: [115, 50], 'ɛ': [118, 52], o: [115, 50], 'ɔ': [118, 52], i: [100, 45], u: [100, 45], 'ə': [80, 40],
  p: [95, 60], t: [88, 55], k: [95, 60], b: [78, 50], d: [72, 45], g: [78, 50], 'tʃ': [115, 75], 'dʒ': [100, 65], ts: [120, 80], dz: [105, 70],
  f: [100, 65], v: [70, 45], s: [105, 65], z: [75, 45], 'ʃ': [105, 75], m: [75, 50], n: [70, 45], 'ɲ': [95, 65], 'ŋ': [70, 45],
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
  return d / 1000;
}

/**
 * Durations of a [phonetic] transcription, which belongs to no language
 * whose rules are known: the nominal duration of each sound, longer when
 * stressed, at the end of a phrase or written long, shorter unstressed, in a
 * closed syllable or in a cluster. Syllabic consonants last about as long as
 * a short vowel.
 */
function neutralDuration(u: Unit, next: Unit | undefined, prev: Unit | undefined, st: ProsodyStyle): number {
  let d = u.ph.dur;
  if (u.vowel) {
    if (u.ph.manner !== 'vowel') d *= 1.6;
    if (u.p.stress) d *= 1.25; else if (!u.p.stress2) d *= 0.85;
    if (u.phraseFinal) d *= lengthen(u.boundary === 'comma' ? 1.2 : 1.4, st);
    const nx = next && next.word === u.word ? next : undefined;
    if (nx && !nx.vowel && (nx.coda || nx.p.long)) d *= 0.85;
    if (u.p.long) d *= 1.7;
  } else {
    const pc = isCons(prev) && prev!.word === u.word, nc = isCons(next) && next!.word === u.word;
    if (pc || nc) d *= 0.85;
    if (u.phraseFinal && u.coda) d *= lengthen(1.25, st);
    if (u.p.long) d *= 1.85;
  }
  return d;
}

// ------------------------------------------------------------------ Fujisaki

const ALPHA = 2.0; // phrase control, 1/s
const GAMMA = 0.9; // ceiling of the accent response
const gp = (t: number) => (t > 0 ? ALPHA * ALPHA * t * Math.exp(-ALPHA * t) : 0);
const ga = (t: number, beta: number) => (t > 0 ? Math.min(1 - (1 + beta * t) * Math.exp(-beta * t), GAMMA) : 0);

interface Command { t1: number; t2: number; a: number; beta: number }

// ---------------------------------------------------------------- the score

export function buildScore(phones: Phone[], opts: ScoreOptions = {}): Score {
  const o: ProsodyOptions = { ...DEFAULT_PROSODY, ...opts, natural: { ...NATURAL_ALL, ...(opts.natural ?? {}) } };
  const nat = o.natural;
  const st = styleOf(o.style);
  const rate = Math.max(0.3, o.rate);
  const literal = o.literal ?? (phones.length > 0 && phones.every((p) => p.literal));
  const en = !literal && o.lang === 'en';
  const units = analyse(phones, literal);

  // durations
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (nat.timing) u.dur = (literal ? neutralDuration : en ? englishDuration : italianDuration)(u, units[i + 1], units[i - 1], st);
    else u.dur = u.ph.dur * (u.p.long && !u.vowel ? 1.9 : 1);
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
    u.dur /= rate;
  }

  // segments
  const segs: Seg[] = [];
  let t = 0.06; // breath onset
  const label = (u: Unit) => u.p.ipa;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const ph = u.ph;
    const parts: [string, number][] = ph.manner === 'affricate' && ph.parts ? [[ph.parts[0], 0.45], [ph.parts[1], 0.55]] : [[u.p.ipa, 1]];
    for (const [ipa, frac] of parts) {
      let q = ipa === u.p.ipa ? ph : phonemeFor(ipa)!;
      // the parts of an ejective affricate share its larynx and its glottis
      if (q !== ph && ph.airstream) q = { ...q, airstream: ph.airstream, voiced: ph.voiced, abduction: ph.abduction, art: { ...q.art, larynx: ph.art.larynx } };
      const dur = u.dur * frac;
      if (q.manner === 'stop') {
        const rel = Math.min(0.015, dur * 0.35);
        segs.push({ ipa, ph: q, t0: t, t1: t + dur - rel, unit: i, part: 'closure', label: label(u) });
        t += dur - rel;
        segs.push({ ipa, ph: q, t0: t, t1: t + rel, unit: i, part: 'release', label: label(u) });
        t += rel;
        // aspiration where it is written (ʰ); English voiceless stops are also
        // aspirated at the start of a stressed syllable (not after s)
        const nx = units[i + 1];
        const afterS = units[i - 1]?.p.ipa === 's' && units[i - 1].word === u.word;
        const written = !!q.aspirated && !q.voiced && ph.manner === 'stop' && !ph.airstream;
        if (written || (en && !q.voiced && ph.manner === 'stop' && nx?.vowel && !u.coda && !afterS)) {
          const vot = (VOT[placeOf(q) ?? 'alveolar'] ?? 0.065) * (u.stressed ? 1 : written ? 0.8 : 0.55) / Math.sqrt(rate);
          const asp = Math.max(0.005, vot - rel);
          segs.push({ ipa, ph: q, t0: t, t1: t + asp, unit: i, part: 'aspiration', label: label(u) });
          t += asp;
          // the aspiration takes over the start of the vowel (Klatt)
          if (nx?.vowel) nx.dur = Math.max(0.04, nx.dur - 0.5 * asp);
        }
      } else {
        segs.push({ ipa, ph: q, t0: t, t1: t + dur, unit: i, label: label(u) });
        t += dur;
      }
    }
    // a pause inside the utterance; after the last sound the voice simply stops
    if (u.p.pause && i < units.length - 1) {
      const d = (u.p.pause === 'long' ? st.pauseLong : st.pauseShort) / rate;
      segs.push({ ipa: '_', ph: PHONEMES._, t0: t, t1: t + d, unit: i, label: '_' });
      t += d;
    }
  }
  const duration = t + 0.05;
  const lead = o.lead;
  const tau = (k: keyof Articulators) => TAM_TAU[k] * (o.tauScale?.[k] ?? 1);

  // ---------------------------------------------------------- articulation
  // per-key anchor points: (interval, value) at the segments that specify the key
  const anchors: Record<string, { t0: number; t1: number; v: number; cons?: boolean; mid?: number; piston?: Seg }[]> = {};
  for (const k of ARTICULATOR_KEYS) anchors[k] = [];
  const neutral: Articulators = { ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art };
  for (const s of segs) {
    const m = s.ph.manner;
    if (m === 'silence' || ((m === 'glottal' || m === 'glottalStop') && nat.coarticulation)) continue;
    // at the release the closing articulator opens toward the next vowel: leave it free
    if (s.part === 'release' || s.part === 'aspiration') continue;
    const art = s.ph.art;
    const keys = m === 'vowel' || !nat.coarticulation ? ARTICULATOR_KEYS : (Object.keys(art) as (keyof Articulators)[]);
    const off = s.ph.offglide ? phonemeFor(s.ph.offglide)?.art ?? null : null;
    for (const k of keys) {
      const v = art[k] ?? (nat.coarticulation ? DEFAULT_ARTICULATORS[k] : neutral[k]);
      if (off) {
        // diphthong: hold the nucleus, then glide to the offglide target
        // (the nucleus is aimed to be reached a quarter of the way in)
        const d = s.t1 - s.t0;
        anchors[k].push({ t0: s.t0 - lead, t1: s.t0 + 0.35 * d - lead, v, mid: s.t0 + 0.25 * d });
        anchors[k].push({ t0: s.t1 - 0.2 * d - lead, t1: s.t1 - lead, v: off[k] ?? v });
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
        anchors[k].push({ t0: Math.max(t0, prev ? prev.t1 : -Infinity), t1: piston ? s.t1 : Math.max(t0 + 0.01, s.t1 - release), v, cons: true, ...(piston ? { piston: s } : {}) });
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
  for (const k of ARTICULATOR_KEYS) anchors[k].push({ t0: t + 0.03, t1: t + 1, v: neutral[k] });
  const valueAt = (k: keyof Articulators, time: number): number => {
    const a = anchors[k];
    if (!a.length) return DEFAULT_ARTICULATORS[k];
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
        const room = OVERSHOOT * Math.abs(w.v0 - w.from);
        w.a.v = Math.max(lo, Math.min(hi, Math.max(w.v0 - room, Math.min(w.v0 + room, w.a.v + miss))));
      }
    }
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
    const shut = pistons.map((a) => Math.max(0.003, 1.3 * constrictionOf(a.piston!.ph.art).area));
    let p = 0;
    for (let i = 0; i * FRAME <= duration && p < pistons.length; i++) {
      const time = i * FRAME;
      for (const k of ARTICULATOR_KEYS) art[k] = trs[k].step(valueAt(k, time), FRAME);
      const w = pistons[p], s = w.piston!;
      if (time < s.t0) continue;
      // never closed: the planned start stays
      if (time >= s.t1) { p++; continue; }
      if (constrictionOf(art).area > shut[p]) continue;
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
      if (passageIn(art, CLICK_FRONT) > 0.004 || passageIn(art, CLICK_BACK_WINDOW) > 0.004) continue;
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
  const trills: { t0: number; t1: number; key: FlickKey; at: number }[] = [];
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
      const at = trillContact(s.ph, key, fl?.contact ?? 2.3);
      trills.push({ t0: s.t0 - lead * 0.3, t1: s.t1, key, at });
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
      phraseCmds.push({ t: startT - 0.25, a: st.phrase * (first ? 0.32 : u.boundary === 'comma' || units[phraseStart - 1]?.boundary === 'comma' ? 0.16 : 0.26) });
      first = false;
      // accents on the stressed vowels of content words
      const acc: number[] = [];
      // (in a tone language the tones take the place of the pitch accents)
      if (!toned) for (let j = phraseStart; j <= i; j++) if (units[j].vowel && units[j].p.stress && !units[j].p.func) acc.push(j);
      const boundary = u.boundary;
      const yesNo = boundary === 'question';
      const lastV = (() => { for (let j = i; j >= phraseStart; j--) if (units[j].vowel) return j; return -1; })();
      let height = o.accent * ST;
      acc.forEach((j, n) => {
        const vs = vowelSeg(j);
        if (!vs) return;
        const nuclear = n === acc.length - 1;
        let a = height;
        // a yes/no question has a low nuclear accent before its final rise
        if (nuclear && yesNo) a = 0;
        if (en) {
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
        if (yesNo) accentCmds.push({ t1: lv.t0 - 0.1, t2: endT + 0.2, a: st.questionRise * ST, beta: 16 });
        else if (boundary === 'comma') accentCmds.push({ t1: lv.t0, t2: endT + 0.1, a: st.continuation * ST, beta: 16 });
        else accentCmds.push({ t1: lv.t0 - 0.02, t2: endT + 0.2, a: -st.finalFall * ST, beta: 12 }); // final lowering
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
      if (prevSeg && isObstruent(prevSeg.ph)) micro.push({ t0: s.t0, t1: s.t0 + 0.12, st: st.micro * (prevSeg.ph.voiced ? -0.8 : 1.3), decay: 0.035 });
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
  const phraseEnds = segs.filter((s) => s.ph.manner === 'silence').map((s) => s.t0).concat([t]);
  // unaspirated voiceless stops (Italian, English after s) keep the folds
  // apart through the closure and bring them together just after the burst:
  // the voice starts with a short lag, longest behind the slow release of the
  // tongue body (Italian: short lag, under about 30 ms, /k/ the longest)
  const held = (u: Unit) => !!u.p.glottalized || !!u.ph.unreleased;
  const shortLag = segs.filter((s) => s.part === 'release' && !s.ph.voiced && units[s.unit].ph.manner === 'stop' && !held(units[s.unit])
    && !units[s.unit].ph.airstream && !segs.some((a) => a.unit === s.unit && a.part === 'aspiration'))
    .map((s) => ({ t0: s.t0, t1: s.t0 + (SHORT_LAG[placeOf(s.ph) ?? 'alveolar'] ?? 0.012) }));
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
  const frames: ScoreFrame[] = [];
  const n = Math.ceil((duration + 0.25) / FRAME);
  for (let i = 0; i <= n; i++) {
    const time = i * FRAME;
    const art = {} as Articulators;
    for (const k of ARTICULATOR_KEYS) art[k] = valueAt(k, time);
    // glottal gestures lead the acoustic segment slightly
    const sg = segAt(time + 0.01);
    let abd = 0;
    let gate = 1;
    // before the first sound the folds are already together, ready to vibrate
    // (no breathy [h] onset); after the last one they part a little while the
    // lungs stop pushing, so the voice ends without a hiss of escaping air
    if (!sg) abd = time < 0.06 ? 0.08 : 0.4;
    else {
      const m = sg.ph.manner;
      const unit = units[sg.unit];
      if (m === 'silence') abd = 0.6;
      else if (m === 'glottalStop') { abd = 0; gate = 0; }
      else if (m === 'stop' && held(unit)) {
        // [ʔt̚]: the folds close with the tongue, so no pressure builds up
        // behind the closure and nothing bursts out at its release
        abd = 0;
        if (sg.part === 'closure') gate = 0;
      } else if (m === 'stop' && !sg.ph.voiced) {
        // the stop part of an affricate keeps the glottis open into its hiss
        const aspirated = (unit.ph.manner === 'affricate' && !unit.ph.voiced) || segs.some((s) => s.unit === sg.unit && s.part === 'aspiration');
        if (sg.part === 'release') abd = aspirated ? 0.55 : 0.04;
        else abd = 0.5;
      } else if (m === 'stop') abd = unit.ph.airstream === 'implosive' ? 0 : en && unit.p.wordStart ? 0.12 : 0.02;
      else abd = sg.ph.abduction;
    }
    for (const w of shortLag) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) abd = Math.max(abd, 0.5);
    // and tenses the walls of the pharynx, so that the rising larynx compresses the air instead of stretching them
    let tense = 0;
    for (const w of glottalHold) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) { abd = 0; gate = 0; tense = 1; }
    for (const w of expand) if (time >= w.t0 && time < w.t1) tense = -1;
    // the voice quality of the segment: murmur (breathy) or creak
    let quality = 0;
    const phon = sg && sg.ph.manner !== 'stop' ? units[sg.unit].ph.phonation : undefined;
    if (phon === 'breathy') { abd = Math.max(abd, 0.22); quality = 1.0; }
    if (phon === 'creaky') quality = -0.6;
    for (const w of murmur) if (time + 0.01 >= w.t0 && time + 0.01 < w.t1) { abd = Math.max(abd, 0.28); quality = 1.2; }
    // lungs: on during the utterance, lower during pauses, off at the end
    let ps = time < duration ? o.ps : 0;
    let rd = quality;
    if (time < duration) {
      if (nat.voiceQuality) {
        ps *= 1 - st.declination * (time / duration);
        for (const v of stressedVowels) {
          const c = 0.5 * (v.t0 + v.t1), w = (v.t1 - v.t0) + 0.08;
          const d = Math.abs(time - c);
          if (d < w) { const e = 0.5 * (1 + Math.cos((Math.PI * d) / w)); ps *= 1 + st.stressPs * e; rd -= st.stressRd * e; }
        }
        // the end of each phrase relaxes: less pressure, breathier voice
        for (const pe of phraseEnds) {
          const d = pe - time;
          if (d >= 0 && d < st.endWindow) { const e = 1 - d / st.endWindow; ps *= 1 - st.endPs * e; rd += st.endRd * e; }
        }
      }
      // a pause is quiet: the lungs hold back instead of blowing through the open glottis
      if (sg?.ph.manner === 'silence' && sg.t1 - sg.t0 > 0.1 && time > sg.t0 + 0.04 && time < sg.t1 - 0.06) ps *= 0.08;
    }
    const tip = flickAt('tipY', time), lips = flickAt('lipOpen', time), dorsum = flickAt('tongueX', time);
    const tr = trills.find((w) => time >= w.t0 && time < w.t1);
    frames.push({
      t: time, art, abduction: abd, f0: f0At(time), ps, tip, ...(lips ? { lips } : {}), ...(dorsum ? { dorsum } : {}), rd, gate, ...(tense ? { tense } : {}),
      ...(tr ? { trill: 1, trillKey: tr.key, trillAt: tr.at } : {}),
      ...(clickAt(time) > 0 ? { click: clickAt(time) } : {}),
    });
  }
  const sp: ScorePhone[] = [];
  for (const s of segs) {
    const prev = sp[sp.length - 1];
    if (prev && prev.ipa === s.label && (s.part === 'release' || s.part === 'aspiration' || units[s.unit].ph.manner === 'affricate') && sp.length && segs[segs.indexOf(s) - 1]?.unit === s.unit) { prev.t1 = s.t1; continue; }
    sp.push({ ipa: s.label, t0: s.t0, t1: s.t1 });
  }
  // the melody is already a smooth curve (Fujisaki's filters, the drawn
  // contour): the engine only rounds off the 5 ms frame steps, without the
  // slower glide it gives to a slider, which would shave the accent peaks
  const scaled = o.tauScale && Object.values(o.tauScale).some((v) => v !== undefined && v !== 1);
  return { frames, phones: sp, duration, flutter: nat.micro ? st.flutter : 0, f0Tau: 0.006, ...(scaled ? { tauScale: { ...o.tauScale } } : {}) };
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
