/**
 * The languages the Speak panel reads. Italian and English have rules of
 * their own (g2p.ts, english.ts); every other language goes through the
 * phonemizer (phonemizer.ts): a pronunciation dictionary where there is one
 * with an open license, and a neural model for the words it does not have.
 */
import type { Postures } from './derive';
import { ITALIAN_CLOSURE_SHARE, ITALIAN_POSTURES } from './italianPostures';

export interface SpeechLanguage {
  /** BCP 47 code, also used to split the text into words */
  code: string;
  name: string;
  /** the language prefix of the neural model (CharsiuG2P, Zhu et al. 2022) */
  model: string;
  /** the data file of the open pronunciation dictionary (ipa-dict), when it has one */
  dict?: string;
  /**
   * Where the stress falls when a transcription gives none: languages with a
   * fixed stress only. Languages whose stress is lexical and whose sources
   * do not mark it (Russian, Greek...) are read without one.
   */
  stress?: 'first' | 'penult' | 'last';
  /** symbols the sources write for a sound of this language that the model makes better with another */
  fix?: [string, string][];
  /**
   * the SAMPA the neural model writes for this language (it learned it from
   * its training lexicon), turned into IPA: applied to a transcription that
   * has any of its letters, before the dictionary's tone digits are dropped
   */
  sampa?: [string, string][];
}

/** Swedish SAMPA (Wells; the NST lexicon): ɵ ʉ ø œ and the retroflexes, ɧ for the sj-sound, stress marks and diphthong links */
const SWEDISH_SAMPA: [string, string][] = [
  ['u0', 'ɵ'], ['n`', 'ɳ'], ['t`', 'ʈ'], ['d`', 'ɖ'], ['s`', 'ʂ'], ['l`', 'ɭ'], ['}', 'ʉ'], ['2', 'ø'], ['9', 'œ'], ['{', 'æ'],
  ['@', 'ə'], ['A', 'ɑ'], ['O', 'ɔ'], ['Y', 'ʏ'], ['U', 'ʊ'], ['I', 'ɪ'], ['E', 'ɛ'], ['N', 'ŋ'], ['S', 'ɧ'],
  ['%', 'ˌ'], ['"', 'ˈ'], ['*', ''], ['`', ''],
];

/**
 * How a language is spoken beyond its sounds, as the planner reads it:
 * - rhythm: by stress feet (unstressed vowels short and reduced: German,
 *   Russian, European Portuguese), by syllables (all about even: Spanish,
 *   French, Turkish) or by morae (a long vowel or a geminate is two:
 *   Japanese) (Pike 1945; Abercrombie 1967; Dauer 1983; Ramus, Nespor &
 *   Mehler 1999);
 * - accents: a pitch accent on every stressed word, one at the end of each
 *   phrase only (French, whose accent is the phrase's, not the word's;
 *   Korean and Japanese accentual phrases), or none where tones do it;
 * - peak: the peak of an accent early in its vowel (Germanic, Finnic,
 *   Hungarian) or late, at its end (Romance, Greek: L+H*);
 * - question: a yes/no question rises at the end, or rises on its last
 *   stressed syllable and falls after it (Hungarian, Romanian, Greek,
 *   Russian: Ladd 2008);
 * - final: the lengthening of the last syllable of a phrase against the
 *   planner's (strong in French, weak where length is a phoneme: Finnish,
 *   Estonian, Hungarian, Japanese).
 */
export interface LanguageProsody {
  rhythm: 'stress' | 'syllable' | 'mora';
  accents: 'word' | 'phrase' | 'none';
  peak: 'early' | 'late';
  question: 'rise' | 'riseFall';
  final: number;
}

/** what a language without a profile gets: even syllables, an accent on each stressed word, peaks late, questions rising */
export const NEUTRAL_PROSODY: LanguageProsody = { rhythm: 'syllable', accents: 'word', peak: 'late', question: 'rise', final: 1 };

