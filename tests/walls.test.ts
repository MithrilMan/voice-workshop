import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, EngineParams } from '../src/dsp/engine/params';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { Waveguide } from '../src/dsp/tract/waveguide';
import { AreaFunction, N_SECTIONS, sectionsFromGeometry, uniformTube } from '../src/dsp/tract/areaFunction';
import { buildNasal, portArea } from '../src/dsp/tract/nasal';
import { formants, resolveOptions, transferAt } from '../src/dsp/tract/acoustics';
import { computeGeometry } from '../src/dsp/tract/geometry';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../src/dsp/tract/types';
import { getFFT } from '../src/dsp/util/fft';
import { C_SOUND } from '../src/dsp/constants';
import { note, rmsDb, spectralCentroid } from './helpers';

const fs = 48000;
/** the quietest 10 ms of a consonant and its middle, against the loudest 10 ms of the vowel before it, dB */
const closure = (ipa: string, walls?: number) => {
  const sc = buildScore(textToPhones(`[ˈa${ipa}a]`, 'it'), { lang: 'it' });
  const p = defaultParams(); if (walls !== undefined) p.wallRadiation = walls;
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const out = new Float32Array(Math.round(sc.duration * fs)); e.process(out, out.length);
  const c = sc.phones[1], v = sc.phones[0];
  const win = (t: number) => out.subarray(Math.round(t * fs), Math.round((t + 0.01) * fs));
  let quiet = Infinity, top = -Infinity;
  for (let t = c.t0; t + 0.01 <= c.t1; t += 0.005) quiet = Math.min(quiet, rmsDb(win(t)));
  for (let t = v.t0; t + 0.01 <= v.t1; t += 0.005) top = Math.max(top, rmsDb(win(t)));
  const mid = out.subarray(Math.round((c.t0 + 0.3 * (c.t1 - c.t0)) * fs), Math.round((c.t0 + 0.7 * (c.t1 - c.t0)) * fs));
  return { quiet: quiet - top, mid };
};
const held = (v: string, edit: (p: EngineParams) => void = () => {}) => {
  const p = defaultParams(); p.phonate = true; edit(p);
  p.articulators = { ...p.articulators, ...PHONEMES[v].art };
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure();
  const out = new Float32Array(fs); e.process(out, out.length);
  return rmsDb(out.subarray(fs / 2));
};

/** the waveguide answering an impulse of flow at the glottis: what it records each sample, transformed */
function impulse(af: AreaFunction, record: (wg: Waveguide) => number): { at: (f: number) => number; fs: number; n: number } {
  const rate = (N_SECTIONS * C_SOUND) / af.length;
  const nasal = buildNasal(af.dx, 1, portArea(0, 0, 1), Math.round(0.43 * N_SECTIONS) - 1);
  const wg = new Waveguide(N_SECTIONS, nasal.areas.length, nasal.coupling);
  wg.setGeometry(af, nasal, rate, 1);
  wg.rg = 1;
  const n = 1 << 17, re = new Float64Array(n), im = new Float64Array(n), z0 = wg.z0;
  for (let i = 0; i < n; i++) { wg.glottalInjection = i === 0 ? z0 : 0; wg.step(); re[i] = record(wg); }
  getFFT(n).transform(re, im);
  return { at: (f) => { const k = Math.round((f * n) / rate); return Math.hypot(re[k], im[k]); }, fs: rate, n };
}
/** the highest point of a curve between two frequencies, and its width at half power */
function peakOf(z: (f: number) => number, from: number, to: number, step = 0.5): { f: number; bw: number; top: number } {
  let top = 0, f = 0;
  for (let x = from; x < to; x += step) { const v = z(x); if (v > top) { top = v; f = x; } }
  let lo = f, hi = f;
  while (lo > 1 && z(lo) > top / Math.SQRT2) lo -= step;
  while (z(hi) > top / Math.SQRT2) hi += step;
  return { f, bw: hi - lo, top };
}

