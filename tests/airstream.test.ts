import { describe, it, expect } from 'vitest';
import { Aero } from '../src/dsp/aero/aero';
import { CMH2O } from '../src/dsp/constants';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { note } from './helpers';

const fs = 48000;

/** plays a [phonetic] transcription, giving the aerodynamics of each millisecond */
function play(text: string) {
  const score = buildScore(textToPhones(text, 'it'), { lang: 'it' });
  const e = new VoiceEngine(fs, defaultParams());
  e.snapArticulators(); e.snapPressure(); e.playScore(score);
  const buf = new Float32Array(48);
  const tel: { t: number; area: number; po: number; ug: number; um: number; voicing: number; larynx: number }[] = [];
  for (let time = 0; time < score.duration; time += 48 / fs) {
    e.process(buf, 48);
    const x = e.telemetry();
    tel.push({ t: time, area: x.constrictionArea, po: x.po / CMH2O, ug: x.ug, um: x.uMouth, voicing: x.voicingAmp, larynx: x.articulators.larynx });
  }
  return { score, tel };
}

/** the milliseconds of a stop with the mouth shut, and the 30 ms after its release */
function closure(text: string, ipa: string) {
  const { score, tel } = play(text);
  const ph = score.phones.find((q) => q.ipa === ipa)!;
  const shut = tel.filter((x) => x.t > ph.t0 - 0.01 && x.t < ph.t1 + 0.01 && x.area < 0.005);
  const release = shut[shut.length - 1].t;
  const after = tel.filter((x) => x.t > release && x.t < release + 0.03);
  const peak = Math.max(...shut.map((x) => x.po));
  return { shut, after, release, peak, last: shut[shut.length - 1] };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('airstreams', () => {
  it('a piston on a shut cavity changes its pressure by dV / C, and below the outside pressure the air flows in', () => {
    const a = new Aero();
    const shut = { ps: 8 * CMH2O, glottalArea: 0, oralArea: 0, nasalArea: 0, compliance: 2e-4 };
    // 1 cm³ pushed in over 10 ms: +1 / C = 5000 dyn/cm²
    for (let i = 0; i < 100; i++) a.step(1e-4, { ...shut, dVdt: -100 });
    expect(Math.abs(a.po - 5000)).toBeLessThan(1);
    // 2 cm³ drawn out: as far below the outside
    for (let i = 0; i < 100; i++) a.step(1e-4, { ...shut, dVdt: 200 });
    expect(Math.abs(a.po + 5000)).toBeLessThan(1);
    a.step(1e-5, { ...shut, oralArea: 0.05 });
    expect(a.uMouth).toBeLessThan(-100);
    // and a mouth open to the lungs is not moved by it
    const b = new Aero();
    for (let i = 0; i < 2000; i++) b.step(1e-4, { ...shut, glottalArea: 0.2, oralArea: 0.5, dVdt: 0 });
    expect(b.po).toBeGreaterThan(0);
  });

  it('an ejective: the raised larynx, not the lungs, compresses the air behind the closure, and the burst is short', () => {
    const ej = closure('[aˈkʼa]', 'kʼ'), k = closure('[aˈka]', 'k');
    const flow = (c: typeof ej) => mean(c.after.map((x) => x.um));
    note('ejective', `[kʼ] ${ej.peak.toFixed(1)} cmH₂O behind the shut glottis, larynx up ${ej.last.larynx.toFixed(2)} cm, ` +
      `mouth flow in the 30 ms after the burst ${flow(ej).toFixed(0)} cm³/s; [k] ${k.peak.toFixed(1)} cmH₂O, ${flow(k).toFixed(0)} cm³/s`);
    // above the lungs' 8 cmH2O, with no air coming from them
    expect(ej.peak).toBeGreaterThan(8);
    expect(Math.max(...ej.shut.map((x) => x.ug))).toBeLessThan(5);
    expect(ej.last.larynx).toBeGreaterThan(0.6);
    // the little air behind the closure is soon gone; the lungs keep blowing behind a plain stop
    expect(flow(ej)).toBeLessThan(0.5 * flow(k));
  });

  it('an implosive: the falling larynx and the yielding walls keep the pressure low, and the voice going through the closure', () => {
    const im = closure('[aˈɓa]', 'ɓ'), b = closure('[aˈba]', 'b');
    note('implosive', `[ɓ] ${im.peak.toFixed(1)} cmH₂O, larynx ${im.last.larynx.toFixed(2)} cm, voicing at the release ${im.last.voicing.toFixed(2)}; ` +
      `[b] ${b.peak.toFixed(1)} cmH₂O, voicing ${b.last.voicing.toFixed(2)}`);
    expect(im.peak).toBeLessThan(0.7 * b.peak);
    expect(im.last.voicing).toBeGreaterThan(b.last.voicing + 0.1);
    expect(im.last.larynx).toBeLessThan(-0.8);
  });

  it('a voiceless implosive lowers the larynx with the glottis shut: the pressure falls below the outside and the release draws air in', () => {
    const c = closure('[aˈɓ̥a]', 'ɓ̥');
    const low = Math.min(...c.shut.map((x) => x.po));
    const inflow = Math.min(...c.after.slice(0, 6).map((x) => x.um));
    note('voiceless implosive', `[ɓ̥] ${low.toFixed(1)} cmH₂O at the release, mouth flow ${inflow.toFixed(0)} cm³/s`);
    expect(low).toBeLessThan(-3);
    expect(inflow).toBeLessThan(-50);
  });
});

/** closures of a trill (shut below 0.004 cm², open again above 0.02) and their mean period */
function trill(text: string, ps: number) {
  const score = buildScore(textToPhones(text, 'it'), { lang: 'it', ps });
  const ph = score.phones.find((q) => q.ipa !== 'a')!;
  const e = new VoiceEngine(fs, defaultParams());
  e.snapArticulators(); e.snapPressure(); e.playScore(score);
  const buf = new Float32Array(48);
  const starts: number[] = [];
  let closed = false;
  for (let t = 0; t < ph.t1 + 0.02; t += 48 / fs) {
    e.process(buf, 48);
    const a = e.telemetry().constrictionArea;
    const c: boolean = closed ? a < 0.02 : a < 0.004;
    if (t > ph.t0 - 0.02 && c && !closed) starts.push(t);
    closed = c;
  }
  return { n: starts.length, period: starts.length > 1 ? (starts[starts.length - 1] - starts[0]) / (starts.length - 1) : NaN };
}

describe('aeroelastic trills', () => {
  it('the air keeps the tip, the lips and the uvula trilling, near 30 Hz, and they stop when the lungs push too little', () => {
    const rows: string[] = [];
    for (const text of ['[ˈarːa]', '[ˈaʙːa]', '[ˈaʀːa]']) {
      const strong = trill(text, 8), weak = trill(text, 0.5);
      rows.push(`${text} ${strong.n} closures every ${(strong.period * 1000).toFixed(0)} ms, with weak lungs ${weak.n}`);
      expect(strong.n).toBeGreaterThanOrEqual(3);
      expect(strong.period).toBeGreaterThan(0.022);
      expect(strong.period).toBeLessThan(0.045);
      // the contact the articulator makes on its way, and at most one bounce
      expect(weak.n).toBeLessThanOrEqual(2);
    }
    note('aeroelastic trills', rows.join('; '));
  });
});
