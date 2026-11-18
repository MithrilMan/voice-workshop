import { describe, it, expect } from 'vitest';
import { ProgramRunner, RunnerOut, Program } from '../src/audio/programRunner';
import { defaultParams, EngineParams } from '../src/dsp/engine/params';
import { applyPhoneme, contourScore } from '../src/ui/presets';
import { buildScore } from '../src/dsp/speech/sequencer';
import { textToPhones } from '../src/dsp/speech/g2p';

const FS = 48000;

function runner() {
  const out: RunnerOut[] = [];
  const r = new ProgramRunner(FS, (m) => out.push(m));
  const block = new Float32Array(128);
  const run = (seconds: number, sink?: number[]) => {
    for (let i = 0; i < Math.round((seconds * FS) / 128); i++) { r.process(block); if (sink) for (const x of block) sink.push(x); }
  };
  const ended = () => out.filter((m): m is Extract<RunnerOut, { type: 'ended' }> => m.type === 'ended');
  return { r, out, run, ended };
}

const vowel = (ipa: string, phonate: boolean): EngineParams => { const p = defaultParams(); applyPhoneme(ipa, p); p.phonate = phonate; return p; };
const prog = (id: number, o: Partial<Program>): Program => ({ id, params: vowel('a', false), after: vowel('a', false), ...o });

