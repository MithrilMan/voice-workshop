import { speechLanguage } from '../dsp/speech/languages';

/**
 * Example sentences in many languages: picking one also picks its language.
 * Italian and English are read by their own rules; the other languages by
 * their pronunciation dictionaries and, for the words these lack, a small
 * model downloaded the first time. Between brackets, IPA said as written, in
 * whatever language is chosen.
 */
export interface Example {
  /** a code of languages.ts ('it', 'en', 'fr', …), or 'ipa' */
  lang: string;
  text: string;
  /** what it lets you hear */
  shows: string;
}

export const EXAMPLES: readonly Example[] = [
  { lang: 'en', text: 'The moon is full tonight.', shows: 'a statement' },
  { lang: 'en', text: 'Are you coming tomorrow?', shows: 'a yes/no question' },
  { lang: 'en', text: 'Every voice you have ever heard is made of just two ingredients.', shows: 'a long sentence' },
  { lang: 'en', text: 'The little button on the water bottle', shows: 'flapped and glottal t' },
  { lang: 'it', text: 'La luna è piena stanotte.', shows: 'a statement' },
  { lang: 'it', text: 'Vieni anche tu domani?', shows: 'a yes/no question' },
  { lang: 'it', text: 'Il carro corre sulla strada.', shows: 'single and trilled r' },
  { lang: 'it', text: 'Gli gnocchi della nonna sono buonissimi.', shows: 'gli, gn and double consonants' },
  { lang: 'fr', text: 'Bonjour, comment ça va ?', shows: 'uvular r' },
  { lang: 'fr', text: 'Un bon vin blanc.', shows: 'nasal vowels' },
  { lang: 'es', text: 'El perro de San Roque no tiene rabo.', shows: 'trilled r' },
  { lang: 'pt-BR', text: 'Obrigado, foi um prazer.', shows: 'nasal diphthongs' },
  { lang: 'de', text: 'Ich möchte ein Stück Kuchen, bitte.', shows: 'ich and ach sounds, front rounded vowels' },
  { lang: 'nl', text: 'Goedemorgen, hoe gaat het?', shows: 'the Dutch g' },
  { lang: 'sv', text: 'Sju sjösjuka sjömän.', shows: 'the Swedish sj sound' },
  { lang: 'cs', text: 'Tři sta třicet tři stříbrných stříkaček.', shows: 'Czech ř' },
  { lang: 'pl', text: 'W Szczebrzeszynie chrząszcz brzmi w trzcinie.', shows: 'Polish sibilants' },
  { lang: 'ru', text: 'Доброе утро, как дела?', shows: 'soft and hard consonants' },
  { lang: 'el', text: 'Καλημέρα, τι κάνεις;', shows: 'Greek' },
  { lang: 'fi', text: 'Hyvää huomenta!', shows: 'long vowels' },
  { lang: 'hu', text: 'Jó reggelt kívánok!', shows: 'long vowels and double consonants' },
  { lang: 'tr', text: 'Bugün hava çok güzel.', shows: 'vowel harmony' },
  { lang: 'ar', text: 'صباح الخير', shows: 'pharyngeal and uvular sounds' },
  { lang: 'hi', text: 'नमस्ते, आप कैसे हैं?', shows: 'Hindi' },
  { lang: 'zh', text: '妈妈骂马吗？', shows: 'the tones of Mandarin' },
  { lang: 'yue', text: '早晨，你好嗎？', shows: 'the tones of Cantonese' },
  { lang: 'ja', text: 'こんにちは、お元気ですか？', shows: 'Japanese' },
  { lang: 'ko', text: '안녕하세요, 반갑습니다.', shows: 'Korean' },
  { lang: 'vi', text: 'Xin chào, bạn khỏe không?', shows: 'the tones of Vietnamese' },
  { lang: 'th', text: 'สวัสดีครับ', shows: 'the tones of Thai' },
  { lang: 'sw', text: 'Habari ya asubuhi?', shows: 'Swahili' },
  { lang: 'cy', text: 'Bore da, sut wyt ti?', shows: 'Welsh' },
  { lang: 'ipa', text: '[ˈr̝ɛka]', shows: 'Czech ř, as written' },
  { lang: 'ipa', text: '[ma˥ ma˧˥ ma˨˩˦ ma˥˩]', shows: 'the four tones of Mandarin on one syllable' },
  { lang: 'ipa', text: '[ǀa ǃa ǁa ǂa ʘa]', shows: 'clicks' },
  { lang: 'ipa', text: '[pʰal bʱaːiː]', shows: 'aspirated and murmured stops (Hindi)' },
];

/** A few short ones, for the Play mode */
export const QUICK_EXAMPLES: readonly Example[] = [
  { lang: 'en', text: 'a buzz, a hiss and a filter', shows: 'the idea of this workshop' },
  { lang: 'en', text: 'is it raining?', shows: 'a question' },
  { lang: 'it', text: 'ciao, come stai?', shows: 'a question' },
  { lang: 'it', text: 'la voce è fatta di aria', shows: 'a statement' },
  ...['fr', 'es', 'de', 'cs', 'zh', 'ja'].map((l) => EXAMPLES.find((e) => e.lang === l)!),
  EXAMPLES.find((e) => e.text.startsWith('[ǀ'))!,
];

/** Sentences that show a melody, in the two languages read by rules. */
export const MELODY_PATTERNS: Readonly<Record<'it' | 'en', readonly [string, string][]>> = {
  it: [['Statement', 'la luna è piena stanotte.'], ['Yes/no question', 'vieni anche tu domani?'],
    ['Question with "where"', 'dove hai messo le chiavi?'], ['List', 'pane, latte, uova e caffè.']],
  en: [['Statement', 'the moon is full tonight.'], ['Yes/no question', 'are you coming tomorrow?'],
    ['Question with "where"', 'where did you put the keys?'], ['List', 'bread, milk, eggs and coffee.']],
};

/** The name of a language of speech. */
export function languageName(code: string): string {
  if (code === 'it') return 'Italian';
  if (code === 'en') return 'English (American)';
  if (code === 'ipa') return 'IPA, as written';
  return speechLanguage(code)?.name ?? code;
}

/** The examples by language, in the order of the list. */
export function examplesByLanguage(): [string, Example[]][] {
  const out = new Map<string, Example[]>();
  for (const e of EXAMPLES) out.set(e.lang, [...(out.get(e.lang) ?? []), e]);
  return [...out];
}

/** The first example in a language, if there is one. */
export const firstExample = (lang: string): string | undefined => EXAMPLES.find((e) => e.lang === lang)?.text;

/** The language an example is said in: its own, or for IPA the one chosen now. */
export const exampleLang = (e: Example, now: string): string => (e.lang === 'ipa' ? now : e.lang);
