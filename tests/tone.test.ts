import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { renderOffline } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { yin } from '../src/dsp/analysis/pitch';
import { note } from './helpers';

const fs = 48000;
const st = (f: number, ref: number) => 12 * Math.log2(f / ref);

/** F0 of the vowels of a transcription, planned and heard, at five points of each vowel (semitones from the base) */
function tones(text: string, base = 120) {
  const score = buildScore(textToPhones(text, 'it'), { f0: base });
  const { out } = renderOffline(defaultParams(), score.duration + 0.2, fs, score);
  const vowels = score.phones.filter((p) => p.ipa === 'a');
  const at = [0.15, 0.3, 0.5, 0.7, 0.85];
  const plan = vowels.map((p) => at.map((u) => st(score.frames[Math.round((p.t0 + u * (p.t1 - p.t0)) / 0.005)].f0, base)));
  // a short window, as the pitch moves fast; a frame where YIN finds no period is left out
  const heard = vowels.map((p) => at.map((u) => {
    const c = Math.round((p.t0 + u * (p.t1 - p.t0)) * fs);
    const f = yin(out.subarray(c - 768, c + 768), fs, 70, 400).f0;
    return f > 0 ? st(f, base) : NaN;
  }));
  return { plan, heard };
}

describe('lexical tones', () => {
  it('says the four tones of Mandarin with their shapes, and the voice follows them', () => {
    const { plan, heard } = tones('[ma˥ ma˧˥ ma˨˩˦ ma˥˩]');
    const show = (x: number[][]) => x.map((v) => v.map((s) => s.toFixed(1)).join(' ')).join(' | ');
    note('Mandarin tones', `planned ${show(plan)} st; heard ${show(heard)} st (high level, rising, dipping, falling)`);
    // the voice lags the plan by its own smoothing (about 20 ms), so it moves a little less within a vowel
    for (const [t, k] of [[plan, 1], [heard, 0.7]] as const) {
      const [t1, t2, t3, t4] = t.map((v) => v.filter(Number.isFinite));
      expect(t.every((v) => v.filter(Number.isFinite).length >= 4)).toBe(true);
      // high and level
      expect(Math.max(...t1) - Math.min(...t1)).toBeLessThan(1.5);
      expect(t1[2]).toBeGreaterThan(Math.max(...t2) - 0.5);
      // rising
      expect(t2[t2.length - 1] - t2[0]).toBeGreaterThan(2.2 * k);
      // low, dipping, rising at the end
      expect(Math.min(...t3)).toBeLessThan(Math.min(...t1, ...t2) - 3 * k);
      expect(t3[t3.length - 1]).toBeGreaterThan(Math.min(...t3) + 2 * k);
      // falling from high to low
      expect(t4[0] - t4[t4.length - 1]).toBeGreaterThan(6 * k);
    }
  });

  it('a downstep lowers the register for the tones after it', () => {
    const { plan } = tones('[á ꜜá á]');
    note('downstep', `high tones ${plan.map((v) => v[2].toFixed(1)).join(', ')} st`);
    expect(plan[0][2] - plan[1][2]).toBeGreaterThan(1.2);
  });

  it('keeps the tones when the intonation is switched off: they are part of the words', () => {
    const score = buildScore(textToPhones('[ma˥ ma˩]', 'it'), { f0: 120, natural: { intonation: false } });
    const [a, b] = score.phones.filter((p) => p.ipa === 'a').map((p) => score.frames[Math.round((0.5 * (p.t0 + p.t1)) / 0.005)].f0);
    expect(st(a, b)).toBeGreaterThan(8);
  });
});
