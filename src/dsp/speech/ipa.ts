/**
 * The International Phonetic Alphabet as data: every consonant by place,
 * manner, voicing and airstream, every vowel by height, backness and
 * rounding, the diacritics and modifier letters as changes to a sound, the
 * tone letters and the suprasegmentals. ipaReader.ts reads a transcription
 * with these tables; derive.ts turns a symbol into articulatory targets. The
 * hand-fitted phonemes of phonemes.ts take precedence where they exist.
 */

export type Place =
  | 'bilabial' | 'labiodental' | 'dental' | 'alveolar' | 'postalveolar' | 'retroflex'
  | 'alveolopalatal' | 'palatal' | 'velar' | 'uvular' | 'pharyngeal' | 'epiglottal' | 'glottal';

export type ChartManner =
  | 'plosive' | 'nasal' | 'trill' | 'tap' | 'fricative' | 'lateralFricative'
  | 'approximant' | 'lateralApproximant' | 'lateralTap' | 'implosive' | 'click';

export interface ChartConsonant {
  place: Place;
  manner: ChartManner;
  voiced: boolean;
  /** lips rounded as a second articulation (w: labial-velar; ɥ: labial-palatal) */
  rounded?: boolean;
  /** a second, simultaneous place (ɧ: postalveolar and velar) */
  also?: Place;
  /** a click released past the sides of the tongue (ǁ) */
  lateral?: boolean;
}

export interface ChartVowel {
  /** 1 close .. 0 open */
  height: number;
  /** 0 front .. 1 back */
  back: number;
  rounded: boolean;
}

const c = (place: Place, manner: ChartManner, voiced: boolean, extra: Partial<ChartConsonant> = {}): ChartConsonant => ({ place, manner, voiced, ...extra });

