import type { Phone } from './g2p';
import { readIpa } from './ipaReader';
import { phonemeFor } from './derive';
import { speechLanguage, SpeechLanguage } from './languages';

/**
 * Text and language to phones, for the languages without rules of their own
 * (languages.ts). Each word is looked up in an open pronunciation dictionary
 * (ipa-dict) when the language has one; the words it does not have are
 * transcribed by a neural model (CharsiuG2P: a byte-level ByT5 transformer
 * trained on the pronunciations of about 100 languages, Zhu et al. 2022).
 * The transcriptions are then read like any [IPA]: said as written, with the
 * phrase breaks and the questions of the punctuation.
 *
 * Loading is the caller's (it needs the network): resolve() fetches what a
 * text needs through the sources it is given, phonemize() then reads it
 * synchronously from what is known.
 */

/** Where the pronunciation of a word came from. */
export type WordSource = 'dictionary' | 'model';

/** A pronunciation dictionary: word -> IPA (the first pronunciation it gives). */
export type Dictionary = Map<string, string>;

/** Parses an ipa-dict data file: one "word<TAB>/ipa/, /ipa/" per line. */
export function parseIpaDict(text: string): Dictionary {
  const d: Dictionary = new Map();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    const m = /\/([^/]+)\//.exec(line.slice(tab + 1));
    if (word && m && !d.has(word)) d.set(word, m[1].trim());
  }
  return d;
}

/**
 * What the sources write that the IPA reader does not: ASCII length colons,
 * the tone-accent digits of the Swedish dictionary, the brackets of optional
 * sounds, spaces between the syllables of a word; and the fixes of a language.
 */
