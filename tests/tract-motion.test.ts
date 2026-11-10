import { describe, it, expect } from 'vitest';
import { Waveguide } from '../src/dsp/tract/waveguide';
import { uniformTube, AreaFunction, N_SECTIONS } from '../src/dsp/tract/areaFunction';
import { buildNasal, portArea } from '../src/dsp/tract/nasal';
import { C_SOUND, AREA_CLOSED } from '../src/dsp/constants';
import { note } from './helpers';

/**
 * The shape of the tube is measured every few milliseconds, and the tube
 * moves from measure to measure in between. How it moves is heard: a shape
 * that runs to each measure and waits there for the next changes its speed
 * at once three hundred times a second, and on the steady flow of speech
 * every change of speed is a small step of pressure. The sections follow the
 * smooth curve of the measures instead.
 */

/** samples between two measures (about 3.3 ms at the rate of the tube) */
const N = 300;

function tube(): { wg: Waveguide; af: AreaFunction; set: (area: number) => void; fs: number } {
  const af = uniformTube(17.5, 3);
  const fs = (N_SECTIONS * C_SOUND) / af.length;
  const nasal = buildNasal(af.dx, 1, portArea(0, 0, 1), Math.round(0.43 * N_SECTIONS) - 1);
  const wg = new Waveguide(N_SECTIONS, nasal.areas.length, nasal.coupling);
  wg.setGeometry(af, nasal, fs, 1);
  /** a new measure: section 20 as wide as asked, the rest as it was */
  const set = (area: number) => {
    const a = { ...af, areas: Float64Array.from(af.areas) };
    a.areas[20] = area;
    wg.setGeometry(a, nasal, fs, N);
  };
  return { wg, af, set, fs };
}

describe('the tube between two measures of its shape', () => {
  it('a section follows its measures without a jump of speed, and lands on a closure at rest', () => {
    const { wg, set } = tube();
    const measures = [2, 0.5, 0, 0, 0];
    const track: number[] = [3];
    for (const g of measures) {
      set(g);
      for (let i = 0; i < N; i++) { wg.step(); track.push(wg.oral.area[20]); }
    }
    // the speed changes from sample to sample by no more than the measures bend
    let bend = 0;
    for (let i = 1; i + 1 < track.length; i++) bend = Math.max(bend, Math.abs(track[i + 1] - 2 * track[i] + track[i - 1]));
    const g = [3, 3, ...measures];
    let most = 0;
    for (let k = 1; k + 1 < g.length; k++) most = Math.max(most, Math.abs(g[k + 1] - 2 * g[k] + g[k - 1]));
    // (a section that ran to each measure and stopped would change its speed by the whole step, N times as much)
    expect(bend).toBeLessThan((1.05 * most) / (N * N) + 1e-9);
    // half way between two measures when the second one comes
    expect(track[N]).toBeCloseTo(2.5, 6);
    expect(track[2 * N]).toBeCloseTo(1.25, 6);
    // on the closure one stretch after the closure was measured, with no speed left
    expect(track[4 * N]).toBeCloseTo(AREA_CLOSED, 9);
    expect(Math.abs(track[4 * N] - track[4 * N - 1])).toBeLessThan(1 / (N * N));
    expect(track[5 * N]).toBe(track[4 * N]);
    note('motion of the tube', `from one sample to the next the speed of a section changes ${Math.round(1.5 / N / bend)} times less than if it ran to each measure and stopped there`);
  });

  it('the same measure again brings the section to it, and there it rests', () => {
    const { wg, set } = tube();
    set(1);
    for (let i = 0; i < N; i++) wg.step();
    expect(wg.oral.area[20]).toBeCloseTo(2, 6);
    set(1);
    for (let i = 0; i < N; i++) wg.step();
    expect(wg.oral.area[20]).toBeCloseTo(1, 9);
    const there = wg.oral.area[20];
    for (let i = 0; i < 3 * N; i++) wg.step();
    expect(wg.oral.area[20]).toBe(there);
  });

  it('a steady flow through a moving narrowing carries no ticks', () => {
    const { wg, set } = tube();
    wg.rg = 0.9;
    wg.glottalInjection = 100;
    for (let i = 0; i < 40000; i++) wg.step();
    const flow: number[] = [];
    // a narrowing that comes and goes in 20 ms, as a tongue tap does
    for (const g of [1.5, 0.6, 0.3, 0.6, 1.5, 3, 3, 3]) {
      set(g);
      for (let i = 0; i < N; i++) { wg.step(); flow.push(wg.lipFlow); }
    }
    // the sharpest sample of the flow at the lips against the change the gesture itself makes
    let sharp = 0, lo = Infinity, hi = -Infinity;
    for (let i = 1; i + 1 < flow.length; i++) sharp = Math.max(sharp, Math.abs(flow[i + 1] - 2 * flow[i] + flow[i - 1]));
    for (const v of flow) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const ratio = sharp / (hi - lo);
    note('steady flow through a moving narrowing', `the sharpest sample of the flow at the lips is ${(20 * Math.log10(ratio)).toFixed(0)} dB below the swing the gesture makes`);
    expect(ratio).toBeLessThan(0.01);
  });
});
