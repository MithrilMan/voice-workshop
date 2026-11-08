import { describe, it, expect, beforeAll } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { phonemeFor, passageIn, notesForIpa } from '../src/dsp/speech/derive';
import { loadEnglishLexicon, note, spectralPeak } from './helpers';

const fs = 48000;
type Tel = { second: { area: number }; wallAmp: number; wallAmp2: number };
/** a sentence through the engine: the phones during which a second narrow passage hisses, and the sound */
const run = (text: string, lang: string) => {
  const sc = buildScore(textToPhones(text, lang), { lang });
  const e = new VoiceEngine(fs, defaultParams()); e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const tel = e as unknown as Tel;
  const out = new Float32Array(Math.round(sc.duration * fs));
  const frames: { t: number; on: boolean; ratio: number }[] = [];
  for (let i = 0; i < out.length; i += 48) {
    e.process(out.subarray(i, i + 48), Math.min(48, out.length - i));
    const on = Number.isFinite(tel.second.area);
    frames.push({ t: i / fs, on, ratio: on ? 20 * Math.log10(tel.wallAmp2 / tel.wallAmp) : 0 });
  }
  return { sc, out, frames };
};

describe('ɧ: two hisses at once', () => {
  beforeAll(() => { loadEnglishLexicon(); });

  it('the tip narrows the passage at the ridge and the body at the velum, with air between', () => {
    const a = phonemeFor('ɧ')!.art;
    const front = passageIn(a, [3, 6]), back = passageIn(a, [7.8, 10.6]), between = passageIn(a, [6.2, 7.6]);
    note('ɧ posture', `front passage ${front.toFixed(2)} cm², back ${back.toFixed(2)} cm², at least ${between.toFixed(2)} cm² between them`);
    expect(front).toBeCloseTo(0.1, 1);
    expect(back).toBeGreaterThan(0.08);
    expect(back).toBeLessThan(0.16);
    expect(between).toBeGreaterThan(2.5 * back);
    expect(a.lipRound).toBeGreaterThan(0.3);
    expect(notesForIpa('ɧ')).toEqual([]);
  });

  it('both passages hiss, and the sound is lower than ʃ', () => {
    const sj = run('[ˈaɧa]', 'it'), sh = run('[ˈaʃa]', 'it');
    const mid = (r: ReturnType<typeof run>) => { const p = r.sc.phones[1]; return { t0: p.t0 + 0.25 * (p.t1 - p.t0), t1: p.t0 + 0.75 * (p.t1 - p.t0) }; };
    const m = mid(sj), inMid = sj.frames.filter((f) => f.t >= m.t0 && f.t < m.t1), on = inMid.filter((f) => f.on);
    const ratio = on.reduce((s, f) => s + f.ratio, 0) / Math.max(1, on.length);
    const peak = (r: ReturnType<typeof run>) => { const w = mid(r); return spectralPeak(r.out.subarray(Math.round(w.t0 * fs), Math.round(w.t1 * fs)), fs, 500, 12000, 512); };
    note('ɧ sound', `a second hiss in ${Math.round((100 * on.length) / inMid.length)} % of the middle of [ɧ], ${ratio.toFixed(1)} dB against the first; spectral peak ${(peak(sj) / 1000).toFixed(1)} kHz against ${(peak(sh) / 1000).toFixed(1)} for [ʃ]`);
    expect(on.length / inMid.length).toBeGreaterThan(0.4);
    expect(ratio).toBeGreaterThan(-6);
    expect(peak(sj)).toBeLessThan(peak(sh) - 1000);
  });

  it('ordinary speech has no second hiss', () => {
    for (const [t, l] of [['la luna e le stelle', 'it'], ['scusa, ci sono sei sciarpe rosse', 'it'], ['she sells sea shells by the shore', 'en'], ['[ˈxuʃka ˈʃxola]', 'it']]) {
      expect(run(t, l).frames.filter((f) => f.on).length, t).toBe(0);
    }
  });
});
