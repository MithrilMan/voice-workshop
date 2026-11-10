import { describe, it, expect } from 'vitest';
import { solveLF, rdToTiming, lfFlow, lfDerivative, LFShape } from '../src/dsp/glottis/lf';
import { linearFit } from '../src/dsp/util/math';
import { renderOffline, VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { VOWELS } from '../src/dsp/speech/phonemes';
import { yin } from '../src/dsp/analysis/pitch';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { note, bandPower, loadEnglishLexicon } from './helpers';

const N = 960; // samples per period, F0 = 100 Hz at 96 kHz: harmonics fall exactly on DFT bins

function period(sh: LFShape, fn: (s: LFShape, t: number) => number): Float64Array {
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = fn(sh, i / N);
  return x;
}

function harmonic(x: Float64Array, k: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < N; i++) {
    re += x[i] * Math.cos((2 * Math.PI * k * i) / N);
    im -= x[i] * Math.sin((2 * Math.PI * k * i) / N);
  }
  return Math.hypot(re, im);
}

function slope(x: Float64Array, f0: number, fa: number, fb: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (let k = 1; k * f0 <= fb; k++) {
    if (k * f0 < fa) continue;
    xs.push(Math.log2(k * f0));
    ys.push(20 * Math.log10(harmonic(x, k)));
  }
  return linearFit(xs, ys)[1];
}

describe('Liljencrants-Fant glottal flow model', () => {
  it('Rd maps to the expected open quotient and asymmetry (Fant 1995)', () => {
    const modal = rdToTiming(1);
    expect(modal.te).toBeGreaterThan(0.6);
    expect(modal.te).toBeLessThan(0.7);
    expect(modal.tp / modal.te).toBeGreaterThan(0.7);
    const pressed = rdToTiming(0.4), breathy = rdToTiming(2.5);
    expect(pressed.te).toBeLessThan(modal.te);
    expect(breathy.te).toBeGreaterThan(modal.te);
    expect(breathy.ta).toBeGreaterThan(modal.ta);
  });

  it('flow returns to zero at the end of the period and the derivative reaches -Ee at te', () => {
    for (const rd of [0.4, 1, 2, 2.7]) {
      const sh = solveLF(rdToTiming(rd));
      expect(Math.abs(lfFlow(sh, 0.999999))).toBeLessThan(1e-6 * sh.upeak + 1e-9);
      expect(lfDerivative(sh, sh.te)).toBeCloseTo(-1, 6);
      // flow peak at tp: derivative crosses zero there
      expect(Math.abs(lfDerivative(sh, sh.tp))).toBeLessThan(1e-6);
    }
  });

  it('flow-derivative spectrum falls about 12 dB/octave at high frequencies (modal voice)', () => {
    const sh = solveLF(rdToTiming(1));
    const e = period(sh, lfDerivative);
    const u = period(sh, lfFlow);
    const se = slope(e, 100, 1000, 5000);
    const su = slope(u, 100, 1000, 5000);
    note('LF Rd=1 spectral slope 1-5 kHz', `derivative ${se.toFixed(1)} dB/oct, flow ${su.toFixed(1)} dB/oct`);
    expect(se).toBeGreaterThan(-14);
    expect(se).toBeLessThan(-10);
    expect(su - se).toBeGreaterThan(-6.5);
    expect(su - se).toBeLessThan(-5.5);
  });

  it('breathier voice (higher Rd) has a stronger fundamental relative to H2 (H1-H2)', () => {
    const h12 = (rd: number) => {
      const e = period(solveLF(rdToTiming(rd)), lfDerivative);
      return 20 * Math.log10(harmonic(e, 1) / harmonic(e, 2));
    };
    const p = h12(0.5), m = h12(1), b = h12(2.5);
    note('LF H1-H2 (derivative)', `Rd 0.5: ${p.toFixed(1)} dB, Rd 1: ${m.toFixed(1)} dB, Rd 2.5: ${b.toFixed(1)} dB`);
    expect(p).toBeLessThan(m);
    expect(m).toBeLessThan(b);
  });
});