const GERMANIC: Partial<LanguageProsody> = { rhythm: 'stress', peak: 'early' };
const EAST_SLAVIC: Partial<LanguageProsody> = { rhythm: 'stress', question: 'riseFall' };
const QUANTITY: Partial<LanguageProsody> = { peak: 'early', final: 0.7 };
const TONES: Partial<LanguageProsody> = { accents: 'none' };
const PROFILES: Record<string, Partial<LanguageProsody>> = {
  de: GERMANIC, nl: GERMANIC, af: GERMANIC, lb: GERMANIC, sv: GERMANIC, nb: GERMANIC, da: GERMANIC, is: GERMANIC,
  cy: GERMANIC, ga: GERMANIC,
  ru: EAST_SLAVIC, uk: EAST_SLAVIC, be: EAST_SLAVIC, bg: { rhythm: 'stress' }, 'pt-PT': { rhythm: 'stress' }, ar: { rhythm: 'stress' },
  fr: { accents: 'phrase', final: 1.3 }, 'fr-CA': { accents: 'phrase', final: 1.3 },
  ro: { question: 'riseFall' }, el: { question: 'riseFall' }, grc: { question: 'riseFall' },
  hu: { ...QUANTITY, question: 'riseFall' }, fi: QUANTITY, et: QUANTITY, cs: { peak: 'early' }, sk: { peak: 'early' },
  ja: { rhythm: 'mora', accents: 'phrase', final: 0.8 }, ko: { accents: 'phrase' },
  zh: TONES, 'zh-TW': TONES, yue: TONES, vi: TONES, th: { ...TONES, rhythm: 'stress' },
};

/** The prosody of a language read by the phonemizer; undefined for those with rules of their own and for unknown codes. */
export function prosodyOf(code: string): LanguageProsody | undefined {
  if (!SPEECH_LANGUAGES.some((l) => l.code === code)) return undefined;
  return { ...NEUTRAL_PROSODY, ...PROFILES[code] };
}

/**
 * How a language says its sounds, where languages differ in the gesture and not in the symbol: the sequencer reads
 * these as data, so that none of its rules names a language. A new language is a new entry here.
 */
export interface Pronunciation {
  /** the table of durations, and of the contexts that stretch and shorten them, that the timing follows */
  timing: 'italian' | 'english' | 'even';
  /**
   * voiceless stops at the start of a syllable, before a vowel and not after s, are let go with the folds apart;
   * before l r w j of the same onset the breath falls on that sound instead
   */
  aspirated: boolean;
  /** an aspirated stop of the tongue tip opens slowly, through the channel of a hiss */
  fricatedTip: boolean;
  /** the velum comes down from the start of a vowel before a nasal (the vowel is nasalized), not from about its middle */
  earlyNasal: boolean;
  /** accents peak early, inside the stressed vowel */
  earlyPeak: boolean;
  /** how fast an accent rises (1/s) */
  accentRate: number;
  /** how far apart the folds are in a voiced stop at the start of a word (0.02: fully voiced; more: partly unvoiced) */
  initialVoicedStop: number;
  /** the postures the language gives its sounds, over those of the tables and the chart (none: the chart's) */
  postures: Postures;
  /** the share of an affricate's time its closure takes, by symbol (0.45 where none is given) */
  closureShare: Readonly<Record<string, number>>;
  /**
   * how far a nasal takes the place of the closure after it (the mouth shuts once, where the next sound needs it, and
   * only the velum moves: "banco" [ŋk], "in piazza" [mp]): not at all, inside a word, or also across the words of a
   * phrase
   */
  nasalPlace: 'none' | 'word' | 'phrase';
  /**
   * how many times the tip strikes in a single (not long) trill before the speaker lets it go, as in Italian, where a
   * single r has one or two contacts and a long one three or more (0: as many as the air allows): the tip rises, touches
   * and leaves for the next sound, the walls slack behind it as for a tap
   */
  shortTrillBeats: number;
  /**
   * a closure of the tongue tip (a stop or a nasal) brings the body of the tongue with it, `share` of the way from
   * where the vowels around have it toward (`x`, `y`) (tongueX, tongueY): learnt for the Italian dentals
   */
  tipBody: { share: number; x: number; y: number };
}

/** a language with no entry of its own, and any transcription: even timing, plain stops, peaks where its prosody puts them */
export const PLAIN_PRONUNCIATION: Pronunciation = { timing: 'even', aspirated: false, fricatedTip: false, earlyNasal: false, earlyPeak: false, accentRate: 28, initialVoicedStop: 0.02, postures: {}, closureShare: {}, nasalPlace: 'none', shortTrillBeats: 0, tipBody: { share: 0, x: 0, y: 0 } };

