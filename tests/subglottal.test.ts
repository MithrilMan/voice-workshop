import { describe, it, expect } from 'vitest';
import { formants, resolveOptions, transferAt } from '../src/dsp/tract/acoustics';
import { subglottalAirways, subglottalAreaFunction, subglottalModes, SubglottalTract } from '../src/dsp/tract/subglottal';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { DEFAULT_ARTICULATORS } from '../src/dsp/tract/types';
import { getFFT, welch } from '../src/dsp/util/fft';
import { note } from './helpers';

/**
 * Below the glottis: the trachea and the bronchi, a tube with resonances of
 * its own, heard whenever the glottis is open.
 *
 * Measured through the skin of the neck of 25 young men, the first three are
 * at 554 ± 42, 1327 ± 77 and 2179 ± 126 Hz; of 25 young women, at 660 ± 47,
 * 1513 ± 69 and 2426 ± 101 Hz (Lulich et al. 2012).
 */
const MEN: [number, number][] = [[554, 42], [1327, 77], [2179, 126]];
const WOMEN: [number, number][] = [[660, 47], [1513, 69], [2426, 101]];

const fs = 48000;
function held(abduction: number, sub: boolean, model: 'lf' | 'twomass' = 'lf'): Float64Array {
  const p = defaultParams();
  p.articulators = { ...DEFAULT_ARTICULATORS, ...PHONEMES.a.art };
  p.abduction = abduction; p.phonate = true; p.subglottal = sub;
  p.source.model = model;
  p.source.jitter = 0; p.source.shimmer = 0;
  const e = new VoiceEngine(fs, p);
  e.snapArticulators(); e.snapPressure();
  const out = new Float32Array(fs * 2);
  e.process(out, out.length);
  return welch(out.subarray(fs / 2), 4096);
}
/** power in [f0, f1) of one spectrum against another, dB */
function band(on: Float64Array, off: Float64Array, f0: number, f1: number): number {
  let a = 0, b = 0;
  for (let k = Math.round((f0 * 4096) / fs); k < Math.round((f1 * 4096) / fs); k++) { a += on[k]; b += off[k]; }
  return 10 * Math.log10(a / b);
}