describe('self-oscillating two-mass vocal folds', () => {
  function run(q: number, ps: number, auto = false, f0 = 120) {
    const p = defaultParams();
    p.articulators = { ...p.articulators, ...VOWELS.a.art };
    p.phonate = true;
    p.source.model = 'twomass';
    p.source.tensionAuto = auto;
    p.source.q = q;
    p.source.f0 = f0;
    p.source.ps = ps;
    const { out, engine } = renderOffline(p, 1.0);
    let s = 0;
    for (let i = 24000; i < 48000; i++) s += out[i] * out[i];
    return { f0: engine.telemetry().f0, rms: Math.sqrt(s / 24000) };
  }

  it('oscillates from lung pressure alone, and pitch rises with fold tension', () => {
    const lo = run(0.7, 8), mid = run(1.2, 8), hi = run(1.8, 8);
    note('two-mass F0 vs tension Q', `Q 0.7: ${lo.f0.toFixed(0)} Hz, Q 1.2: ${mid.f0.toFixed(0)} Hz, Q 1.8: ${hi.f0.toFixed(0)} Hz`);
    expect(lo.f0).toBeGreaterThan(60);
    expect(mid.f0).toBeGreaterThan(lo.f0 * 1.3);
    expect(hi.f0).toBeGreaterThan(mid.f0 * 1.2);
    expect(lo.rms).toBeGreaterThan(1e-3);
  });

  it('the tension controller follows a target pitch', () => {
    for (const target of [100, 220]) {
      const r = run(1, 8, true, target);
      expect(Math.abs(r.f0 - target) / target).toBeLessThan(0.04);
    }
  });

  it('no airflow, no voice', () => {
    const r = run(1, 0);
    expect(r.rms).toBeLessThan(1e-4);
  });

  it('folds drawn apart give breath, not voice, as with the LF source', () => {
    const held = (model: 'lf' | 'twomass', abduction: number) => {
      const p = defaultParams();
      p.articulators = { ...p.articulators, ...VOWELS.a.art };
      p.phonate = true;
      p.source.model = model;
      p.abduction = abduction;
      const seg = renderOffline(p, 1.0).out.subarray(24000, 48000);
      let s = 0;
      for (const v of seg) s += v * v;
      return { db: 10 * Math.log10(s / seg.length), low: 10 * Math.log10(bandPower(seg, 48000, 80, 600)), f0: yin(seg.subarray(0, 4096), 48000, 70, 400).f0 };
    };
    const voice = held('twomass', 0), breathy = held('twomass', 0.2), half = held('twomass', 0.7), breath = held('twomass', 1);
    const lfVoice = held('lf', 0), lfBreathy = held('lf', 0.2), lf = held('lf', 1);
    note('two-mass folds drawn apart', `level ${voice.db.toFixed(1)} dB together (LF source: ${lfVoice.db.toFixed(1)} dB), ${breathy.db.toFixed(1)} dB a little apart (${lfBreathy.db.toFixed(1)}), ${half.db.toFixed(1)} dB at 0.7, without pitch, ${breath.db.toFixed(1)} dB wide apart (${lf.db.toFixed(1)})`);
    expect(voice.f0).toBeGreaterThan(100);
    // the two sources are as loud as each other
    expect(Math.abs(voice.db - lfVoice.db)).toBeLessThan(2);
    // a little apart: still a voice, weaker, as the LF one
    expect(breathy.f0).toBeGreaterThan(100);
    expect(breathy.db).toBeLessThan(voice.db - 2);
    expect(Math.abs(breathy.db - lfBreathy.db)).toBeLessThan(2);
    // further apart the folds have stopped by themselves: nobody tells them to
    expect(half.f0).toBe(0);
    // wide apart: no pitch, the voice band empties, and what is left is the breath of the LF source
    expect(breath.f0).toBe(0);
    expect(breath.low).toBeLessThan(voice.low - 20);
    expect(Math.abs(breath.db - lf.db)).toBeLessThan(6);
  });

  it('the flow through a wide glottis is steady, and is what the opening lets through', () => {
    const rows: string[] = [];
    for (const abduction of [0.7, 0.85, 1]) {
      const flow = (model: 'lf' | 'twomass') => {
        const p = defaultParams();
        p.articulators = { ...p.articulators, ...VOWELS.a.art };
        p.phonate = true;
        p.source.model = model;
        p.abduction = abduction;
        const e = new VoiceEngine(48000, p);
        e.snapArticulators(); e.snapPressure();
        const buf = new Float32Array(48);
        let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
        for (let t = 0; t < 1; t += 0.001) {
          e.process(buf, 48);
          if (t < 0.5) continue;
          const u = (e as unknown as { glottalFlow: number }).glottalFlow;
          lo = Math.min(lo, u); hi = Math.max(hi, u); sum += u; n++;
        }
        return { lo, hi, mean: sum / n };
      };
      const tm = flow('twomass'), lf = flow('lf');
      rows.push(`${abduction}: ${tm.mean.toFixed(0)} cm³/s, between ${tm.lo.toFixed(0)} and ${tm.hi.toFixed(0)} (LF source ${lf.mean.toFixed(0)})`);
      // it ran away once: the flow was solved against a wave the glottal end did not reflect
      expect(tm.lo).toBeGreaterThan(0.9 * tm.mean);
      expect(tm.hi).toBeLessThan(1.1 * tm.mean);
      expect(Math.abs(tm.mean / lf.mean - 1)).toBeLessThan(0.15);
    }
    note('two-mass flow, glottis wide', `abduction ${rows.join('; ')}`);
  });

  it('louder, brighter and a little higher with the lung pressure, from their own equations', () => {
    const held = (ps: number) => {
      const p = defaultParams();
      p.articulators = { ...p.articulators, ...VOWELS.a.art };
      p.phonate = true;
      p.source.model = 'twomass';
      // (the tension held, so that the pitch is the folds' own)
      p.source.tensionAuto = false;
      p.source.q = 0.9;
      p.source.ps = ps;
      const seg = renderOffline(p, 1.0).out.subarray(24000, 48000);
      let s = 0;
      for (const v of seg) s += v * v;
      const db = (x: number) => 10 * Math.log10(x);
      return { db: db(s / seg.length), tilt: db(bandPower(seg, 48000, 2000, 4000)) - db(bandPower(seg, 48000, 80, 1000)), f0: yin(seg.subarray(0, 4096), 48000, 70, 400).f0 };
    };
    const soft = held(4), speaking = held(8), loud = held(16);
    note('two-mass source and lung pressure', `4, 8, 16 cmH2O: level ${[soft, speaking, loud].map((x) => x.db.toFixed(1)).join(', ')} dB; 2-4 kHz against 0-1 kHz ${[soft, speaking, loud].map((x) => x.tilt.toFixed(1)).join(', ')} dB; pitch ${[soft, speaking, loud].map((x) => x.f0.toFixed(0)).join(', ')} Hz`);
    for (const [a, b] of [[soft, speaking], [speaking, loud]]) {
      expect(b.db - a.db).toBeGreaterThan(5);
      expect(b.db - a.db).toBeLessThan(12);
      expect(b.tilt).toBeGreaterThan(a.tilt);
    }
    expect(soft.f0).toBeLessThan(speaking.f0);
    expect(loud.f0).toBeGreaterThan(speaking.f0 - 1);
  });

  it('speaking, they are as loud as the LF voice, and their air stops with the lungs', () => {
    loadEnglishLexicon();
    const say = (model: 'lf' | 'twomass') => {
      const u = utterance(builtinVoice('man')!.design, textToPhones('he has a house', 'en'), 'en');
      u.params.source.model = model;
      const e = new VoiceEngine(48000, u.params);
      e.snapArticulators(); e.playScore(u.score);
      const n = Math.round((u.score.duration + 0.2) * 48000), out = new Float32Array(n);
      for (let i = 0; i + 48 <= n; i += 48) e.process(out.subarray(i, i + 48), 48);
      let s = 0, peak = 0;
      for (const v of out) { s += v * v; peak = Math.max(peak, Math.abs(v)); }
      return { db: 10 * Math.log10(s / n), peak, left: (e as unknown as { glottalFlow: number }).glottalFlow };
    };
    const tm = say('twomass'), lf = say('lf');
    note('two-mass folds speaking', `"he has a house": ${tm.db.toFixed(1)} dB, peak ${tm.peak.toFixed(2)} (LF source ${lf.db.toFixed(1)} dB, ${lf.peak.toFixed(2)}); ${tm.left.toFixed(0)} cm³/s through the glottis 0.2 s after the end`);
    // (with a mean of the flow that lagged behind the opening of the glottis, the vowels after /h/ were three times as loud and the air went on for 0.2 s)
    expect(Math.abs(tm.db - lf.db)).toBeLessThan(3);
    expect(tm.peak).toBeLessThan(1.5 * lf.peak);
    expect(Math.abs(tm.left)).toBeLessThan(100);
  });
});

