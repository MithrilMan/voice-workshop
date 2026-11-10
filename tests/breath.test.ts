import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { Aero, AIRWAY_RES, rootThroughZero } from '../src/dsp/aero/aero';
import { CMH2O, RHO } from '../src/dsp/constants';
import { textToPhones } from '../src/dsp/speech/g2p';
import { DEFAULT_STYLE } from '../src/dsp/speech/style';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { note, bandPower } from './helpers';

/**
 * The breath taken in a pause. At a full stop the lungs are refilled: they
 * pull instead of pushing, the folds part wide, and the air is heard going
 * in, a soft hiss between one sentence and the next.
 */

const fs = 48000;
const db = (x: number) => 10 * Math.log10(x + 1e-20);

function said(text: string, style: Partial<typeof DEFAULT_STYLE> = {}) {
  const voice = builtinVoice('man')!.design;
  const u = utterance(voice, textToPhones(text, 'it'), 'it', { style: { ...voice.speaking.style, ...style } });
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.playScore(u.score);
  const n = Math.round((u.score.duration + 0.2) * fs), out = new Float32Array(n);
  const flow = new Float32Array(Math.floor(n / 48)), lungs = new Float32Array(flow.length);
  for (let i = 0; i + 48 <= n; i += 48) {
    e.process(out.subarray(i, i + 48), 48);
    flow[i / 48] = (e as unknown as { glottalFlow: number }).glottalFlow;
    lungs[i / 48] = e.telemetry().ps / CMH2O;
  }
  const pause = u.score.phones.find((q) => q.ipa === '_');
  const seg = (a: number, b: number) => out.subarray(Math.round(a * fs), Math.round(b * fs));
  /** the level of each millisecond between two times, dB */
  const ms = (a: number, b: number) => { const r: number[] = []; for (let t = Math.round(a * 1000); t < Math.round(b * 1000); t++) { let s = 0; for (let k = t * 48; k < t * 48 + 48; k++) s += out[k] ** 2; r.push(db(s / 48)); } return r; };
  return { u, out, flow, lungs, pause, seg, ms };
}