const PRONUNCIATIONS: Record<string, Partial<Pronunciation>> = {
  // its sounds as a listener hears them best from our mouth (learnt: see italianPostures.ts)
  it: { timing: 'italian', postures: ITALIAN_POSTURES, closureShare: ITALIAN_CLOSURE_SHARE, nasalPlace: 'phrase', shortTrillBeats: 1,
    tipBody: { share: 0.319, x: 0.472, y: 0.698 } },
  // aspiration and the slow tip (Klatt 1975), the vowel nasalized before a nasal (Cohn 1990), b d g partly unvoiced at the start of a word
  en: { timing: 'english', aspirated: true, fricatedTip: true, earlyNasal: true, earlyPeak: true, accentRate: 26, initialVoicedStop: 0.12, nasalPlace: 'word' },
};

/** The pronunciation of a language read by our own rules (text or /phonemic/ input); one without an entry is said as Italian. */
export function pronunciationOf(code: string): Pronunciation {
  return { ...PLAIN_PRONUNCIATION, ...(PRONUNCIATIONS[code] ?? PRONUNCIATIONS.it) };
}

/**
 * The words of a language that lean on the word after them and carry no
 * accent of their own: articles, short prepositions, conjunctions and clitic
 * pronouns, only those that are unstressed as a rule (the Spanish "un" and
 * "no" are stressed, and so are left out; so is every word a written accent
 * tells apart, as "él" from "el"). French is not here: its accent is the
 * phrase's. Nor is Czech, whose prepositions take the stress themselves.
 */
const CLITICS: Record<string, string> = {
  es: 'el la los las lo de del a al en con por para sin y e o u ni que si me te se nos os le les mi tu su mis tus sus pero',
  pt: 'o a os as de do da dos das em no na nos nas por pelo pela pelos pelas para pra com e ou mas que se me te lhe lhes ao aos à às',
  gl: 'o a os as de do da dos das en no na nos nas con por para e ou que se me te lle lles ao aos á ás',
  ca: 'el la els les l de del dels a al als en amb per pel pels i o ni que si em et es ens us li ho hi',
  ro: 'și sau de la în pe cu din că să se mă te ne vă îl îi le',
  de: 'der die das den dem des ein eine einen einem einer eines und oder zu in im an am auf mit von vom für bei zum zur aus nach um dass es',
  nl: 'de het een en of in op aan met van voor te bij om uit naar dat er je ze we',
  sv: 'en ett den det de och eller men i på av till för med om som att',
  nb: 'en ei et den det de og eller men i på av til for med om som at å',
  da: 'en et den det de og eller men i på af til for med om som at',
  pl: 'w we z ze na do i a o u po od za że się',
  hu: 'a az és hogy is',
};
const cliticSets = new Map<string, Set<string>>();

/** Whether a word (in lower case) is one of the unstressed function words of a language of the phonemizer. */
export function isClitic(code: string, word: string): boolean {
  const base = code.split('-')[0];
  if (!CLITICS[base]) return false;
  let set = cliticSets.get(base);
  if (!set) cliticSets.set(base, (set = new Set(CLITICS[base].split(' '))));
  return set.has(word);
}

/** Italian and English: rules of their own, no download. */
export const OWN_RULES = ['it', 'en'] as const;

