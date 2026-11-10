import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { EngineParams, Score } from '../src/dsp/engine/params';
import { analyse, align, copyTiming, imposePitch, imposeLoudness, swell, crossSynth } from '../src/dsp/voice/copy';
import { note, spectralCentroid } from './helpers';

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
    const timed = copyTiming(phones, (ph, timing) => utterance(man, ph, 'it', timing ? { timing } : {}).score, recA, map, recClip.samples.length / FS).score;
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
    const timed = copyTiming(phones, (ph, timing) => utterance(man, ph, 'it', timing ? { timing } : {}).score, recA, map, recClip.samples.length / FS).score;
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

describe('cross-synthesis', () => {
  const phones = textToPhones('la luna piena', 'it');
  const man = builtinVoice('man')!.design, woman = builtinVoice('woman')!.design;
  const a = utterance(man, phones, 'it'), b = utterance(woman, phones, 'it', { f0: 110 });
  const x = { samples: render(a.params, a.score), fs: FS }, z = { samples: render(b.params, b.score), fs: FS };

  it('gives a clip crossed with itself back as it was', () => {
    const y = crossSynth(x, x);
    let s = 0, d = 0;
    for (let i = 0; i < y.length; i++) { s += x.samples[i] ** 2; d += (y[i] - x.samples[i]) ** 2; }
    note('cross-synthesis', `"la luna piena" crossed with itself: ${(10 * Math.log10(s / d)).toFixed(0)} dB signal to difference`);
    expect(10 * Math.log10(s / d)).toBeGreaterThan(60);
  });

  it('keeps the pitch of the source and takes the formants of the mouth', () => {
    // the man's folds (110 Hz) through the woman's mouth: the woman's formants, the man's pitch
    const y = crossSynth(x, z);
    const pitch = (c: { samples: Float32Array; fs: number }) => { const f = analyse(c, true).f0.filter((v) => v > 0).sort((p, q) => p - q); return f[f.length >> 1]; };
    const f1 = (c: { samples: Float32Array; fs: number }) => {
      // the first formant of the held /u/ of "luna": the centroid of 200-1000 Hz in its middle
      const p = (c === x ? a : b).score.phones.find((q) => q.ipa === 'u')!;
      const at = Math.round(0.5 * (p.t0 + p.t1) * FS), seg = c.samples.subarray(at - 400, at + 400);
      return spectralCentroid(seg, FS, 200, 1000, 512);
    };
    const yc = { samples: y, fs: FS };
    note('cross-synthesis 2', `the man's folds through the woman's mouth: pitch ${pitch(yc).toFixed(0)} Hz (the man's ${pitch(x).toFixed(0)}), centroid of 200-1000 Hz in the /u/ ${f1(yc).toFixed(0)} Hz (the woman's ${f1(z).toFixed(0)}, the man's ${f1(x).toFixed(0)})`);
    expect(Math.abs(12 * Math.log2(pitch(yc) / pitch(x)))).toBeLessThan(0.5);
    expect(Math.abs(f1(yc) - f1(z))).toBeLessThan(Math.abs(f1(yc) - f1(x)));
  });
});
