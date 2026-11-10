import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore, ScoreOptions } from '../src/dsp/speech/sequencer';
import { Score } from '../src/dsp/engine/params';
import { renderOffline } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { Wander } from '../src/dsp/util/wander';
import { note } from './helpers';

const TEXT = 'ieri sera, sulla spiaggia, abbiamo guardato la luna piena salire sopra il mare.';
const say = (o: ScoreOptions = {}) => buildScore(textToPhones(TEXT, 'it'), { lang: 'it', ...o });
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
/** the highest pitch inside each stressed-looking vowel (the vowels of the plain saying, by order), semitones over the usual pitch */
const peaks = (sc: Score, f0: number) => sc.phones.filter((p) => /[aeiou]/.test(p.ipa)).map((p) => {
  let m = 0;
  for (const f of sc.frames) if (f.t >= p.t0 && f.t < p.t1) m = Math.max(m, f.f0);
  return 12 * Math.log2(m / f0);
});

describe('a living voice', () => {
  it('without a seed, or with no variation, says it by the rules alone', () => {
    const plain = JSON.stringify(say());
    expect(JSON.stringify(say({ seed: 7, style: { variation: 0 } }))).toBe(plain);
    expect(say().seed).toBeUndefined();
  });

  it('says it the same way for one seed, another way for another', () => {
    expect(JSON.stringify(say({ seed: 3 }))).toBe(JSON.stringify(say({ seed: 3 })));
    const a = say({ seed: 3 }), b = say({ seed: 4 });
    expect(a.duration).not.toBe(b.duration);
    expect(a.seed).toBe(3);
    expect(a.variation).toBe(1);
    // the same sounds, in the same order
    expect(a.phones.map((p) => p.ipa)).toEqual(say().phones.map((p) => p.ipa));
  });

  it('varies the syllables, the pauses and the accents by about as much as it says', () => {
    const plain = say();
    const lens = (sc: Score) => sc.phones.map((p) => p.t1 - p.t0);
    const p0 = lens(plain), k0 = peaks(plain, 120);
    const total: number[] = [];
    const spread = (variation: number) => {
      const ls: number[] = [], ac: number[] = [];
      for (let s = 1; s <= 30; s++) {
        const sc = say({ seed: s, style: { variation } });
        lens(sc).forEach((d, i) => { if (p0[i] > 0.04) ls.push(Math.log(d / p0[i])); });
        peaks(sc, 120).forEach((k, i) => { if (k0[i] > 1) ac.push(k - k0[i]); });
        if (variation === 1) total.push(sc.duration / plain.duration);
      }
      return { len: sd(ls), acc: sd(ac) };
    };
    const one = spread(1), two = spread(2);
    note('living variation', `"${TEXT}" over 30 seeds: sounds longer or shorter by ${(100 * one.len).toFixed(1)} % (sd), accent peaks moved by ${one.acc.toFixed(2)} st (sd), the whole ${(100 * Math.min(...total)).toFixed(0)}-${(100 * Math.max(...total)).toFixed(0)} % of the plain saying; at variation 2: ${(100 * two.len).toFixed(1)} %, ${two.acc.toFixed(2)} st`);
    // the syllables about 8 % (the sounds of a syllable move together; closures and releases keep their timing rules)
    expect(one.len).toBeGreaterThan(0.04);
    expect(one.len).toBeLessThan(0.13);
    // the accents by some tenths of a semitone to a semitone
    expect(one.acc).toBeGreaterThan(0.2);
    expect(one.acc).toBeLessThan(1.5);
    // twice the variation, about twice the spread
    expect(two.len / one.len).toBeGreaterThan(1.5);
    expect(two.acc / one.acc).toBeGreaterThan(1.4);
    // the whole sentence stays within a sixth of its length
    expect(Math.max(...total.map((x) => Math.abs(Math.log(x))))).toBeLessThan(Math.log(1.17));
  });

  it('wanders slowly, with a unit spread, from the start', () => {
    const dt = 32 / 24000;
    const w = new Wander(5, [0.7, 2, 5]), v = new Wander(6, [0.7, 2, 5]);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 60 / dt; i++) { xs.push(w.step(dt)); ys.push(v.step(dt)); }
    expect(sd(xs)).toBeGreaterThan(0.85);
    expect(sd(xs)).toBeLessThan(1.15);
    // the first second already wanders as much as the rest
    expect(sd(xs.slice(0, Math.round(1 / dt)))).toBeGreaterThan(0.4);
    // slow: one control step to the next hardly moves it
    let d = 0;
    for (let i = 1; i < xs.length; i++) d += (xs[i] - xs[i - 1]) ** 2;
    expect(Math.sqrt(d / xs.length)).toBeLessThan(0.15);
    // another seed, another wander
    expect(Math.abs(xs[1000] - ys[1000]) + Math.abs(xs[5000] - ys[5000])).toBeGreaterThan(0);
  });

  it('sounds the same for one seed and differently for another', () => {
    const p = defaultParams();
    const short = (seed: number) => buildScore(textToPhones('la luna', 'it'), { lang: 'it', seed });
    const render = (seed: number) => { const sc = short(seed); return renderOffline(p, sc.duration + 0.2, 16000, sc).out; };
    const a = render(11), b = render(11), c = render(12);
    expect(Array.from(a.subarray(2000, 2400))).toEqual(Array.from(b.subarray(2000, 2400)));
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, c.length); i++) diff += Math.abs(a[i] - c[i]);
    expect(diff).toBeGreaterThan(0);
  });
});