describe('the walls and the losses of the tract against measurements', () => {
  it('a tract shut at both ends resonates on its walls where it was measured, as wide and as high', () => {
    // Hanna, Smith & Wolfe (2016) measured the tract through sealed lips with the
    // glottis closed: below the first resonance of the air its impedance has a peak
    // where the air's springiness meets the mass of the walls, at 210 ± 55 Hz in
    // seven men, 105 ± 30 Hz wide and 3.9 ± 1.0 MPa s/m³ high. Their own tube for
    // it is 17 cm long and 1 cm in radius.
    const af = uniformTube(17, Math.PI);
    af.areas[af.areas.length - 1] = 1e-5; af.areas[af.areas.length - 2] = 1e-5;
    const o = resolveOptions(af, { piriform: false });
    const prof = { p: new Float64Array(af.areas.length + 1), u: new Float64Array(af.areas.length + 1) };
    const ref = peakOf((f) => { transferAt(af, f, o, prof); return Math.abs(prof.p[0] / prof.u[0]); }, 60, 500);
    const wg = impulse(af, (w) => w.oral.f[0] + w.oral.b[0]);
    const kl = peakOf(wg.at, 60, 500, wg.fs / wg.n);
    // (dyn s/cm⁵ to MPa s/m³: a tenth)
    note('closed tract', `a tube 17 cm long and 1 cm in radius, shut at both ends: frequency model ${ref.f.toFixed(0)} Hz, ${ref.bw.toFixed(0)} Hz wide, ${(ref.top / 10).toFixed(1)} MPa s/m³; waveguide ${kl.f.toFixed(0)} Hz, ${kl.bw.toFixed(0)} Hz wide, ${(kl.top / 10).toFixed(1)} MPa s/m³ (measured on men 210 ± 55 Hz, 105 ± 30 Hz, 3.9 ± 1.0 MPa s/m³)`);
    for (const m of [ref, kl]) {
      expect(Math.abs(m.f - 210)).toBeLessThan(55);
      expect(Math.abs(m.bw - 105)).toBeLessThan(30);
      expect(Math.abs(m.top / 10 - 3.9)).toBeLessThan(1.0);
    }
  });

  it('the first resonance of a close vowel is not much wider than measured; the waveguide loses the same at every frequency', () => {
    const widths = (af: AreaFunction) => {
      const w = impulse(af, (x) => x.lipFlow + x.nosFlow), ref = formants(af, {}, 4000);
      return ref.slice(0, 3).map((r) => ({ f: r.f, ref: r.bw, kl: peakOf(w.at, r.f - 60, r.f + 60, w.fs / w.n).bw }));
    };
    const shape = (v: string) => sectionsFromGeometry(computeGeometry({ ...DEFAULT_ARTICULATORS, ...PHONEMES[v].art }, DEFAULT_ANATOMY, DEFAULT_TEETH));
    const tube = widths(uniformTube(17.5, 3)), u = widths(shape('u')), i = widths(shape('i'));
    const row = (x: { f: number; ref: number; kl: number }[]) => x.map((q) => `${q.f.toFixed(0)} Hz: ${q.kl.toFixed(0)} Hz wide (frequency model ${q.ref.toFixed(0)})`).join(', ');
    note('bandwidths, glottis closed', `waveguide, with the radiation: uniform tube ${row(tube)}; /u/ ${row(u.slice(0, 2))}; /i/ ${row(i.slice(0, 1))}`);
    // about 70 Hz was measured on close vowels with the glottis closed (Fujimura & Lindqvist 1971)
    expect(u[0].ref).toBeLessThan(85);
    expect(i[0].ref).toBeLessThan(85);
    expect(u[0].kl).toBeLessThan(115);
    expect(i[0].kl).toBeLessThan(100);
    // the uniform tube: tens of Hz, and not narrower at 2.4 kHz than at 500 Hz
    for (const q of tube) { expect(q.kl).toBeGreaterThan(35); expect(q.kl).toBeLessThan(110); }
    expect(tube[2].kl).toBeGreaterThan(tube[0].kl);
  });
});

describe('the walls are heard through the skin', () => {
  it('a voiced closure hums low through the walls; a voiceless one stays silent', () => {
    const b = closure('b'), d = closure('d'), g = closure('g'), p = closure('p'), mute = closure('b', 0);
    const bar = [b, d, g].map((x) => x.quiet);
    const hum = spectralCentroid(b.mid, fs, 50, 8000, 512);
    note('voice bar', `quietest 10 ms of the closure against the vowel: /b/ ${b.quiet.toFixed(0)}, /d/ ${d.quiet.toFixed(0)}, /g/ ${g.quiet.toFixed(0)} dB (/b/ ${mute.quiet.toFixed(0)} dB with the walls unheard), /p/ ${p.quiet.toFixed(0)} dB; the hum of /b/ centred at ${hum.toFixed(0)} Hz`);
    for (const q of bar) { expect(q).toBeGreaterThan(-32); expect(q).toBeLessThan(-15); }
    expect(mute.quiet).toBeLessThan(-60);
    expect(p.quiet).toBeLessThan(-50);
    // a low hum: the walls carry the voice's lowest harmonics
    expect(hum).toBeLessThan(600);
  });

  it('a held close vowel is no longer far below an open one, and a nasal keeps its level', () => {
    const a = held('a'), u = held('u'), i = held('i'), m = held('m');
    const u0 = held('u', (p) => { p.wallRadiation = 0; }) - held('a', (p) => { p.wallRadiation = 0; });
    note('vowel levels', `held, against /a/: /i/ ${(i - a).toFixed(1)} dB, /u/ ${(u - a).toFixed(1)} dB (${u0.toFixed(1)} with the walls unheard), /m/ ${(m - a).toFixed(1)} dB`);
    expect(u - a).toBeGreaterThan(-10);
    expect(u - a).toBeGreaterThan(u0 + 2);
    expect(i - a).toBeGreaterThan(-5);
    // a held /m/ stays 7-9 dB below /a/ (Fletcher 1953)
    expect(m - a).toBeLessThan(-6.5);
    expect(m - a).toBeGreaterThan(-9.5);
  });
});