/** The consonants of the IPA chart (2020): pulmonic, non-pulmonic and "other symbols". */
export const IPA_CONSONANTS: Record<string, ChartConsonant> = {
  // plosives
  p: c('bilabial', 'plosive', false), b: c('bilabial', 'plosive', true),
  t: c('alveolar', 'plosive', false), d: c('alveolar', 'plosive', true),
  'ʈ': c('retroflex', 'plosive', false), 'ɖ': c('retroflex', 'plosive', true),
  c: c('palatal', 'plosive', false), 'ɟ': c('palatal', 'plosive', true),
  k: c('velar', 'plosive', false), g: c('velar', 'plosive', true),
  q: c('uvular', 'plosive', false), 'ɢ': c('uvular', 'plosive', true),
  'ʡ': c('epiglottal', 'plosive', false),
  'ʔ': c('glottal', 'plosive', false),
  // nasals
  m: c('bilabial', 'nasal', true), 'ɱ': c('labiodental', 'nasal', true), n: c('alveolar', 'nasal', true),
  'ɳ': c('retroflex', 'nasal', true), 'ɲ': c('palatal', 'nasal', true), 'ŋ': c('velar', 'nasal', true),
  'ɴ': c('uvular', 'nasal', true),
  // trills, taps and flaps
  'ʙ': c('bilabial', 'trill', true), r: c('alveolar', 'trill', true), 'ʀ': c('uvular', 'trill', true),
  'ⱱ': c('labiodental', 'tap', true), 'ɾ': c('alveolar', 'tap', true), 'ɽ': c('retroflex', 'tap', true),
  // fricatives
  'ɸ': c('bilabial', 'fricative', false), 'β': c('bilabial', 'fricative', true),
  f: c('labiodental', 'fricative', false), v: c('labiodental', 'fricative', true),
  'θ': c('dental', 'fricative', false), 'ð': c('dental', 'fricative', true),
  s: c('alveolar', 'fricative', false), z: c('alveolar', 'fricative', true),
  'ʃ': c('postalveolar', 'fricative', false), 'ʒ': c('postalveolar', 'fricative', true),
  'ʂ': c('retroflex', 'fricative', false), 'ʐ': c('retroflex', 'fricative', true),
  'ɕ': c('alveolopalatal', 'fricative', false), 'ʑ': c('alveolopalatal', 'fricative', true),
  'ç': c('palatal', 'fricative', false), 'ʝ': c('palatal', 'fricative', true),
  x: c('velar', 'fricative', false), 'ɣ': c('velar', 'fricative', true),
  'χ': c('uvular', 'fricative', false), 'ʁ': c('uvular', 'fricative', true),
  'ħ': c('pharyngeal', 'fricative', false), 'ʕ': c('pharyngeal', 'fricative', true),
  'ʜ': c('epiglottal', 'fricative', false), 'ʢ': c('epiglottal', 'fricative', true),
  h: c('glottal', 'fricative', false), 'ɦ': c('glottal', 'fricative', true),
  'ɬ': c('alveolar', 'lateralFricative', false), 'ɮ': c('alveolar', 'lateralFricative', true),
  'ɧ': c('postalveolar', 'fricative', false, { also: 'velar' }),
  // approximants
  'ʋ': c('labiodental', 'approximant', true), 'ɹ': c('alveolar', 'approximant', true),
  'ɻ': c('retroflex', 'approximant', true), j: c('palatal', 'approximant', true), 'ɰ': c('velar', 'approximant', true),
  w: c('velar', 'approximant', true, { rounded: true }), 'ʍ': c('velar', 'fricative', false, { rounded: true }),
  'ɥ': c('palatal', 'approximant', true, { rounded: true }),
  l: c('alveolar', 'lateralApproximant', true), 'ɭ': c('retroflex', 'lateralApproximant', true),
  'ʎ': c('palatal', 'lateralApproximant', true), 'ʟ': c('velar', 'lateralApproximant', true),
  'ɺ': c('alveolar', 'lateralTap', true),
  // implosives: the larynx moves down with the folds vibrating
  'ɓ': c('bilabial', 'implosive', true), 'ɗ': c('alveolar', 'implosive', true), 'ʄ': c('palatal', 'implosive', true),
  'ɠ': c('velar', 'implosive', true), 'ʛ': c('uvular', 'implosive', true),
  // clicks: a front closure and a back (velar) one, the air between them rarefied
  'ʘ': c('bilabial', 'click', false), 'ǀ': c('dental', 'click', false), 'ǃ': c('alveolar', 'click', false),
  'ǂ': c('alveolopalatal', 'click', false), 'ǁ': c('alveolar', 'click', false, { lateral: true }),
};

const v = (height: number, back: number, rounded: boolean): ChartVowel => ({ height, back, rounded });

/** The vowels of the IPA chart: height 1 close .. 0 open, backness 0 front .. 1 back. */
export const IPA_VOWELS: Record<string, ChartVowel> = {
  i: v(1, 0, false), y: v(1, 0, true), 'ɨ': v(1, 0.5, false), 'ʉ': v(1, 0.5, true), 'ɯ': v(1, 1, false), u: v(1, 1, true),
  'ɪ': v(0.85, 0.15, false), 'ʏ': v(0.85, 0.15, true), 'ʊ': v(0.85, 0.85, true),
  e: v(0.67, 0, false), 'ø': v(0.67, 0, true), 'ɘ': v(0.67, 0.5, false), 'ɵ': v(0.67, 0.5, true), 'ɤ': v(0.67, 1, false), o: v(0.67, 1, true),
  'ə': v(0.5, 0.5, false),
  'ɛ': v(0.33, 0, false), 'œ': v(0.33, 0, true), 'ɜ': v(0.33, 0.5, false), 'ɞ': v(0.33, 0.5, true), 'ʌ': v(0.33, 1, false), 'ɔ': v(0.33, 1, true),
  'æ': v(0.17, 0, false), 'ɐ': v(0.2, 0.5, false),
  a: v(0, 0, false), 'ɶ': v(0, 0, true), 'ɑ': v(0, 1, false), 'ɒ': v(0, 1, true),
};

