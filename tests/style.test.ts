import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { DEFAULT_STYLE, ProsodyStyle } from '../src/dsp/speech/style';
import { Score } from '../src/dsp/engine/params';

const say = (text: string, style: Partial<ProsodyStyle> = {}) => buildScore(textToPhones(text, 'it'), { lang: 'it', style });
/** the frame at a time */
const at = (sc: Score, t: number) => sc.frames[Math.min(sc.frames.length - 1, Math.round(t / 0.005))];
/** the last vowel: its middle, just before its end, and its length */
const lastVowel = (sc: Score) => { const v = sc.phones.filter((p) => /[aeiou]/.test(p.ipa)).pop()!; return { mid: 0.5 * (v.t0 + v.t1), end: v.t1 - 0.01, dur: v.t1 - v.t0 }; };
const meanF0 = (sc: Score) => { const f = sc.frames.filter((x) => x.t < sc.duration && x.ps > 0); return f.reduce((a, x) => a + x.f0, 0) / f.length; };

describe('a way of speaking', () => {
  it('the default style is the planner as it was', () => {
    expect(JSON.stringify(say('la luna e le stelle'))).toBe(JSON.stringify(say('la luna e le stelle', { ...DEFAULT_STYLE })));
  });

  it('every knob moves what it says', () => {
    const text = 'la luna e le stelle';
    const base = say(text);
    const end = (sc: Score) => at(sc, lastVowel(sc).end);
    // a deeper final fall ends lower
    expect(end(say(text, { finalFall: 6 })).f0).toBeLessThan(end(base).f0 * 0.93);
    // a stronger question rise ends higher
    const q = 'piove oggi?';
    expect(at(say(q, { questionRise: 14 }), say(q).duration - 0.06).f0).toBeGreaterThan(at(say(q), say(q).duration - 0.06).f0 * 1.1);
    // a lower floor lowers the whole voice
    expect(meanF0(say(text, { floor: 8 }))).toBeLessThan(meanF0(base) * 0.85);
    // no final lengthening: a shorter last vowel
    expect(lastVowel(say(text, { finalLengthening: 0 })).dur).toBeLessThan(lastVowel(base).dur * 0.85);
    // longer pauses: a longer utterance
    expect(say('ciao, come stai?', { pauseShort: 0.4 }).duration).toBeGreaterThan(say('ciao, come stai?').duration + 0.2);
    // no declination: more pressure at the end
    const late = (sc: Score) => at(sc, sc.duration * 0.6).ps;
    expect(late(say(text, { declination: 0 }))).toBeGreaterThan(late(base) * 1.05);
    // a breathier end
    expect(end(say(text, { endRd: 1.5 })).rd!).toBeGreaterThan(end(base).rd! + 0.3);
    // flutter goes to the engine
    expect(say(text, { flutter: 60 }).flutter).toBe(60);
  });

  it('the breath falls over each sentence and is taken again at a full stop', () => {
    // how much of the pressure the declination has left at a time
    const left = (text: string, t: (sc: Score) => number) => { const sc = say(text), flat = say(text, { declination: 0 }); return at(sc, t(sc)).ps / at(flat, t(sc)).ps; };
    const second = (sc: Score) => sc.phones.filter((p) => p.ipa === 'l')[2].t0 + 0.02;
    expect(left('la luna. le stelle', second)).toBeGreaterThan(0.97);
    expect(left('la luna, le stelle', second)).toBeLessThan(0.95);
    // one sentence: the fall takes all of it, as before
    expect(left('la luna e le stelle', (sc) => sc.duration - 0.1)).toBeLessThan(1 - 0.9 * DEFAULT_STYLE.declination);
  });
});

describe('creak', () => {
  it('a voice that ends its statements in creak drops into slow, irregular pulses', async () => {
    const { VoiceEngine } = await import('../src/dsp/engine/engine');
    const { defaultParams } = await import('../src/dsp/engine/params');
    const run = (endCreak: number) => {
      const sc = say('la luna e le stelle', { endCreak });
      const e = new VoiceEngine(48000, defaultParams());
      e.snapArticulators(); e.snapPressure(); e.playScore(sc);
      const lf = (e as unknown as { lf: { periodF0: number } }).lf;
      const priv = e as unknown as { periodAmp: number };
      const out = new Float32Array(48);
      const f0: number[] = [], amp: number[] = [];
      const v = lastVowel(sc);
      for (let t = 0; t < sc.duration; t += 0.001) {
        e.process(out, 48);
        if (t > v.end - 0.08 && t < v.end) { f0.push(lf.periodF0); amp.push(priv.periodAmp); }
      }
      const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
      const sd = (x: number[]) => Math.sqrt(mean(x.map((y) => (y - mean(x)) ** 2)));
      return { f0: mean(f0), ampSd: sd(amp), frames: sc.frames.filter((f) => (f.creak ?? 0) > 0).length };
    };
    const modal = run(0), fry = run(1);
    expect(modal.frames).toBe(0);
    expect(fry.frames).toBeGreaterThan(20);
    expect(fry.f0).toBeLessThan(modal.f0 * 0.75);
    expect(fry.ampSd).toBeGreaterThan(modal.ampSd * 2);
  });

  it('a question does not end in creak, a creaky vowel creaks', () => {
    expect(say('piove oggi?', { endCreak: 1 }).frames.some((f) => (f.creak ?? 0) > 0)).toBe(false);
    expect(buildScore(textToPhones('[ˈpa̰]', 'it')).frames.some((f) => (f.creak ?? 0) > 0)).toBe(true);
  });
});
