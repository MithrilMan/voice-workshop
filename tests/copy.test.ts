import { describe, it, expect } from 'vitest';
import { textToPhones, Phone } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { EngineParams, Score } from '../src/dsp/engine/params';
import { analyse, align, copyTiming, copyTimingSaid, clock, imposePitch, imposeLoudness, swell, crossSynth } from '../src/dsp/voice/copy';
import { loadEnglishLexicon, note, spectralCentroid } from './helpers';

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

  it('times it by the sounds of a recording that comes with their times', () => {
    // the labels as a synthesizer gives them: late, and the last one running on through the silence after it
    const late = 0.04, last = rec.score.phones.length - 1;
    const said = rec.score.phones.map((p, i) => ({ ipa: p.ipa, t0: p.t0 + late, t1: p.t1 + late + (i === last ? 0.3 : 0) }));
    const shift = clock(said, recA);
    // our own sounds come after their plan too, by the same measure
    const trail = clock(ours.score.phones, analyse({ samples: render(ours.params, ours.score), fs: FS }, true));
    const timed = copyTimingSaid(phones, (ph, timing) => utterance(man, ph, 'it', timing ? { timing } : {}).score, recA, said, trail).score;
    const starts = timed.phones.map((p, i) => Math.abs(p.t0 - rec.score.phones[i].t0));
    const end = timed.phones[last].t1 - rec.score.phones[last].t1;
    note('copy timing by labels', `labels given ${(1000 * late).toFixed(0)} ms late are found ${(-1000 * shift).toFixed(0)} ms after the sounds, which come ${(1000 * trail).toFixed(0)} ms after their plan; the starts of the sounds ${(1000 * median(starts)).toFixed(0)} ms off the recording's (median), ${(1000 * Math.max(...starts)).toFixed(0)} at most; the last sound, labelled 300 ms too long, ends ${(1000 * end).toFixed(0)} ms after the recording's`);
    expect(Math.abs(shift - trail + late)).toBeLessThanOrEqual(0.0051);
    expect(median(starts)).toBeLessThan(0.01);
    expect(Math.max(...starts)).toBeLessThan(0.03);
    expect(Math.abs(end)).toBeLessThan(0.08);
  });

  it('takes a held stop from the recording where our rules tap it', () => {
    const tap = 'ɾ';
    const en = textToPhones('a little water', 'en');
    // a "recording" that holds both stops, and slower
    const held: Phone[] = en.map((p) => (p.ipa === tap ? { ...p, ipa: 't' } : p));
    const their = utterance(man, held, 'en', { rate: 0.8 });
    const a = analyse({ samples: render(their.params, their.score), fs: FS }, true);
    const said = their.score.phones.map((p) => ({ ipa: p.ipa, t0: p.t0, t1: p.t1 }));
    const got = copyTimingSaid(en, (ph, timing) => utterance(man, ph, 'en', timing ? { timing } : {}).score, a, said);
    expect(en.filter((p) => p.ipa === tap).length).toBe(2);
    expect(got.phones.filter((p) => p.ipa === tap).length).toBe(0);
    expect(got.phones.filter((p) => p.ipa === 't').length).toBe(2);
    // and each sound lasts as theirs does (but the last, which ends with the speech)
    const lens = got.score.phones.slice(0, -1).map((p, i) => Math.abs(p.t1 - p.t0 - (their.score.phones[i].t1 - their.score.phones[i].t0)));
    expect(median(lens)).toBeLessThan(0.015);
    expect(Math.max(...lens)).toBeLessThan(0.04);
  });

  it("hears a pause in the time of a word's last sound, but not in a stop held long", () => {
    loadEnglishLexicon();
    const copy = (lang: 'it' | 'en', theirs: string, mine: string, rate: number) => {
      const their = utterance(man, textToPhones(theirs, lang), lang, { rate });
      const a = analyse({ samples: render(their.params, their.score), fs: FS }, true);
      // labels that leave no gaps, as a synthesizer gives them: each sound runs on to the next, through any silence
      const sounds = their.score.phones.filter((p) => p.ipa !== '_');
      const said = sounds.map((p, i) => ({ ipa: p.ipa, t0: p.t0, t1: i + 1 < sounds.length ? sounds[i + 1].t0 : p.t1 }));
      const mineP = textToPhones(mine, lang);
      const got = copyTimingSaid(mineP, (ph, timing) => utterance(man, ph, lang, timing ? { timing } : {}).score, a, said);
      const paused = (ps: Phone[]) => ps.map((p, i) => (p.pause ? i : -1)).filter((i) => i >= 0);
      return { their: their.score, got, before: paused(mineP), after: paused(got.phones) };
    };
    // the recording stops at a comma our text does not have: the silence is in the time of the /a/ before it
    const it = copy('it', 'la luna, piena sale sopra il mare', 'la luna piena sale sopra il mare', 0.8);
    expect(it.after.filter((i) => !it.before.includes(i))).toEqual([5]);
    const first = (s: Score, ipa: string) => s.phones.find((p) => p.ipa === ipa)!;
    const second = (s: Score, ipa: string) => s.phones.filter((p) => p.ipa === ipa)[1];
    const len = (s: Score) => second(s, 'a').t1 - second(s, 'a').t0;
    note('copy pause', `a silence in the time of the last sound of "luna" becomes a pause: the /p/ after it starts ${(1000 * (first(it.got.score, 'p').t0 - first(it.their, 'p').t0)).toFixed(0)} ms off the recording's, the /a/ before it lasts ${(1000 * len(it.got.score)).toFixed(0)} ms (theirs ${(1000 * len(it.their)).toFixed(0)})`);
    expect(Math.abs(first(it.got.score, 'p').t0 - first(it.their, 'p').t0)).toBeLessThan(0.03);
    expect(Math.abs(len(it.got.score) - len(it.their))).toBeLessThan(0.04);
    // the long closure of a stop that ends a word is that stop's own silence
    for (const text of ['it today', 'a cat today']) {
      const en = copy('en', text, text, 0.4);
      expect(en.after).toEqual(en.before);
    }
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

  it('crosses only some stretches without sounds of its own where it switches', () => {
    // the woman's mouth every other 60 ms: no 5 ms frame louder than both the whole crossing and the man as he is
    const where = (t: number) => Math.floor(t / 0.06) % 2 === 0;
    const full = crossSynth(x, z), part = crossSynth(x, z, where);
    const hop = Math.round(0.005 * FS), E = (y: Float32Array, s: number) => { let e = 0; for (let i = s; i < s + hop; i++) e += y[i] * y[i]; return e; };
    let top = 0;
    for (let s = 0; s + hop <= part.length; s += hop) top = Math.max(top, E(part, s));
    // the man brought to the crossing's level, as the partial crossing does
    const lvl = (y: Float32Array) => { let a = 0, m = 0; for (let s = 0; s + hop <= y.length; s += hop) { const e = E(y, s); if (e > top * 1e-3) { a += e; m++; } } return Math.sqrt(a / Math.max(1, m)); };
    const k = lvl(full) / lvl(x.samples), man = Float32Array.from(x.samples, (v) => v * k);
    let worst = -Infinity;
    for (let s = 0; s + hop <= part.length; s += hop) if (E(part, s) > top * 1e-3) worst = Math.max(worst, 10 * Math.log10(E(part, s) / Math.max(E(full, s), E(man, s))));
    note('cross-synthesis 3', `the woman's mouth every other 60 ms: the loudest 5 ms frame ${worst.toFixed(1)} dB above both the whole crossing and the man as he is`);
    expect(worst).toBeLessThan(1.5);
  });
});
