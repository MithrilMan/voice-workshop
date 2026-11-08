/**
 * The languages the Speak panel reads. Italian and English have rules of
 * their own (g2p.ts, english.ts); every other language goes through the
 * phonemizer (phonemizer.ts): a pronunciation dictionary where there is one
 * with an open license, and a neural model for the words it does not have.
 */
export interface SpeechLanguage {
  /** BCP 47 code, also used to split the text into words */
  code: string;
  name: { it: string; en: string };
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

/** Italian and English: rules of their own, no download. */
export const OWN_RULES = ['it', 'en'] as const;

export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: 'fr', name: { it: 'Francese', en: 'French' }, model: 'fra', dict: 'fr_FR', stress: 'last' },
  { code: 'fr-CA', name: { it: 'Francese (Québec)', en: 'French (Quebec)' }, model: 'fra-qu', dict: 'fr_QC', stress: 'last' },
  { code: 'es', name: { it: 'Spagnolo', en: 'Spanish' }, model: 'spa' },
  { code: 'es-MX', name: { it: 'Spagnolo (Messico)', en: 'Spanish (Mexico)' }, model: 'spa-me' },
  { code: 'pt-BR', name: { it: 'Portoghese (Brasile)', en: 'Portuguese (Brazil)' }, model: 'por-bz', dict: 'pt_BR' },
  { code: 'pt-PT', name: { it: 'Portoghese (Portogallo)', en: 'Portuguese (Portugal)' }, model: 'por-po' },
  { code: 'ca', name: { it: 'Catalano', en: 'Catalan' }, model: 'cat' },
  { code: 'gl', name: { it: 'Galiziano', en: 'Galician' }, model: 'glg' },
  { code: 'ro', name: { it: 'Rumeno', en: 'Romanian' }, model: 'ron' },
  { code: 'la', name: { it: 'Latino', en: 'Latin' }, model: 'lat-clas' },
  // the German r of the model is often a tap: the standard is uvular
  { code: 'de', name: { it: 'Tedesco', en: 'German' }, model: 'ger', fix: [['ɾ', 'ʁ'], ['r', 'ʁ']] },
  { code: 'nl', name: { it: 'Olandese', en: 'Dutch' }, model: 'dut', dict: 'nl' },
  { code: 'af', name: { it: 'Afrikaans', en: 'Afrikaans' }, model: 'afr' },
  { code: 'lb', name: { it: 'Lussemburghese', en: 'Luxembourgish' }, model: 'ltz', stress: 'first' },
  { code: 'sv', name: { it: 'Svedese', en: 'Swedish' }, model: 'swe', dict: 'sv', sampa: SWEDISH_SAMPA },
  { code: 'nb', name: { it: 'Norvegese', en: 'Norwegian' }, model: 'nob', dict: 'nb' },
  { code: 'da', name: { it: 'Danese', en: 'Danish' }, model: 'dan' },
  { code: 'is', name: { it: 'Islandese', en: 'Icelandic' }, model: 'ice', dict: 'is', stress: 'first' },
  { code: 'ru', name: { it: 'Russo', en: 'Russian' }, model: 'rus' },
  { code: 'uk', name: { it: 'Ucraino', en: 'Ukrainian' }, model: 'ukr' },
  { code: 'be', name: { it: 'Bielorusso', en: 'Belarusian' }, model: 'bel' },
  { code: 'pl', name: { it: 'Polacco', en: 'Polish' }, model: 'pol', stress: 'penult' },
  { code: 'cs', name: { it: 'Ceco', en: 'Czech' }, model: 'cze', stress: 'first' },
  { code: 'sk', name: { it: 'Slovacco', en: 'Slovak' }, model: 'slk', stress: 'first' },
  { code: 'sl', name: { it: 'Sloveno', en: 'Slovenian' }, model: 'slv' },
  { code: 'hr', name: { it: 'Croato, serbo, bosniaco', en: 'Croatian, Serbian, Bosnian' }, model: 'hbs-latn' },
  { code: 'sr', name: { it: 'Serbo (cirillico)', en: 'Serbian (Cyrillic)' }, model: 'hbs-cyrl' },
  { code: 'bg', name: { it: 'Bulgaro', en: 'Bulgarian' }, model: 'bul' },
  { code: 'mk', name: { it: 'Macedone', en: 'Macedonian' }, model: 'mac' },
  { code: 'el', name: { it: 'Greco', en: 'Greek' }, model: 'gre' },
  { code: 'grc', name: { it: 'Greco antico', en: 'Ancient Greek' }, model: 'grc' },
  { code: 'sq', name: { it: 'Albanese', en: 'Albanian' }, model: 'sqi' },
  { code: 'lt', name: { it: 'Lituano', en: 'Lithuanian' }, model: 'lit' },
  { code: 'hu', name: { it: 'Ungherese', en: 'Hungarian' }, model: 'hun', stress: 'first' },
  { code: 'fi', name: { it: 'Finlandese', en: 'Finnish' }, model: 'fin', stress: 'first' },
  { code: 'et', name: { it: 'Estone', en: 'Estonian' }, model: 'est', stress: 'first', fix: [['^', 'ʲ']] },
  { code: 'eu', name: { it: 'Basco', en: 'Basque' }, model: 'eus' },
  { code: 'ga', name: { it: 'Irlandese', en: 'Irish' }, model: 'gle', stress: 'first' },
  { code: 'cy', name: { it: 'Gallese', en: 'Welsh' }, model: 'wel-nw', stress: 'penult' },
  { code: 'mt', name: { it: 'Maltese', en: 'Maltese' }, model: 'mlt' },
  { code: 'eo', name: { it: 'Esperanto', en: 'Esperanto' }, model: 'epo', dict: 'eo', stress: 'penult' },
  { code: 'hy', name: { it: 'Armeno', en: 'Armenian' }, model: 'arm-e', stress: 'last' },
  { code: 'ka', name: { it: 'Georgiano', en: 'Georgian' }, model: 'geo' },
  { code: 'tr', name: { it: 'Turco', en: 'Turkish' }, model: 'tur' },
  { code: 'az', name: { it: 'Azero', en: 'Azerbaijani' }, model: 'aze', stress: 'last' },
  { code: 'kk', name: { it: 'Kazako', en: 'Kazakh' }, model: 'kaz', stress: 'last' },
  { code: 'uz', name: { it: 'Uzbeko', en: 'Uzbek' }, model: 'uzb', stress: 'last', fix: [['S', 'ʃ']] },
  { code: 'tt', name: { it: 'Tataro', en: 'Tatar' }, model: 'tat', stress: 'last' },
  { code: 'ar', name: { it: 'Arabo', en: 'Arabic' }, model: 'ara' },
  { code: 'fa', name: { it: 'Persiano', en: 'Persian' }, model: 'fas', dict: 'fa', stress: 'last' },
  { code: 'hi', name: { it: 'Hindi', en: 'Hindi' }, model: 'hin' },
  { code: 'ur', name: { it: 'Urdu', en: 'Urdu' }, model: 'urd' },
  { code: 'ta', name: { it: 'Tamil', en: 'Tamil' }, model: 'tam' },
  { code: 'zh', name: { it: 'Cinese mandarino', en: 'Mandarin Chinese' }, model: 'zho-s', dict: 'zh_hans' },
  { code: 'zh-TW', name: { it: 'Cinese mandarino (tradizionale)', en: 'Mandarin Chinese (traditional)' }, model: 'zho-t', dict: 'zh_hant' },
  { code: 'yue', name: { it: 'Cantonese', en: 'Cantonese' }, model: 'yue', dict: 'yue' },
  { code: 'ja', name: { it: 'Giapponese', en: 'Japanese' }, model: 'jpn', dict: 'ja' },
  { code: 'ko', name: { it: 'Coreano', en: 'Korean' }, model: 'kor', dict: 'ko' },
  { code: 'vi', name: { it: 'Vietnamita', en: 'Vietnamese' }, model: 'vie-n', dict: 'vi_N' },
  { code: 'th', name: { it: 'Thailandese', en: 'Thai' }, model: 'tha' },
  { code: 'km', name: { it: 'Khmer', en: 'Khmer' }, model: 'khm' },
  { code: 'my', name: { it: 'Birmano', en: 'Burmese' }, model: 'bur' },
  { code: 'id', name: { it: 'Indonesiano', en: 'Indonesian' }, model: 'ind', dict: 'ma', stress: 'penult' },
  { code: 'ms', name: { it: 'Malese', en: 'Malay' }, model: 'msa', dict: 'ma', stress: 'penult' },
  { code: 'tl', name: { it: 'Tagalog', en: 'Tagalog' }, model: 'tgl' },
  { code: 'sw', name: { it: 'Swahili', en: 'Swahili' }, model: 'swa', dict: 'sw', stress: 'penult' },
  { code: 'am', name: { it: 'Amarico', en: 'Amharic' }, model: 'amh', fix: [['`', 'ʼ']] },
  { code: 'mi', name: { it: 'Maori', en: 'Maori' }, model: 'mri', stress: 'first', fix: [['"', '']] },
];

export function speechLanguage(code: string): SpeechLanguage | undefined {
  return SPEECH_LANGUAGES.find((l) => l.code === code);
}
