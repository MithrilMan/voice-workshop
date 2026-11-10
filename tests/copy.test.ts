import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { EngineParams, Score } from '../src/dsp/engine/params';
import { analyse, align, warpScore, imposePitch, imposeLoudness, swell } from '../src/dsp/voice/copy';
import { note } from './helpers';

const FS = 16000;
function render(params: EngineParams, score: Score): Float32Array {
  const e = new VoiceEngine(FS, params);
  e.snapArticulators(); e.playScore(score);
  const y = new Float32Array(Math.round((score.duration + 0.15) * FS));
  e.process(y, y.length);
  return y;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / Math.max(1, xs.length));

describe('copy synthesis', () => {
  // the "recording" is the simulator itself, slower and higher: what the copy must find is known
  const phones = textToPhones('la luna piena sale sopra il mare', 'it');
  const man = builtinVoice('man')!.design;
  const rec = utterance(man, phones, 'it', { rate: 0.8, f0: 140, style: { phrase: 1.6 } });
  const ours = utterance(man, phones, 'it');
  const recClip = { samples: render(rec.params, rec.score), fs: FS };
  const recA = analyse(recClip, true);

  it('lines our saying up with the recording', () => {
    const plain = render(ours.params, ours.score);
    const map = align(recA, analyse({ samples: plain, fs: FS }));
    const timed = warpScore(ours.score, map, recClip.samples.length / FS);
    // each sound where the recording has it
    const gaps = timed.phones.map((p, i) => Math.abs(0.5 * (p.t0 + p.t1) - 0.5 * (rec.score.phones[i].t0 + rec.score.phones[i].t1)));
    const before = ours.score.phones.map((p, i) => Math.abs(0.5 * (p.t0 + p.t1) - 0.5 * (rec.score.phones[i].t0 + rec.score.phones[i].t1)));
    note('copy timing', `"la luna piena sale sopra il mare" at rate 0.8 against 1: middles of the sounds ${(1000 * median(before)).toFixed(0)} ms apart (median), ${(1000 * median(gaps)).toFixed(0)} ms on the copied timing; the whole ${timed.duration.toFixed(2)} s against ${rec.score.duration.toFixed(2)}`);
    expect(median(gaps)).toBeLessThan(0.03);
    expect(median(gaps)).toBeLessThan(0.25 * median(before));
    expect(Math.abs(timed.duration / rec.score.duration - 1)).toBeLessThan(0.06);
  });

  it('gives it the recording\'s melody and swell', () => {
    const map = align(recA, analyse({ samples: render(ours.params, ours.score), fs: FS }));
    const timed = warpScore(ours.score, map, recClip.samples.length / FS);
    const sung = imposePitch(timed, recA);
    const a = analyse({ samples: render(ours.params, sung), fs: FS }, true);
    const st: number[] = [], plainSt: number[] = [];
    const t = analyse({ samples: render(ours.params, timed), fs: FS }, true);
    a.f0.forEach((x, i) => { if (x > 0 && recA.f0[i] > 0) st.push(Math.abs(12 * Math.log2(x / recA.f0[i]))); });
    t.f0.forEach((x, i) => { if (x > 0 && recA.f0[i] > 0) plainSt.push(Math.abs(12 * Math.log2(x / recA.f0[i]))); });
    const loud = imposeLoudness(sung, recA, a);
    const after = swell(recA, analyse({ samples: render(ours.params, loud), fs: FS }, true));
    note('copy melody', `pitch ${median(plainSt).toFixed(2)} st off the recording on its timing alone, ${median(st).toFixed(2)} st with its melody (median); the swell of the loudness ${rms(swell(recA, a)).toFixed(1)} dB rms off, ${rms(after).toFixed(1)} copied`);
    expect(median(st)).toBeLessThan(0.3);
    expect(median(plainSt)).toBeGreaterThan(3);
    expect(rms(after)).toBeLessThanOrEqual(rms(swell(recA, a)) + 0.1);
  });
});
