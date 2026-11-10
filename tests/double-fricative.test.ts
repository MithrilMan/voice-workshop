import { describe, it, expect, beforeAll } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { phonemeFor, passageIn, notesForIpa } from '../src/dsp/speech/derive';
import { bandPower, loadEnglishLexicon, note } from './helpers';

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
    // how much of the hiss lies low, where the back passage and the cavity between the two put it: 0.8-2 kHz against 2.5-6 kHz
    // (ɧ has two humps of much the same height, near 1.3 and 4.8 kHz: which of them is the peak turns on the noise of the moment)
    const low = (r: ReturnType<typeof run>) => { const w = mid(r), x = r.out.subarray(Math.round(w.t0 * fs), Math.round(w.t1 * fs)); return 10 * Math.log10(bandPower(x, fs, 800, 2000, 512) / bandPower(x, fs, 2500, 6000, 512)); };
    note('ɧ sound', `a second hiss in ${Math.round((100 * on.length) / inMid.length)} % of the middle of [ɧ], ${ratio.toFixed(1)} dB against the first; 0.8-2 kHz against 2.5-6 kHz ${low(sj).toFixed(1)} dB, ${low(sh).toFixed(1)} dB for [ʃ]`);
    expect(on.length / inMid.length).toBeGreaterThan(0.4);
    expect(ratio).toBeGreaterThan(-6);
    expect(low(sj)).toBeGreaterThan(low(sh) + 6);
  });

  it('ordinary speech has no second hiss', () => {
    for (const [t, l] of [['la luna e le stelle', 'it'], ['scusa, ci sono sei sciarpe rosse', 'it'], ['she sells sea shells by the shore', 'en'], ['[ˈxuʃka ˈʃxola]', 'it']]) {
      expect(run(t, l).frames.filter((f) => f.on).length, t).toBe(0);
    }
  });
});