describe('the airways below the glottis', () => {
  it('the trachea and three generations of bronchi resonate where they were measured', () => {
    const tube = subglottalAirways();
    const length = tube.reduce((s, a) => s + a.length, 0);
    const af = subglottalAreaFunction(0.2);
    const sg = formants(af, { piriform: false }, 4000, 10);
    const rigid = formants({ ...af, soft: new Float64Array(af.areas.length) }, { piriform: false }, 4000, 10);
    note('subglottal resonances', `a tube of ${length.toFixed(1)} cm (trachea ${tube[0].area.toFixed(2)} cm², then ${tube.slice(1).map((a) => `${a.tubes} bronchi ${a.area.toFixed(2)} cm² over ${a.length.toFixed(1)} cm`).join(', ')}): ${sg.slice(0, 3).map((m) => `${m.f.toFixed(0)} Hz (B ${m.bw.toFixed(0)})`).join(', ')} (measured on men 554 ± 42, 1327 ± 77, 2179 ± 126 Hz); with rigid walls the first at ${rigid[0].f.toFixed(0)} Hz`);
    expect(length).toBeGreaterThan(19);
    expect(length).toBeLessThan(20.5);
    // each within one standard deviation of the men measured
    for (let k = 0; k < 3; k++) expect(Math.abs(sg[k].f - MEN[k][0])).toBeLessThan(MEN[k][1]);
    // the yielding walls lift the first resonance, as they lift the first formant of a closed mouth
    expect(sg[0].f - rigid[0].f).toBeGreaterThan(30);
    // a woman's size (the airways 0.87 times as long): hers too, within two
    const woman = subglottalModes(0.87);
    note('subglottal resonances of a smaller speaker', `0.87 times the size: ${woman.slice(0, 3).map((m) => m.f.toFixed(0)).join(', ')} Hz (measured on women 660 ± 47, 1513 ± 69, 2426 ± 101 Hz)`);
    for (let k = 0; k < 3; k++) expect(Math.abs(woman[k].f - WOMEN[k][0])).toBeLessThan(2 * WOMEN[k][1]);
  });

  it('the resonances the engine keeps have the impedance of the tube', () => {
    const af = subglottalAreaFunction(0.2);
    const o = resolveOptions(af, { piriform: false });
    const prof = { p: new Float64Array(af.areas.length + 1), u: new Float64Array(af.areas.length + 1) };
    const tubeZ = (f: number) => { transferAt(af, f, o, prof); return prof.p[0] / prof.u[0]; };
    // the pressure under the folds for a unit of flow pushed down into the airways, at the rate of the tract
    const rate = 88000, n = 1 << 16;
    const sub = new SubglottalTract();
    sub.configure(rate, 1);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = i === 0 ? -1 : 0;
      re[i] = 2 * sub.up - sub.z * u;
      sub.step(sub.up - sub.z * u);
    }
    getFFT(n).transform(re, im);
    const kept = (f: number) => { const k = Math.round((f * n) / rate); return Math.hypot(re[k], im[k]); };
    const modes = subglottalModes();
    const rows: string[] = [];
    for (const m of modes.slice(0, 3)) {
      // at the peak, and half a width to either side
      for (const f of [m.f - m.bw / 2, m.f, m.f + m.bw / 2]) {
        const d = 20 * Math.log10(kept(f) / tubeZ(f));
        expect(Math.abs(d)).toBeLessThan(1.5);
        if (f === m.f) rows.push(`${m.f.toFixed(0)} Hz: ${tubeZ(f).toFixed(0)} dyn s/cm⁵, kept ${d >= 0 ? '+' : ''}${d.toFixed(1)} dB`);
      }
    }
    note('subglottal impedance', `the tube at its closed end against the resonances the engine keeps: ${rows.join('; ')}`);
  });

  it('an open glottis lets them into the voice; a closed one does not', () => {
    const peaks = subglottalModes().slice(0, 3).map((m) => m.f);
    // the harmonic of a 120 Hz voice nearest to each resonance
    const near = peaks.map((f) => 120 * Math.round(f / 120));
    const dips = (abduction: number, model: 'lf' | 'twomass' = 'lf') => {
      const on = held(abduction, true, model), off = held(abduction, false, model);
      return { at: near.map((f) => band(on, off, f - 50, f + 50)), away: [band(on, off, 750, 1050), band(on, off, 1550, 1850)], all: band(on, off, 60, 5000) };
    };
    const modal = dips(0), breathy = dips(0.35);
    note('subglottal resonances in the voice', `held /a/, the harmonics at ${near.join(', ')} Hz with the airways below against without: breathy (folds apart) ${breathy.at.map((d) => d.toFixed(1)).join(', ')} dB, away from them ${breathy.away.map((d) => d.toFixed(1)).join(', ')} dB; modal ${modal.at.map((d) => d.toFixed(1)).join(', ')} dB; the level changes by ${breathy.all.toFixed(1)} and ${modal.all.toFixed(1)} dB`);
    // folds apart: a dip at each resonance, where the tube below stops the flow that the glottis would let through
    for (const d of breathy.at) expect(d).toBeLessThan(-2);
    for (const d of breathy.away) expect(Math.abs(d)).toBeLessThan(1);
    // folds together: less of it (the glottis is shut for much of each period)
    for (let k = 0; k < 3; k++) expect(Math.abs(modal.at[k])).toBeLessThan(Math.abs(breathy.at[k]));
    expect(Math.abs(modal.all)).toBeLessThan(0.5);
    expect(Math.abs(breathy.all)).toBeLessThan(0.5);
  });

  it('the two-mass folds feel the tube below and go on vibrating', () => {
    const on = held(0, true, 'twomass'), off = held(0, false, 'twomass');
    const level = band(on, off, 60, 5000);
    note('subglottal tract, two-mass folds', `held /a/ with the airways below against without: ${level.toFixed(1)} dB`);
    expect(Math.abs(level)).toBeLessThan(2);
  });
});