export function normalizeIpa(ipa: string, lang?: SpeechLanguage): string {
  let s = ipa;
  // the model's SAMPA (Swedish): before the digits go, as some of them are vowels (2 ø, 9 œ, u0 ɵ)
  if (lang?.sampa && /[A-Z%}{`"@*]|u0/.test(s)) for (const [from, to] of lang.sampa) s = s.split(from).join(to);
  for (const [from, to] of lang?.fix ?? []) s = s.split(from).join(to);
  s = s
    .replace(/:/g, 'ː')
    .replace(/[0-9¹²³]/g, '')
    .replace(/[()⁽⁾-]/g, '')
    .replace(/'/g, 'ˈ')
    .trim()
    .replace(/\s+/g, '.')
    // a capital that is no IPA letter (a name the model kept as written)
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    // the Danish affricated /t/: tˢ
    .replace(/([td])ˢ/g, '$1͡s');
  return s;
}

// ------------------------------------------------------------ the model

/** End of sequence; byte b is token b + 3 (0 pad, 1 end, 2 unknown): the ByT5 vocabulary. */
const EOS = 1, BYTE0 = 3;

/** A sequence-to-sequence network: the scores of the next output token. */
export interface G2PNet {
  next(input: number[], output: number[]): Promise<Float32Array>;
}

/** Bytes of a text as ByT5 tokens (no end token: the model was trained without one). */
export const byteTokens = (s: string): number[] => [...new TextEncoder().encode(s)].map((b) => b + BYTE0);

/** One word through the model, greedily: "<fra>: bonjour" -> "bɔ̃ʒuʁ". */
export async function g2pWord(net: G2PNet, prefix: string, word: string): Promise<string> {
  const input = byteTokens(`<${prefix}>: ${word}`);
  const max = Math.min(160, 4 * input.length + 16);
  const out = [0];
  while (out.length <= max) {
    const scores = await net.next(input, out);
    let best = 0;
    for (let v = 1; v < scores.length; v++) if (scores[v] > scores[best]) best = v;
    if (best === EOS) break;
    out.push(best);
  }
  const bytes = out.slice(1).filter((t) => t >= BYTE0).map((t) => t - BYTE0);
  return new TextDecoder().decode(Uint8Array.from(bytes)).trim();
}

// ------------------------------------------------------------ what is known

const dictionaries = new Map<string, Dictionary>();
/** dictionaries that could not be loaded: the model reads those languages */
const failed = new Set<string>();
const fromModel = new Map<string, string>();
const modelKey = (lang: SpeechLanguage, word: string) => lang.model + '\u0000' + word;

export function setDictionary(file: string, d: Dictionary): void { dictionaries.set(file, d); failed.delete(file); }
/** Whether a language's dictionary is loaded (or it has none, or it failed and the model stands in). */
export function dictionaryReady(lang: SpeechLanguage): boolean {
  return !lang.dict || dictionaries.has(lang.dict) || failed.has(lang.dict);
}
export function dictionaryFailed(lang: SpeechLanguage): boolean { return !!lang.dict && failed.has(lang.dict); }
export function setModelWord(lang: SpeechLanguage, word: string, ipa: string): void { fromModel.set(modelKey(lang, word), ipa); }

/** Scripts written without spaces between words: a word the dictionary lacks is split into the longest words it has. */
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LONGEST = 8;

interface Piece { ipa: string; source: WordSource }

/** The pronunciation of a word from what is known, and what the model still has to read. */
function pieces(word: string, lang: SpeechLanguage): { pieces: Piece[]; missing: string[] } {
  const d = lang.dict ? dictionaries.get(lang.dict) : undefined;
  const hit = d?.get(word) ?? fromModel.get(modelKey(lang, word));
  if (hit !== undefined) return { pieces: [{ ipa: hit, source: d?.has(word) ? 'dictionary' : 'model' }], missing: [] };
  if (!d || !SPACELESS.test(word) || [...word].length < 2) return { pieces: [], missing: [word] };
  const chars = [...word], out: Piece[] = [], missing: string[] = [];
  let rest = '';
  const flush = () => {
    if (!rest) return;
    const m = fromModel.get(modelKey(lang, rest));
    if (m !== undefined) out.push({ ipa: m, source: 'model' }); else missing.push(rest);
    rest = '';
  };
  for (let i = 0; i < chars.length;) {
    let n = Math.min(LONGEST, chars.length - i);
    for (; n >= 1; n--) if (d.has(chars.slice(i, i + n).join(''))) break;
    if (n >= 1) { flush(); out.push({ ipa: d.get(chars.slice(i, i + n).join(''))!, source: 'dictionary' }); i += n; } else { rest += chars[i]; i++; }
  }
  flush();
  return { pieces: out, missing };
}

// ------------------------------------------------------------ text to phones

interface Token { word?: string; number?: string; pause?: 'short' | 'long'; question?: boolean }

const SHORT = /[,;:—–、，；：،]/;
const LONG = /[.!。！।…]/;
const QUESTION = /[?？؟]/;

/** Words and punctuation, split by the browser's word breaker for the language (it knows Thai, Chinese, Japanese...). */
export function tokenize(text: string, code: string): Token[] {
  const out: Token[] = [];
  const greek = code === 'el' || code === 'grc'; // the Greek question mark is a semicolon
  for (const s of new Intl.Segmenter(code, { granularity: 'word' }).segment(text)) {
    if (s.isWordLike) {
      if (/^[\p{N}.,]+$/u.test(s.segment)) out.push({ number: s.segment });
      // the typographic apostrophe is the ASCII one in the dictionaries (j’ai is j'ai)
      else out.push({ word: s.segment.toLocaleLowerCase(code).replace(/’/g, "'") });
      continue;
    }
    for (const ch of s.segment) {
      if (QUESTION.test(ch) || (greek && ch === ';')) out.push({ pause: 'long', question: true });
      else if (LONG.test(ch)) out.push({ pause: 'long' });
      else if (SHORT.test(ch)) out.push({ pause: 'short' });
    }
  }
  return out;
}

/** Marks the stress of a word that has none, where the language puts it. */
function placeStress(ph: Phone[], where: SpeechLanguage['stress']): void {
  if (!where || ph.some((p) => p.stress || p.tone)) return;
  // the first vowel of each run of vowels: one syllable each
  const nuclei: number[] = [];
  ph.forEach((p, i) => { if (phonemeFor(p.ipa)?.manner === 'vowel' && !(i > 0 && phonemeFor(ph[i - 1].ipa)?.manner === 'vowel')) nuclei.push(i); });
  if (!nuclei.length) return;
  const k = where === 'first' ? 0 : where === 'last' ? nuclei.length - 1 : Math.max(0, nuclei.length - 2);
  ph[nuclei[k]].stress = true;
}

function wordPhones(ps: Piece[], lang: SpeechLanguage): Phone[] {
  const ph = ps.flatMap((p) => readIpa(normalizeIpa(p.ipa, lang)).phones);
  for (const p of ph) { p.literal = true; p.wordStart = false; p.wordEnd = false; delete p.pause; delete p.question; }
  if (ph.length) { ph[0].wordStart = true; ph[ph.length - 1].wordEnd = true; }
  placeStress(ph, lang.stress);
  return ph;
}

export interface Phonemized {
  phones: Phone[];
  /** words (or runs of characters) that only the model can read, and has not yet */
  missing: string[];
  /** numbers, which are spelled out only in Italian and English */
  numbers: string[];
  /** the words the model read */
  modelWords: string[];
  /** how many words the dictionary gave */
  dictionaryWords: number;
}

/** A text in a language of languages.ts to phones, from what is known now. */
export function phonemize(text: string, code: string): Phonemized {
  const res: Phonemized = { phones: [], missing: [], numbers: [], modelWords: [], dictionaryWords: 0 };
  const lang = speechLanguage(code);
  if (!lang) return res;
  const out = res.phones;
  for (const t of tokenize(text, code)) {
    if (t.number) { res.numbers.push(t.number); continue; }
    if (t.word) {
      const r = pieces(t.word, lang);
      if (r.missing.length) { res.missing.push(...r.missing); continue; }
      if (r.pieces.some((p) => p.source === 'model')) res.modelWords.push(t.word);
      if (r.pieces.some((p) => p.source === 'dictionary')) res.dictionaryWords++;
      out.push(...wordPhones(r.pieces, lang));
      continue;
    }
    const last = out[out.length - 1];
    if (!last) continue;
    if (t.pause && last.pause !== 'long') last.pause = t.pause;
    if (t.question) last.question = true;
  }
  return res;
}

/** Where the dictionaries and the model come from (the network, in the browser; files, in a script). */
export interface PhonemizerSources {
  dictionary(file: string): Promise<string>;
  model(): Promise<G2PNet>;
}

/**
 * Fetches what a text needs: the dictionary of its language (once), then
 * the model for the words the dictionary lacks. `stage` reports each step.
 */
export async function resolve(text: string, code: string, src: PhonemizerSources, stage?: (s: 'dictionary' | 'model') => void): Promise<void> {
  const lang = speechLanguage(code);
  if (!lang) return;
  if (!dictionaryReady(lang)) {
    stage?.('dictionary');
    try { setDictionary(lang.dict!, parseIpaDict(await src.dictionary(lang.dict!))); } catch { failed.add(lang.dict!); }
  }
  const missing = [...new Set(phonemize(text, code).missing)];
  if (!missing.length) return;
  stage?.('model');
  const net = await src.model();
  for (const w of missing) setModelWord(lang, w, await g2pWord(net, lang.model, w));
}
