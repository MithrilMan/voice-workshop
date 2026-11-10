import { describe, it, expect, beforeAll } from 'vitest';
import { buildScore } from '../src/dsp/speech/sequencer';
import { textToPhones } from '../src/dsp/speech/g2p';
import { note, loadEnglishLexicon } from './helpers';

/**
 * The speaking rate. A faster voice does not shorten every sound alike: said
 * fast instead of slowly, the vowels of /pVp/ syllables lose 25 % of their
 * duration and the consonants 10 % (Gay 1978); a stressed vowel 26 % and the
 * stop after it 20 % (Port 1981); in Arabic the vowels lose 25 % said fast
 * and gain 50 % said slowly, the consonants 12 % either way (Port et al.
 * 1980). All three as reviewed by Katsuda & Kang (2026, J. Phonetics 115).
 */

const VOWELS = 'aeiouɛɔəɪʊæɑʌɒɜ';
const STOPS = 'ptkbdg';

function timed(text: string, lang: 'it' | 'en', rate: number) {
  const s = buildScore(textToPhones(text, lang), { lang, rate });
  let vowels = 0, stops = 0, others = 0;
  for (const q of s.phones) {
    const d = q.t1 - q.t0;
    if (VOWELS.includes(q.ipa[0])) vowels += d; else if (STOPS.includes(q.ipa[0])) stops += d; else others += d;
  }
  return { vowels, stops, others, all: s.phones[s.phones.length - 1].t1 - s.phones[0].t0, each: s.phones.map((q) => q.t1 - q.t0) };
}

describe('the speaking rate', () => {
  beforeAll(() => { loadEnglishLexicon(); });

  it('the whole lasts as long as the rate says', () => {
    for (const [text, lang] of [['la patata dipinta copia la cupola', 'it'], ['the captain took a deep cup of coffee', 'en']] as const) {
      const usual = timed(text, lang, 1);
      for (const rate of [0.6, 0.8, 1.25, 1.5, 2, 2.5]) {
        const got = timed(text, lang, rate);
        // (the breath of an English voiceless stop shortens with the root of the rate)
        expect(got.all * rate / usual.all).toBeGreaterThan(lang === 'it' ? 0.99 : 0.95);
        expect(got.all * rate / usual.all).toBeLessThan(lang === 'it' ? 1.01 : 1.15);
        for (const d of got.each) expect(d).toBeGreaterThan(0.008);
      }
    }
  });

  it('vowels give more than stops, said fast or slowly', () => {
    const rows: string[] = [];
    for (const [text, lang] of [['la patata dipinta copia la cupola', 'it'], ['the captain took a deep cup of coffee', 'en']] as const) {
      const slow = timed(text, lang, 0.9), usual = timed(text, lang, 1), fast = timed(text, lang, 1.15);
      const v = fast.vowels / slow.vowels, c = fast.stops / slow.stops;
      rows.push(`${lang}: fast (1.15) against slow (0.9), vowels ${v.toFixed(2)} and stops ${c.toFixed(2)} of their duration; slow against usual, vowels +${(100 * (slow.vowels / usual.vowels - 1)).toFixed(0)} % and stops +${(100 * (slow.stops / usual.stops - 1)).toFixed(0)} %`);
      // speakers: 0.75 and 0.9 (Gay 1978), 0.74 and 0.8 (Port 1981)
      expect(v).toBeGreaterThan(0.6);
      expect(v).toBeLessThan(0.8);
      expect(c).toBeGreaterThan(v + 0.06);
      expect(c).toBeLessThan(0.95);
      expect(slow.vowels / usual.vowels).toBeGreaterThan(slow.stops / usual.stops + 0.02);
    }
    note('speaking rate', rows.join('; '));
  });

  it('past the least a sound can last, everything is shortened together', () => {
    const a = timed('la patata dipinta copia la cupola', 'it', 2), b = timed('la patata dipinta copia la cupola', 'it', 2.5);
    expect(b.vowels / a.vowels).toBeCloseTo(0.8, 2);
    expect(b.stops / a.stops).toBeCloseTo(0.8, 2);
  });
});