describe('the breath taken in a pause', () => {
  it('lungs that pull draw the air in through the glottis and the mouth', () => {
    const a = new Aero();
    for (let i = 0; i < 400; i++) a.step(0.0005, { ps: -3 * CMH2O, glottalArea: 0.5, oralArea: 2, nasalArea: 0, compliance: 5e-5 });
    expect(a.ug).toBeLessThan(-500);
    expect(a.uMouth).toBeLessThan(-500);
    expect(Math.abs(a.uMouth - a.ug)).toBeLessThan(0.02 * Math.abs(a.ug));
    // the mouth is below the outside pressure, and above the lungs'
    expect(a.po).toBeLessThan(0);
    expect(a.po).toBeGreaterThan(-3 * CMH2O);
  });

  it('a slow flow through a wide glottis is held back by the airways below, and turns round without a step', () => {
    // where the jet of the glottis and the flow through the airways are equal
    const at = (area: number) => (2 * AIRWAY_RES * AIRWAY_RES * area * area) / RHO;
    for (const area of [0.56, 0.3]) {
      const c = at(area);
      // the same flow from either side of that pressure, and the airways' own below it
      expect(rootThroughZero(c * 1.0001, area)).toBeCloseTo(rootThroughZero(c * 0.9999, area), 1);
      const u = area * Math.sqrt(2 / RHO) * rootThroughZero(0.5 * c, area);
      expect(u).toBeCloseTo((0.5 * c) / AIRWAY_RES, 3);
      expect(rootThroughZero(-0.5 * c, area)).toBeCloseTo(-rootThroughZero(0.5 * c, area), 9);
    }
    // the glottis of a voice is too narrow for it to matter
    expect(at(0.05) / CMH2O).toBeLessThan(0.02);
    expect(rootThroughZero(8 * CMH2O, 0.05)).toBeCloseTo(Math.sqrt(8 * CMH2O), 9);
    note('airways below a wide glottis', `the flow is the airways' (1.5 cmH2O per l/s) below ${(at(0.56) / CMH2O).toFixed(2)} cmH2O with the glottis wide open (0.56 cm²), ${(at(0.3) / CMH2O).toFixed(2)} cmH2O at 0.3 cm², ${(at(0.05) / CMH2O).toFixed(3)} cmH2O for the glottis of a voice (0.05 cm²)`);
  });

  it('at a full stop the air goes in and is heard, well below the voice', () => {
    const text = 'la luna è piena. Stanotte la vedo.';
    const on = said(text), off = said(text, { breath: 0 });
    const p = on.pause!;
    const from = Math.round(p.t0 * 1000), to = Math.round(p.t1 * 1000);
    let inward = 0, pull = 0, taking = 0;
    for (let t = from; t < to; t++) { inward = Math.min(inward, on.flow[t]); pull = Math.min(pull, on.lungs[t]); if (on.flow[t] < -200) taking++; }
    let least = Infinity;
    for (let t = from; t < to; t++) least = Math.min(least, off.flow[t]);
    // the breath itself, away from its two ends
    const a = p.t0 + 0.14, b = p.t1 - 0.08;
    const hiss = db(bandPower(on.seg(a, b), fs, 300, 8000)), silent = db(bandPower(off.seg(a, b), fs, 300, 8000));
    // the loudest vowel of the sentence before the pause
    let voice = -Infinity;
    for (const q of on.u.score.phones) if ('aeiouɛɔ'.includes(q.ipa) && q.t1 <= p.t0) voice = Math.max(voice, db(bandPower(on.seg(q.t0, q.t1), fs, 300, 8000)));
    note('breath at a full stop', `a pause of ${((p.t1 - p.t0) * 1000).toFixed(0)} ms: the lungs pull down to ${pull.toFixed(1)} cmH2O and ${(-inward).toFixed(0)} cm³/s go in, for ${taking} ms; its hiss ${(hiss - voice).toFixed(0)} dB against the loudest vowel of the sentence before (${(silent - voice).toFixed(0)} dB with no breath taken)`);
    expect(pull).toBeLessThan(-1.5);
    expect(inward).toBeLessThan(-600);
    expect(taking).toBeGreaterThan(80);
    // without it nothing goes in
    expect(least).toBeGreaterThan(-1);
    // heard, and soft
    expect(hiss).toBeGreaterThan(silent + 12);
    expect(hiss - voice).toBeLessThan(-15);
    expect(hiss - voice).toBeGreaterThan(-45);
  });

  it('the air turns round without a pop, and the sentence after starts as it did', () => {
    const text = 'la luna è piena. Stanotte la vedo.';
    const on = said(text), off = said(text, { breath: 0 });
    const p = on.pause!;
    // every millisecond from the first turn of the air to the second: none stands out of the breath
    const lv = on.ms(p.t0 + 0.09, p.t1 - 0.01).sort((x, y) => x - y);
    const median = lv[lv.length >> 1], top = lv[lv.length - 1];
    note('turns of the breath', `the loudest millisecond of the pause ${(top - median).toFixed(0)} dB above its median one`);
    expect(top - median).toBeLessThan(15);
    // the second sentence, a tenth of a second in, to within 1.5 dB
    const s = on.u.score.phones.find((q) => q.t0 >= p.t1)!;
    const lev = (x: typeof on) => db(bandPower(x.seg(s.t0 + 0.1, s.t0 + 0.6), fs, 80, 8000));
    expect(Math.abs(lev(on) - lev(off))).toBeLessThan(1.5);
  });

  it('no breath at a comma', () => {
    const on = said('la luna, è piena');
    const p = on.pause!;
    let least = Infinity;
    for (let t = Math.round(p.t0 * 1000); t < Math.round(p.t1 * 1000); t++) least = Math.min(least, on.flow[t]);
    expect(least).toBeGreaterThan(-1);
  });
});
