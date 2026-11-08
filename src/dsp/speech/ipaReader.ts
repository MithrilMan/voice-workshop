import type { Phone } from './g2p';
import { PHONEMES } from './phonemes';
import {
  IPA_CONSONANTS, IPA_VOWELS, IPA_DIACRITICS, IPA_MODIFIER_LETTERS, PRENASALS, TIE_BARS, TONE_LETTERS,
  TONE_DIACRITICS, TONE_STEPS, GLOBAL_PITCH, IPA_SPELLINGS, Modifier, NO_EFFECT,
} from './ipa';

/**
 * Reads a transcription in the International Phonetic Alphabet: every symbol
 * of the chart with its diacritics and modifier letters, tie bars, stress,
 * length, syllable breaks, groups, tones (tone letters, superscript digits,
 * tone diacritics), downstep and the global rise and fall. Whatever it cannot
 * read is reported, never dropped in silence.
 */

/** Something in a transcription the reader skipped or the model only approximates. */
export interface IpaNote {
  symbol: string;
  kind: 'unknown' | 'ignored' | 'approximate';
  detail: string;
}

export interface IpaReading {
  phones: Phone[];
  notes: IpaNote[];
}

/** One sound of a transcription: its base symbol, a tied second symbol, and the modifiers. */
export interface Segment {
  base: string;
  /** the symbol after a tie bar (t͡s, k͡p, a͡ɪ) */
  tied?: Segment;
  mods: Modifier[];
}

const LENGTH = new Set(['ː', ':']);
const HALF_LONG = 'ˑ';
const STRESS: Record<string, 1 | 2> = { 'ˈ': 1, "'": 1, 'ˌ': 2 };
const SHORT_PAUSE = new Set([',', '|']);
const LONG_PAUSE = new Set(['‖', '!', ';']);
const LINK = '‿';
const SYLLABLE = '.';
const DELIMITERS = new Set(['/', '[', ']']);

/** base symbols, longest first: the fitted phonemes (diphthongs, affricates), the chart, other spellings */
const BASES: string[] = Array.from(new Set([
  ...Object.keys(PHONEMES).filter((k) => k !== '_'),
  ...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS), ...Object.keys(IPA_SPELLINGS),
])).sort((a, b) => b.length - a.length);

/** tone levels: the tone letters, superscript digits, and plain digits 1-5 after a syllable (Chao's numbers) */
const toneLevel = (ch: string): number => TONE_LETTERS[ch] ?? (/[1-5]/.test(ch) ? Number(ch) : 0);
const isTone = (ch: string) => toneLevel(ch) > 0;
const isMark = (ch: string) => /\p{M}/u.test(ch);

/** NFD, with the letters whose decomposition is not IPA put back together (ç is not c + cedilla). */
export function normalizeIpa(s: string): string {
  return s.normalize('NFD').replace(/ç/g, 'ç').replace(/Ç/g, 'ç');
}

function matchBase(s: string, i: number): string {
  for (const b of BASES) if (s.startsWith(b, i)) return b;
  return '';
}

/** canonical spelling of a base (ɡ → g, ʧ → tʃ) */
const spell = (b: string) => IPA_SPELLINGS[b] ?? b;

/** a vowel (the first one of a tied pair) unless marked non-syllabic, or a consonant marked syllabic */
function isNucleusBase(base: string, mods: Modifier[]): boolean {
  const b = base.split(/[͜͡]/)[0];
  return (!!IPA_VOWELS[b] || PHONEMES[b]?.manner === 'vowel') ? !mods.includes('nonSyllabic') : mods.includes('syllabic');
}

/**
 * Parses one written sound (a symbol with its diacritics, possibly tied to a
 * second one), as the reader stores it in Phone.ipa: "r̝", "tʰ", "t͡ɬ", "ã".
 */
export function segmentOf(symbol: string): Segment | null {
  const s = normalizeIpa(symbol);
  let i = 0;
  const read = (): Segment | null => {
    const b = matchBase(s, i);
    if (!b) return null;
    i += b.length;
    const seg: Segment = { base: spell(b), mods: [] };
    while (i < s.length) {
      const ch = s[i];
      if (TIE_BARS.includes(ch)) {
        i++;
        const t = read();
        if (!t) return null;
        seg.tied = t;
        // the modifiers after the second symbol belong to the whole sound
        seg.mods.push(...t.mods);
        t.mods = [];
        break;
      }
      const m = IPA_DIACRITICS[ch] ?? IPA_MODIFIER_LETTERS[ch];
      if (!m) return null;
      seg.mods.push(...(Array.isArray(m) ? m : [m]));
      i++;
    }
    return seg;
  };
  const seg = read();
  return seg && i === s.length ? seg : null;
}