describe('the program runner (audio thread)', () => {
  it('plays a sentence and then goes back to the hands', () => {
    const { r, run, ended, out } = runner();
    const hands = vowel('i', false);
    r.handle({ type: 'params', params: hands, after: hands, program: 0 });
    const score = buildScore(textToPhones('pa', 'it'), { lang: 'it' });
    r.handle({ type: 'program', program: prog(1, { score, after: hands }) });
    run(0.1);
    const tel = out.filter((m): m is Extract<RunnerOut, { type: 'telemetry' }> => m.type === 'telemetry');
    expect(tel.at(-1)!.program).toBe(1);
    run(score.duration + 0.5);
    expect(ended()).toEqual([{ type: 'ended', id: 1, reason: 'done' }]);
    expect(r.playing).toBe(0);
    expect(r.engine.params).toBe(hands);
  });

  it('stops, replaces and ignores stale stops', () => {
    const { r, run, ended } = runner();
    r.handle({ type: 'program', program: prog(1, { seconds: 5 }) });
    run(0.05);
    r.handle({ type: 'program', program: prog(2, { seconds: 5 }) });
    run(0.05);
    r.handle({ type: 'stop', id: 1 });
    r.handle({ type: 'stop', id: 2 });
    run(0.05);
    expect(ended().map((m) => [m.id, m.reason])).toEqual([[1, 'replaced'], [2, 'stopped']]);
  });

  it('parameters meant for a program already over fall back to the hands', () => {
    const { r } = runner();
    const forProgram = vowel('a', true), hands = vowel('u', false);
    r.handle({ type: 'params', params: forProgram, after: hands, program: 7 });
    expect(r.engine.params).toBe(hands);
  });

  it('a running program takes the parameters sent for it, and remembers the hands for later', () => {
    const { r, run } = runner();
    r.handle({ type: 'program', program: prog(3, { seconds: 0.2 }) });
    const now = vowel('o', true), later = vowel('e', false);
    r.handle({ type: 'params', params: now, after: later, program: 3 });
    expect(r.engine.params).toBe(now);
    run(0.3);
    expect(r.engine.params).toBe(later);
  });

  it('holds a state for a while and returns the samples heard', () => {
    const { r, run, ended } = runner();
    r.handle({ type: 'program', program: prog(4, { params: vowel('a', true), seconds: 0.5, snap: true, capture: true }) });
    run(0.7);
    const e = ended()[0];
    expect(e.reason).toBe('done');
    expect(Math.abs(e.captured!.length - 0.5 * FS)).toBeLessThan(256);
    let rms = 0;
    for (let i = 12000; i < e.captured!.length; i++) rms += e.captured![i] ** 2;
    expect(Math.sqrt(rms / (e.captured!.length - 12000))).toBeGreaterThan(0.01);
  });

  it('plays samples in place of the voice, at the engine volume', () => {
    const { r, run, ended } = runner();
    const hands = vowel('a', false);
    hands.volume = -6;
    r.handle({ type: 'params', params: hands, after: hands, program: 0 });
    run(0.02);
    const samples = new Float32Array(FS * 0.2).fill(0.25);
    r.handle({ type: 'program', program: prog(5, { params: hands, after: hands, samples }) });
    const heard: number[] = [];
    run(0.3, heard);
    expect(ended()[0]).toMatchObject({ id: 5, reason: 'done' });
    const g = 0.25 * Math.pow(10, -6 / 20);
    // after the short fade, the samples come out unchanged
    const mid = heard.slice(2000, 8000);
    expect(Math.max(...mid.map((x) => Math.abs(x - g)))).toBeLessThan(1e-6);
  });

  it('plays samples round and round, says where it is, and takes new ones from the same share of them', () => {
    const { r, run, ended, out } = runner();
    const hands = vowel('a', false);
    hands.volume = 0;
    r.handle({ type: 'params', params: hands, after: hands, program: 0 });
    run(0.02);
    // a ramp of 0.1 s: each sample says where it is
    const n = FS * 0.1, ramp = new Float32Array(n).map((_, i) => i / n);
    r.handle({ type: 'program', program: prog(6, { params: hands, after: hands, samples: ramp, loop: true, from: n / 2 }) });
    const heard: number[] = [];
    run(0.35, heard);
    expect(ended()).toEqual([]);
    // after the fade in, from the middle of the ramp, it goes round: steps of one sample, a drop to the start at each end
    const start = heard.findIndex((x) => x > 0.45);
    expect(heard[start + 400]).toBeGreaterThan(0.5);
    let drops = 0;
    for (let i = start + 400; i < heard.length; i++) {
      const d = heard[i] - heard[i - 1];
      if (d < -0.9) drops++;
      else expect(Math.abs(d - 1 / n)).toBeLessThan(1e-6);
    }
    expect(drops).toBe(3);
    const tel = out.filter((m): m is Extract<RunnerOut, { type: 'telemetry' }> => m.type === 'telemetry').at(-1)!;
    expect(tel.at).toBeGreaterThanOrEqual(0);
    expect(tel.at).toBeLessThan(0.1);
    // new samples, twice as long, from the same share of them, the old ones fading out
    const share = heard.at(-1)! + 1 / n;
    const twice = new Float32Array(2 * n).map((_, i) => 2 + i / (2 * n));
    r.handle({ type: 'swap', id: 6, samples: twice });
    const after: number[] = [];
    run(0.02, after);
    const fade = Math.round(0.005 * FS);
    expect(after[fade]).toBeCloseTo(2 + (Math.round(share * 2 * n) + fade) / (2 * n), 5);
    expect(after[fade + 100] - after[fade + 99]).toBeCloseTo(1 / (2 * n), 6);
    r.handle({ type: 'stop', id: 6 });
    run(0.01);
    expect(ended()).toEqual([{ type: 'ended', id: 6, reason: 'stopped' }]);
  });

  it('a score without articulators leaves the tract to the parameters (the hands)', () => {
    const { r, run, out } = runner();
    const hands = vowel('a', false);
    hands.articulators.jaw = 0.9;
    r.handle({ type: 'params', params: hands, after: hands, program: 0 });
    const score = contourScore([{ t: 0, f0: 150 }, { t: 1, f0: 150 }], 8);
    r.handle({ type: 'program', program: prog(6, { params: hands, after: hands, score }) });
    run(0.3);
    const tel = out.filter((m): m is Extract<RunnerOut, { type: 'telemetry' }> => m.type === 'telemetry').at(-1)!;
    expect(tel.telemetry.articulators.jaw).toBeCloseTo(0.9, 2);
    expect(tel.telemetry.f0Target).toBeGreaterThan(140);
  });
});
