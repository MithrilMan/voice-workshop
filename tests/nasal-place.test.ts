import { describe, it, expect, beforeAll } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import type { Articulators } from '../src/dsp/tract/types';
import { loadEnglishLexicon } from './helpers';

// A nasal before another closure shuts the mouth where that closure is, once: the tongue does not strike for the
// nasal and again for the stop ("incontrare" said as "in-e-contrare"). Read from the targets of the score from the
// middle of the vowel before the nasal to its end (a consonant's target is set before its sound).
function aroundNasal(text: string, lang: 'it' | 'en'): { most: (k: keyof Articulators) => number; least: (k: keyof Articulators) => number } {
  const sc = buildScore(textToPhones(text, lang), { lang });
  const i = sc.phones.findIndex((p) => /^[nmŋɱ]/.test(p.ipa));
  const n = sc.phones[i], v = sc.phones[i - 1];
  const fs = sc.frames.filter((f) => f.t >= 0.5 * (v.t0 + v.t1) && f.t <= n.t1);
  return { most: (k) => Math.max(...fs.map((f) => f.art![k])), least: (k) => Math.min(...fs.map((f) => f.art![k])) };
}

beforeAll(() => loadEnglishLexicon());

describe('a nasal before a closure takes its place', () => {
  it('before a velar the dorsum shuts and the tip stays down, written n or not', () => {
    for (const text of ['/inkontrare/', 'incontrare']) {
      const a = aroundNasal(text, 'it');
      expect(a.most('tipY')).toBeLessThan(0.6);
      expect(a.most('tongueY')).toBeGreaterThan(1.2);
      expect(a.most('velum')).toBeGreaterThan(0.2);
    }
  });
  it('before a vowel the nasal keeps its own place', () => {
    expect(aroundNasal('/ina/', 'it').most('tipY')).toBeGreaterThan(1);
  });
  it('before the lips the lips shut and the tip stays down', () => {
    const a = aroundNasal('/inpjattsa/', 'it');
    expect(a.least('lipOpen')).toBeLessThan(0);
    expect(a.most('tipY')).toBeLessThan(0.6);
  });
  it('across words in Italian, inside words only in English', () => {
    expect(aroundNasal('/in kasa/', 'it').most('tipY')).toBeLessThan(0.6);
    expect(aroundNasal('in case', 'en').most('tipY')).toBeGreaterThan(1);
    expect(aroundNasal('income', 'en').most('tipY')).toBeLessThan(0.6);
  });
});