export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: 'fr', name: 'French', model: 'fra', dict: 'fr_FR', stress: 'last' },
  { code: 'fr-CA', name: 'French (Quebec)', model: 'fra-qu', dict: 'fr_QC', stress: 'last' },
  { code: 'es', name: 'Spanish', model: 'spa' },
  { code: 'es-MX', name: 'Spanish (Mexico)', model: 'spa-me' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', model: 'por-bz', dict: 'pt_BR' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', model: 'por-po' },
  { code: 'ca', name: 'Catalan', model: 'cat' },
  { code: 'gl', name: 'Galician', model: 'glg' },
  { code: 'ro', name: 'Romanian', model: 'ron' },
  { code: 'la', name: 'Latin', model: 'lat-clas' },
  // the German r of the model is often a tap: the standard is uvular
  { code: 'de', name: 'German', model: 'ger', fix: [['ɾ', 'ʁ'], ['r', 'ʁ']] },
  { code: 'nl', name: 'Dutch', model: 'dut', dict: 'nl' },
  { code: 'af', name: 'Afrikaans', model: 'afr' },
  { code: 'lb', name: 'Luxembourgish', model: 'ltz', stress: 'first' },
  { code: 'sv', name: 'Swedish', model: 'swe', dict: 'sv', sampa: SWEDISH_SAMPA },
  { code: 'nb', name: 'Norwegian', model: 'nob', dict: 'nb' },
  { code: 'da', name: 'Danish', model: 'dan' },
  { code: 'is', name: 'Icelandic', model: 'ice', dict: 'is', stress: 'first' },
  { code: 'ru', name: 'Russian', model: 'rus' },
  { code: 'uk', name: 'Ukrainian', model: 'ukr' },
  { code: 'be', name: 'Belarusian', model: 'bel' },
  { code: 'pl', name: 'Polish', model: 'pol', stress: 'penult' },
  { code: 'cs', name: 'Czech', model: 'cze', stress: 'first' },
  { code: 'sk', name: 'Slovak', model: 'slk', stress: 'first' },
  { code: 'sl', name: 'Slovenian', model: 'slv' },
  { code: 'hr', name: 'Croatian, Serbian, Bosnian', model: 'hbs-latn' },
  { code: 'sr', name: 'Serbian (Cyrillic)', model: 'hbs-cyrl' },
  { code: 'bg', name: 'Bulgarian', model: 'bul' },
  { code: 'mk', name: 'Macedonian', model: 'mac' },
  { code: 'el', name: 'Greek', model: 'gre' },
  { code: 'grc', name: 'Ancient Greek', model: 'grc' },
  { code: 'sq', name: 'Albanian', model: 'sqi' },
  { code: 'lt', name: 'Lithuanian', model: 'lit' },
  { code: 'hu', name: 'Hungarian', model: 'hun', stress: 'first' },
  { code: 'fi', name: 'Finnish', model: 'fin', stress: 'first' },
  { code: 'et', name: 'Estonian', model: 'est', stress: 'first', fix: [['^', 'ʲ']] },
  { code: 'eu', name: 'Basque', model: 'eus' },
  { code: 'ga', name: 'Irish', model: 'gle', stress: 'first' },
  { code: 'cy', name: 'Welsh', model: 'wel-nw', stress: 'penult' },
  { code: 'mt', name: 'Maltese', model: 'mlt' },
  { code: 'eo', name: 'Esperanto', model: 'epo', dict: 'eo', stress: 'penult' },
  { code: 'hy', name: 'Armenian', model: 'arm-e', stress: 'last' },
  { code: 'ka', name: 'Georgian', model: 'geo' },
  { code: 'tr', name: 'Turkish', model: 'tur' },
  { code: 'az', name: 'Azerbaijani', model: 'aze', stress: 'last' },
  { code: 'kk', name: 'Kazakh', model: 'kaz', stress: 'last' },
  { code: 'uz', name: 'Uzbek', model: 'uzb', stress: 'last', fix: [['S', 'ʃ']] },
  { code: 'tt', name: 'Tatar', model: 'tat', stress: 'last' },
  { code: 'ar', name: 'Arabic', model: 'ara' },
  { code: 'fa', name: 'Persian', model: 'fas', dict: 'fa', stress: 'last' },
  { code: 'hi', name: 'Hindi', model: 'hin' },
  { code: 'ur', name: 'Urdu', model: 'urd' },
  { code: 'ta', name: 'Tamil', model: 'tam' },
  { code: 'zh', name: 'Mandarin Chinese', model: 'zho-s', dict: 'zh_hans' },
  { code: 'zh-TW', name: 'Mandarin Chinese (traditional)', model: 'zho-t', dict: 'zh_hant' },
  { code: 'yue', name: 'Cantonese', model: 'yue', dict: 'yue' },
  { code: 'ja', name: 'Japanese', model: 'jpn', dict: 'ja' },
  { code: 'ko', name: 'Korean', model: 'kor', dict: 'ko' },
  { code: 'vi', name: 'Vietnamese', model: 'vie-n', dict: 'vi_N' },
  { code: 'th', name: 'Thai', model: 'tha' },
  { code: 'km', name: 'Khmer', model: 'khm' },
  { code: 'my', name: 'Burmese', model: 'bur' },
  { code: 'id', name: 'Indonesian', model: 'ind', dict: 'ma', stress: 'penult' },
  { code: 'ms', name: 'Malay', model: 'msa', dict: 'ma', stress: 'penult' },
  { code: 'tl', name: 'Tagalog', model: 'tgl' },
  { code: 'sw', name: 'Swahili', model: 'swa', dict: 'sw', stress: 'penult' },
  { code: 'am', name: 'Amharic', model: 'amh', fix: [['`', 'ʼ']] },
  { code: 'mi', name: 'Maori', model: 'mri', stress: 'first', fix: [['"', '']] },
];

export function speechLanguage(code: string): SpeechLanguage | undefined {
  return SPEECH_LANGUAGES.find((l) => l.code === code);
}
