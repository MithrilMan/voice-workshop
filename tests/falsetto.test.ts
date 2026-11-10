import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, SourceModel } from '../src/dsp/engine/params';
import { sanitizeVoice, VOICE_V1_BASE, cloneVoice, applyDesign } from '../src/dsp/voice/design';
import { note } from './helpers';

const fs = 48000;
/** level of the harmonic at f of a signal, dB */
const harmonic = (x: Float64Array, f: number) => {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { const w = (2 * Math.PI * f * i) / fs; re += x[i] * Math.cos(w); im += x[i] * Math.sin(w); }
  return 20 * Math.log10(Math.hypot(re, im) / x.length + 1e-12);
};
/** the derivative of the glottal flow of a held voice at 300 Hz: its first harmonics, its slope and its level */
const source = (model: SourceModel, thickness: number) => {
  const p = defaultParams(); p.phonate = true; p.source.model = model; p.source.f0 = 300; p.source.thickness = thickness;
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure();
  const tel = e as unknown as { glottalFlow: number; measuredF0: number };
  const n = Math.round(0.6 * fs), flow = new Float64Array(n), one = new Float32Array(1);
  let level = 0;
  for (let i = 0; i < n; i++) { e.process(one, 1); flow[i] = tel.glottalFlow; if (i >= n / 2) level += one[0] * one[0]; }
  // (the pitch the engine reports is good to half a percent: the harmonics are measured where the fundamental really is)
  let f0 = model === 'lf' ? 300 : tel.measuredF0;
  const fl = flow.subarray(n / 2), d = new Float64Array(fl.length);
  for (let i = 1; i < fl.length; i++) d[i] = (fl[i] - fl[i - 1]) * fs;
  if (model !== 'lf') { let top = -Infinity; for (let f = f0 - 8, g = f; g <= f + 16; g += 0.25) { const h = harmonic(d, g); if (h > top) { top = h; f0 = g; } } }
  const h1 = harmonic(d, f0);
  return { f0, h1h2: h1 - harmonic(d, 2 * f0), slope: h1 - harmonic(d, Math.round(3000 / f0) * f0), level: 10 * Math.log10(level / (n / 2)) };
};

describe('falsetto: thin folds', () => {
  it('thin folds in the LF source: the fundamental dominates, the harmonics fall faster, the voice is weaker', () => {
    const chest = source('lf', 1), thin = source('lf', 0.3);
    note('falsetto (LF)', `300 Hz, chest → falsetto: H1-H2 ${chest.h1h2.toFixed(1)} → ${thin.h1h2.toFixed(1)} dB, H1 over the harmonic near 3 kHz ${chest.slope.toFixed(1)} → ${thin.slope.toFixed(1)} dB, level ${(thin.level - chest.level).toFixed(1)} dB`);
    // a chest voice a few dB, falsetto much more: a nearly sinusoidal pulse
    expect(chest.h1h2).toBeLessThan(6);
    expect(thin.h1h2).toBeGreaterThan(10);
    expect(thin.slope).toBeGreaterThan(chest.slope + 8);
    expect(thin.level).toBeLessThan(chest.level - 3);
  });

  it('thin folds in the two-mass model still vibrate by themselves, with a softer pulse', () => {
    const chest = source('twomass', 1), thin = source('twomass', 0.3);
    note('falsetto (two-mass)', `300 Hz target, chest → falsetto: F0 ${chest.f0.toFixed(0)} → ${thin.f0.toFixed(0)} Hz, H1-H2 ${chest.h1h2.toFixed(1)} → ${thin.h1h2.toFixed(1)} dB, slope ${chest.slope.toFixed(1)} → ${thin.slope.toFixed(1)} dB`);
    expect(Math.abs(thin.f0 - 300)).toBeLessThan(10);
    expect(thin.h1h2).toBeGreaterThan(chest.h1h2 + 2);
    expect(thin.slope).toBeGreaterThan(chest.slope + 5);
  });

  it('a voice without the field (an older link) keeps chest folds; a falsetto voice brings them to the hands', () => {
    const old = cloneVoice() as unknown as { phonation: Record<string, unknown> };
    delete old.phonation.thickness;
    expect(sanitizeVoice(old)!.phonation.thickness).toBe(1);
    expect(VOICE_V1_BASE.phonation.thickness).toBe(1);
    const d = cloneVoice(); d.phonation.thickness = 0.35;
    const p = defaultParams(); applyDesign(p, d);
    expect(p.source.thickness).toBe(0.35);
  });
});