export type Modifier =
  | 'voiceless' | 'voiced' | 'aspirated' | 'breathy' | 'creaky' | 'raised' | 'lowered'
  | 'labialized' | 'palatalized' | 'velarized' | 'pharyngealized' | 'nasalized' | 'rhotic'
  | 'dental' | 'apical' | 'laminal' | 'advanced' | 'retracted' | 'centralized' | 'midCentralized'
  | 'moreRounded' | 'lessRounded' | 'atr' | 'rtr' | 'halfLong' | 'extraShort'
  | 'syllabic' | 'nonSyllabic' | 'noRelease' | 'ejective' | 'glottalized' | 'nasalRelease' | 'lateralRelease'
  | 'fortis' | 'compressed' | 'ingressive';

/** Combining diacritics (after a symbol), with what they change. */
export const IPA_DIACRITICS: Record<string, Modifier> = {
  '̥': 'voiceless', '̊': 'voiceless', '̬': 'voiced', '̤': 'breathy', '̰': 'creaky',
  '̝': 'raised', '̞': 'lowered', '̴': 'velarized',
  '̃': 'nasalized', '̪': 'dental', '̺': 'apical', '̻': 'laminal', '̟': 'advanced', '̠': 'retracted',
  '̈': 'centralized', '̽': 'midCentralized', '̹': 'moreRounded', '̜': 'lessRounded',
  '̘': 'atr', '̙': 'rtr', '̆': 'extraShort',
  '̩': 'syllabic', '̍': 'syllabic', '̯': 'nonSyllabic', '̑': 'nonSyllabic', '̚': 'noRelease',
  // extIPA's strong articulation, written for the Korean tense (fortis) consonants: s͈ p͈ t͈ k͈ t͡ɕ͈
  '͈': 'fortis',
};

/** Spacing modifier letters (after a symbol), with what they change. */
export const IPA_MODIFIER_LETTERS: Record<string, Modifier[]> = {
  'ʰ': ['aspirated'], 'ʱ': ['breathy', 'aspirated'], 'ʷ': ['labialized'], 'ʲ': ['palatalized'], 'ˠ': ['velarized'],
  'ˤ': ['pharyngealized'], 'ˀ': ['glottalized'], '˞': ['rhotic'], 'ʴ': ['rhotic'], 'ˑ': ['halfLong'],
  '˔': ['raised'], '˕': ['lowered'], 'ʼ': ['ejective'], '’': ['ejective'], 'ˡ': ['lateralRelease'], 'ⁿ': ['nasalRelease'],
  'ᶣ': ['labialized', 'palatalized'],
  // compressed lips (the Japanese u: ɯᵝ), rounded without protrusion
  'ᵝ': ['compressed'],
  // extIPA's ingressive airflow: the lungs draw the air in through the sound (the inward snare of beatboxers: k↓)
  '↓': ['ingressive'],
};

/** Superscript nasals before a consonant: a prenasalized stop (ᵐb, ⁿd, ᵑg). */
export const PRENASALS: Record<string, string> = { 'ᵐ': 'm', 'ⁿ': 'n', 'ᵑ': 'ŋ', 'ᶮ': 'ɲ', 'ᶯ': 'ɳ', 'ᶬ': 'ɱ', 'ᶰ': 'ɴ' };

/** Diacritics read but without an effect on the sound in this model. */
export const NO_EFFECT: ReadonlySet<Modifier> = new Set<Modifier>(['nasalRelease', 'lateralRelease']);

/** Tie bars: two symbols spoken as one sound (affricates, double articulations, diphthongs). */
export const TIE_BARS = ['͡', '͜'];