/** Reads an IPA transcription (without its delimiters, which are skipped anyway). */
export function readIpa(input: string): IpaReading {
  const s = normalizeIpa(input);
  const phones: Phone[] = [];
  const notes: IpaNote[] = [];
  const note = (symbol: string, kind: IpaNote['kind'], detail: string) => {
    if (!notes.some((n) => n.symbol === symbol && n.kind === kind)) notes.push({ symbol, kind, detail });
  };
  let stressNext: 0 | 1 | 2 = 0;
  let sylNext = false;
  let wordStart = true;
  let stepNext = 0;
  let pitchNext = 0;
  /** the phone being written (its diacritics still to come) */
  let cur: { phone: Phone; text: string; base: string; mods: Modifier[] } | null = null;
  /** the last nucleus, for tone letters written after the syllable */
  let lastNucleus: Phone | null = null;
  let toneOpen = false;

  const close = () => {
    if (!cur) return;
    const p = cur.phone;
    p.ipa = cur.text.normalize('NFC');
    const nucleus = isNucleusBase(cur.base, cur.mods);
    if (nucleus) {
      if (stressNext === 1) p.stress = true; else if (stressNext === 2) p.stress2 = true;
      stressNext = 0;
      if (stepNext) { p.toneStep = stepNext; stepNext = 0; }
      if (pitchNext) { p.globalPitch = pitchNext; pitchNext = 0; }
      lastNucleus = p;
    }
    for (const m of cur.mods) if (NO_EFFECT.has(m)) note(m, 'ignored', `${m}: read, without an effect on the sound in this model`);
    cur = null;
  };
  const push = (p: Phone) => {
    if (wordStart) { p.wordStart = true; wordStart = false; }
    if (sylNext) { p.sylStart = true; sylNext = false; }
    phones.push(p);
  };
  const last = () => phones[phones.length - 1];
  const consonantAt = (j: number) => {
    const b = matchBase(s, j);
    return !!b && !IPA_VOWELS[spell(b)] && PHONEMES[spell(b)]?.manner !== 'vowel';
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // tone letters and superscript digits: a run of them is one contour, on the last nucleus
    if (isTone(ch)) {
      const target = cur && isNucleusBase(cur.base, cur.mods) ? cur.phone : lastNucleus;
      close();
      const tl = target ?? lastNucleus;
      if (tl) {
        if (!toneOpen || !tl.tone) tl.tone = [];
        tl.tone.push(toneLevel(ch));
        toneOpen = true;
      } else note(ch, 'ignored', 'a tone letter before any vowel');
      i++;
      continue;
    }
    // a glottalized tone (Vietnamese ˧ˀ˥, ˨ˀ˩): the creak belongs to the syllable's vowel
    // (set by close(), which the compiler does not follow)
    const nucleusNow = lastNucleus as Phone | null;
    if (toneOpen && ch === 'ˀ' && nucleusNow) {
      nucleusNow.ipa = (nucleusNow.ipa + ch).normalize('NFC');
      i++;
      continue;
    }
    toneOpen = false;
    // a combining mark or modifier letter on the sound being written
    if (cur && (isMark(ch) || ch in IPA_MODIFIER_LETTERS) && !(ch in PRENASALS && consonantAt(i + 1))) {
      if (TIE_BARS.includes(ch)) {
        const b = matchBase(s, i + 1);
        if (b) {
          cur.text += ch + spell(b);
          cur.base = cur.base + ch + spell(b);
          i += 1 + b.length;
          continue;
        }
        note(ch, 'ignored', 'a tie bar with nothing to tie');
        i++;
        continue;
      }
      if (ch in TONE_DIACRITICS) {
        // a tone on a consonant makes it the nucleus of its syllable (Yoruba ń)
        if (!isNucleusBase(cur.base, cur.mods)) { cur.mods.push('syllabic'); cur.text += '̩'; }
        cur.phone.tone = [...(cur.phone.tone ?? []), ...TONE_DIACRITICS[ch]];
        i++;
        continue;
      }
      if (ch === HALF_LONG || IPA_DIACRITICS[ch] === 'extraShort') {
        if (ch === HALF_LONG) cur.phone.halfLong = true; else cur.phone.extraShort = true;
        i++;
        continue;
      }
      const m = IPA_DIACRITICS[ch] ?? IPA_MODIFIER_LETTERS[ch];
      if (m) {
        cur.mods.push(...(Array.isArray(m) ? m : [m]));
        cur.text += ch;
      } else note(ch, 'unknown', `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}: not an IPA diacritic`);
      i++;
      continue;
    }
    if (LENGTH.has(ch)) { const p = cur?.phone ?? last(); if (p) p.long = true; i++; continue; }
    if (ch === HALF_LONG) { const p = cur?.phone ?? last(); if (p) p.halfLong = true; i++; continue; }
    close();
    if (ch in STRESS) { stressNext = STRESS[ch]; sylNext = phones.length > 0 && !wordStart; i++; continue; }
    if (ch === SYLLABLE) { sylNext = phones.length > 0 && !wordStart; i++; continue; }
    if (ch in TONE_STEPS) { stepNext += TONE_STEPS[ch]; i++; continue; }
    if (ch in GLOBAL_PITCH) { pitchNext = GLOBAL_PITCH[ch]; i++; continue; }
    if (DELIMITERS.has(ch)) { i++; continue; }
    if (ch === LINK) { i++; continue; }
    if (/\s/.test(ch)) { const p = last(); if (p) p.wordEnd = true; wordStart = true; i++; continue; }
    if (SHORT_PAUSE.has(ch)) { const p = last(); if (p) { p.pause = 'short'; p.wordEnd = true; } wordStart = true; i++; continue; }
    if (LONG_PAUSE.has(ch)) { const p = last(); if (p) { p.pause = 'long'; p.wordEnd = true; } wordStart = true; i++; continue; }
    if (ch === '?') { const p = last(); if (p) { p.pause = 'long'; p.question = true; p.wordEnd = true; } wordStart = true; i++; continue; }
    // a superscript nasal before a consonant: prenasalized stop
    if (ch in PRENASALS && consonantAt(i + 1)) {
      push({ ipa: PRENASALS[ch], prenasal: true });
      i++;
      continue;
    }
    const b = matchBase(s, i);
    if (b) {
      const phone: Phone = { ipa: spell(b) };
      push(phone);
      cur = { phone, text: spell(b), base: spell(b), mods: [] };
      i += b.length;
      continue;
    }
    if (isMark(ch) || ch in IPA_MODIFIER_LETTERS) note(ch, 'ignored', 'a diacritic with no symbol before it');
    else note(ch, 'unknown', `not an IPA symbol`);
    i++;
  }
  close();
  if (phones.length) last().wordEnd = true;
  return { phones, notes };
}