describe('what the pressure does to the LF source', () => {
  it('a louder voice is also brighter: level and upper spectrum rise together with the lung pressure', () => {
    const held = (ps: number) => {
      const p = defaultParams();
      p.articulators = { ...p.articulators, ...VOWELS.a.art };
      p.phonate = true;
      p.source.ps = ps;
      const seg = renderOffline(p, 1.0).out.subarray(24000, 48000);
      let s = 0;
      for (const v of seg) s += v * v;
      const db = (x: number) => 10 * Math.log10(x);
      return { db: db(s / seg.length), tilt: db(bandPower(seg, 48000, 2000, 4000)) - db(bandPower(seg, 48000, 80, 1000)) };
    };
    const soft = held(4), speaking = held(8), loud = held(16);
    note('LF source and lung pressure', `4, 8, 16 cmH2O: level ${[soft, speaking, loud].map((x) => x.db.toFixed(1)).join(', ')} dB; 2-4 kHz against 0-1 kHz ${[soft, speaking, loud].map((x) => x.tilt.toFixed(1)).join(', ')} dB`);
    // 8-9 dB per doubling above the speaking pressure (Titze & Sundberg 1992), a little more below it
    expect(loud.db - speaking.db).toBeGreaterThan(7.5);
    expect(loud.db - speaking.db).toBeLessThan(9.5);
    expect(speaking.db - soft.db).toBeGreaterThan(8);
    expect(speaking.db - soft.db).toBeLessThan(11.5);
    expect(loud.tilt).toBeGreaterThan(speaking.tilt + 1.5);
    expect(soft.tilt).toBeLessThan(speaking.tilt - 1);
  });

  it('the pitch dips in a voiced stop or fricative, with the pressure behind it, not in a nasal', () => {
    const dip = (word: string) => {
      const sc = buildScore(textToPhones(word, 'it'), { f0: 120 });
      const { out } = renderOffline(defaultParams(), sc.duration + 0.1, 48000, sc);
      const c = sc.phones.find((p) => p.ipa !== 'a')!;
      const t = c.t0 + 0.6 * (c.t1 - c.t0), i = Math.round(t * 48000);
      return yin(out.subarray(i - 1024, i + 1024), 48000, 70, 400).f0 / sc.frames[Math.round(t / 0.005)].f0 - 1;
    };
    const b = dip('[aˈbːa]'), z = dip('[aˈzːa]'), m = dip('[aˈmːa]');
    note('pitch in voiced consonants', `against the plan: /b/ ${(100 * b).toFixed(1)} %, /z/ ${(100 * z).toFixed(1)} %, /m/ ${(100 * m).toFixed(1)} %`);
    expect(b).toBeLessThan(-0.025);
    expect(b).toBeGreaterThan(-0.09);
    expect(z).toBeLessThan(-0.015);
    expect(Math.abs(m)).toBeLessThan(0.012);
  });
});