/**
 * Tones as levels of the speaker's pitch range, 1 (extra low) .. 5 (extra
 * high), after Chao (1930): the tone letters, superscript digits, and the
 * tone diacritics over a vowel.
 */
export const TONE_LETTERS: Record<string, number> = { '˥': 5, '˦': 4, '˧': 3, '˨': 2, '˩': 1, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5 };
export const TONE_DIACRITICS: Record<string, number[]> = {
  '̋': [5], '́': [4], '̄': [3], '̀': [2], '̏': [1],
  '̌': [1, 5], '̂': [5, 1], '᷄': [3, 5], '᷅': [1, 3], '᷈': [2, 4, 2],
};
/** Downstep and upstep: the next tones a step lower or higher. */
export const TONE_STEPS: Record<string, number> = { 'ꜜ': -1, 'ꜛ': 1 };
/** Global rise and fall of the intonation. */
export const GLOBAL_PITCH: Record<string, number> = { '↗': 1, '↘': -1 };

/** Other spellings of the same sound. */
export const IPA_SPELLINGS: Record<string, string> = {
  'ɡ': 'g', 'ʤ': 'dʒ', 'ʧ': 'tʃ', 'ʦ': 'ts', 'ʣ': 'dz', 'ᵊ': 'ə', 'ᵻ': 'ɪ', 'ɩ': 'ɪ', 'ɷ': 'ʊ', 'ʚ': 'ɞ', 'ɼ': 'r̝', 'ɿ': 'z̩', 'ʅ': 'ʐ̩',
  // the turned e, written for schwa by some sources (Khmer)
  'ǝ': 'ə',
};

const PLACE_NAMES: Record<Place, string> = {
  bilabial: 'bilabial', labiodental: 'labiodental', dental: 'dental', alveolar: 'alveolar', postalveolar: 'postalveolar',
  retroflex: 'retroflex', alveolopalatal: 'alveolo-palatal', palatal: 'palatal', velar: 'velar', uvular: 'uvular',
  pharyngeal: 'pharyngeal', epiglottal: 'epiglottal', glottal: 'glottal',
};
const MANNER_NAMES: Record<ChartManner, string> = {
  plosive: 'plosive', nasal: 'nasal', trill: 'trill', tap: 'tap', fricative: 'fricative',
  lateralFricative: 'lateral fricative', approximant: 'approximant', lateralApproximant: 'lateral approximant', lateralTap: 'lateral tap',
  implosive: 'implosive', click: 'click',
};
const HEIGHTS: [number, string][] = [[1, 'close'], [0.85, 'near-close'], [0.67, 'close-mid'], [0.5, 'mid'], [0.33, 'open-mid'], [0.17, 'near-open'], [0, 'open']];

/** The chart name of a base symbol, e.g. "voiced uvular fricative", "close front rounded vowel". */
export function ipaName(sym: string): string | undefined {
  const k = IPA_CONSONANTS[sym];
  if (k) {
    const place = sym === 'w' || sym === 'ʍ' ? 'labial-velar' : sym === 'ɥ' ? 'labial-palatal' : sym === 'ɧ' ? 'palatal-velar' : PLACE_NAMES[k.place];
    if (k.manner === 'click') return `${k.lateral ? 'lateral ' : ''}${place} click`;
    return `${k.voiced ? 'voiced' : 'voiceless'} ${place} ${MANNER_NAMES[k.manner]}`;
  }
  const w = IPA_VOWELS[sym];
  if (w) {
    const h = HEIGHTS.reduce((a, b) => (Math.abs(b[0] - w.height) < Math.abs(a[0] - w.height) ? b : a))[1];
    const b = w.back < 0.1 ? 'front' : w.back < 0.3 ? 'near-front' : w.back < 0.7 ? 'central' : w.back < 0.9 ? 'near-back' : 'back';
    return `${h} ${b} ${w.rounded ? 'rounded' : 'unrounded'} vowel`;
  }
  return undefined;
}
