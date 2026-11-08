import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { constrictionOf } from '../src/dsp/speech/derive';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, EngineParams, Score } from '../src/dsp/engine/params';
import { Setting } from '../src/dsp/voice/setting';
import { rmsDb } from './helpers';

const say = (text: string, setting?: Partial<Setting>) => buildScore(textToPhones(text, 'it'), { lang: 'it', setting });
/** the score's target at the middle of each phone */
const mids = (sc: Score) => sc.phones.map((p) => ({ ipa: p.ipa, f: sc.frames[Math.round((0.5 * (p.t0 + p.t1)) / 0.005)] }));
const render = (sc: Score, edit: (p: EngineParams) => void = () => {}) => {
  const p = defaultParams(); edit(p);
  const e = new VoiceEngine(48000, p);
  e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const out = new Float32Array(Math.round(sc.duration * 48000));
  e.process(out, out.length);
  return out;
};

describe('the voice keeps its habits while it speaks', () => {
  it('no setting is the planner as it was', () => {
    expect(JSON.stringify(say('la luna e le stelle', {}))).toBe(JSON.stringify(say('la luna e le stelle')));
  });

  it('a low larynx and rounded lips stay low and rounded through vowels and consonants', () => {
    const m = mids(say('la luna e le stelle', { larynx: -0.8, lipRound: 0.5 }));
    for (const { ipa, f } of m) expect(f.art!.larynx, ipa).toBeCloseTo(-0.8, 1);
    for (const { ipa, f } of m.filter((x) => 'ae'.includes(x.ipa))) expect(f.art!.lipRound, ipa).toBeGreaterThan(0.4);
  });

  it('a nasal voice lets the velum down on vowels and sonorants, never on an obstruent', () => {
    const m = mids(say('la pasta e il latte', { velum: 0.3 }));
    for (const { ipa, f } of m) {
      if ('aeil'.includes(ipa)) expect(f.art!.velum, ipa).toBeGreaterThanOrEqual(0.3);
      if ('pst'.includes(ipa)) expect(f.art!.velum, ipa).toBe(0);
    }
  });

  it('a whispering speaker whispers words instead of falling silent', () => {
    const whisper = (p: EngineParams) => { p.voicing = false; p.noise.aspiration = 4; };
    // the mean level of the vowels, each in dB (a /t/ burst or an /s/ is loud either way)
    const vowels = (sc: Score) => {
      const out = render(sc, whisper);
      const v = sc.phones.filter((p) => 'aeu'.includes(p.ipa)).map((p) => rmsDb(out.subarray(Math.round(p.t0 * 48000), Math.round(p.t1 * 48000))));
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const mute = vowels(say('la luna e le stelle'));
    const heard = vowels(say('la luna e le stelle', { abduction: 0.42 }));
    expect(heard).toBeGreaterThan(mute + 18);
  });

  it('with every habit pushed to its extreme the stops still close and build their pressure', () => {
    const extreme: Partial<Setting> = { jaw: 0.3, tongueX: 0.5, tongueY: -0.5, tongueRoot: -0.6, lipRound: 1, lipProtrude: 0.6, larynx: -1, velum: 0.4 };
    const sc = say('pa ta ka', extreme);
    for (const { ipa, f } of mids(sc).filter((x) => 'ptk'.includes(x.ipa))) {
      expect(constrictionOf(f.art!).area, ipa).toBeLessThan(0.004);
      expect(f.art!.velum, ipa).toBe(0);
    }
    // in the engine: the pressure behind each closure rises toward the lungs'
    const p = defaultParams();
    const e = new VoiceEngine(48000, p);
    e.snapArticulators(); e.snapPressure(); e.playScore(sc);
    const aero = (e as unknown as { aero: { po: number }; psCur: number });
    const buf = new Float32Array(48);
    const peak: Record<string, number> = { p: 0, t: 0, k: 0 };
    for (let t = 0; t < sc.duration; t += 0.001) {
      e.process(buf, 48);
      const ph = sc.phones.find((x) => t >= x.t0 && t < x.t1);
      if (ph && ph.ipa in peak) peak[ph.ipa] = Math.max(peak[ph.ipa], aero.aero.po / Math.max(1, aero.psCur));
    }
    for (const k of Object.keys(peak)) expect(peak[k], k).toBeGreaterThan(0.6);
  });
});
