import { describe, it, expect } from 'vitest';
import { note } from './helpers';
import { measure } from './contextBench';

/**
 * The reduction of unstressed vowels. Farnetani & Vayra (1991, ICPhS XII,
 * "Word- and phrase-level aspects of vowel reduction in Italian") had two
 * speakers say /tatata/ with the stress on each syllable in turn: the first
 * formant of an unstressed /a/ was 28 % below that of a stressed one for one
 * speaker (700 against 974 Hz) and 18 % for the other (548 against 669 Hz),
 * the tongue and the jaw higher; the unstressed /a/ that ends a word said on
 * its own opened again (654 Hz against 654, 655 against 739).
 *
 * Nothing in the plan lowers the target of an unstressed vowel: it is short
 * (77 ms against 156), and the jaw, the slowest of the organs, does not get
 * down in time between two closures of the tongue.
 */

const f1 = (text: string) => measure(text, 'it').map((t) => ({ f1: t.f[0], dur: t.dur, jaw: t.art.jaw }));

describe('unstressed vowels', () => {
  it('an /a/ between two /t/ is less open unstressed than stressed, as speakers have it', () => {
    const first = f1('tàtata'), second = f1('tatàta'), third = f1('tatatà');
    const stressed = (first[0].f1 + second[1].f1 + third[2].f1) / 3;
    // before the stress and after it, inside the word
    const before = (second[0].f1 + third[0].f1 + third[1].f1) / 3, after = first[1].f1;
    // the last of the word
    const last = (first[2].f1 + second[2].f1) / 2;
    note('unstressed /a/', `/tatata/: F1 ${stressed.toFixed(0)} Hz stressed (${(second[1].dur * 1000).toFixed(0)} ms, jaw ${second[1].jaw.toFixed(2)}); ${before.toFixed(0)} Hz before the stress (${(second[0].dur * 1000).toFixed(0)} ms, jaw ${second[0].jaw.toFixed(2)}), ${(100 * (1 - before / stressed)).toFixed(0)} % below; ${after.toFixed(0)} Hz after it, ${(100 * (1 - after / stressed)).toFixed(0)} % below; ${last.toFixed(0)} Hz at the end of the word`);
    for (const f of [before, after]) {
      expect(1 - f / stressed).toBeGreaterThan(0.12);
      expect(1 - f / stressed).toBeLessThan(0.32);
    }
    // the last vowel of a word said on its own opens again
    expect(Math.abs(1 - last / stressed)).toBeLessThan(0.1);
    // by the jaw, which is short of time
    expect(second[0].jaw).toBeLessThan(second[1].jaw - 0.3);
    expect(second[0].dur).toBeLessThan(0.6 * second[1].dur);
  });

  it('close vowels, which need no jaw, are the same stressed or not', () => {
    for (const [a, b] of [['tìtiti', 'titìti'], ['tùtutu', 'tutùtu']]) {
      const x = f1(a), y = f1(b);
      expect(Math.abs(x[1].f1 - x[0].f1)).toBeLessThan(15);
      expect(Math.abs(y[0].f1 - y[1].f1)).toBeLessThan(15);
    }
  });
});
