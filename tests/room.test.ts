import { describe, it, expect } from 'vitest';
import { CMH2O } from '../src/dsp/constants';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, EngineParams, Score } from '../src/dsp/engine/params';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { loadEnglishLexicon, note } from './helpers';

const fs = 48000;
/** the mouth counts as shut under this, cm² */
const SHUT = 0.005;
interface Step { area: number; behind: number; po: number; flow: number; voicing: number; peak: number; room: number }
/** a saying through the engine, a millisecond at a time; with `room` false, without the room a speaker makes behind a voiced closure */
function run(params: EngineParams, score: Score, room = true): Step[] {
  const sc: Score = room ? score : { ...score, frames: score.frames.map((f) => { const g = { ...f }; delete g.room; return g; }) };
  const e = new VoiceEngine(fs, params);
  e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const made = e as unknown as { roomMade: number };
  const buf = new Float32Array(48), out: Step[] = [];
  for (let t = 0; t < sc.duration + 0.3; t += 0.001) {
    e.process(buf, 48);
    const x = e.telemetry();
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    out.push({ area: x.constrictionArea, behind: x.po / Math.max(1, x.ps), po: x.po / CMH2O, flow: x.uMouth, voicing: x.voicingAmp, peak, room: made.roomMade });
  }
  return out;
}
interface Closure {
  /** how long the mouth is shut, ms */
  ms: number;
  /** the least of the voice and the most of the pressure behind the closure (against the lungs') in its last 10 ms */
  voicing: number; behind: number;
  /** the largest rise of the pressure in 1 ms, from 20 ms before the closure to 30 ms after it, cmH2O */
  jump: number;
  /** the room made when the mouth opens, and what is left of it 0.1 and 0.2 s later, cm³ */
  room: number; later: [number, number];
  /** the most air through the mouth and the highest sample in the 30 ms after the release */
  flow: number; peak: number;
}
/** each time the mouth is shut for at least 15 ms */
function closures(steps: Step[]): Closure[] {
  const out: Closure[] = [];
  let from = -1;
  steps.forEach((s, i) => {
    if (s.area < SHUT) { if (from < 0) from = i; return; }
    if (from >= 0 && i - from >= 15) {
      const end = steps.slice(Math.max(from, i - 10), i), after = steps.slice(i, i + 30);
      let jump = 0;
      for (let j = Math.max(1, from - 20); j < Math.min(steps.length, i + 30); j++) jump = Math.max(jump, steps[j].po - steps[j - 1].po);
      const at = (ms: number) => steps[Math.min(steps.length - 1, i + ms)].room;
      out.push({
        ms: i - from, voicing: Math.min(...end.map((x) => x.voicing)), behind: Math.max(...end.map((x) => x.behind)), jump,
        room: s.room, later: [at(100), at(200)], flow: Math.max(...after.map((x) => x.flow)), peak: Math.max(...after.map((x) => x.peak)),
      });
    }
    from = -1;
  });
  return out;
}
const said = (ipa: string) => buildScore(textToPhones(`[${ipa}]`, 'it'), { lang: 'it' });
const both = (ipa: string, p = defaultParams()) => {
  const sc = said(ipa);
  return { made: closures(run(p, sc)), none: closures(run(p, sc, false)) };
};

describe('the room behind a voiced closure', () => {
  const long = ['ˈabːa', 'ˈadːa', 'ˈagːa'].map((ipa) => ({ ipa, ...both(ipa) }));

  it('keeps the voice of a long one, which dies without it', () => {
    note('room', long.map((x) => `[${x.ipa}] shut ${x.made[0].ms} ms: voice ${x.made[0].voicing.toFixed(2)} and ${x.made[0].behind.toFixed(2)} of the lungs' pressure behind it at its end, with ${x.made[0].room.toFixed(1)} cm³ of room made (${x.none[0].voicing.toFixed(2)} and ${x.none[0].behind.toFixed(2)} without)`).join('; '));
    for (const x of long) {
      expect(x.made.length).toBe(1);
      expect(x.made[0].ms).toBeGreaterThan(60);
      expect(x.made[0].voicing).toBeGreaterThan(0.35);
      expect(x.made[0].behind).toBeLessThan(0.6);
      expect(x.made[0].room).toBeGreaterThan(3);
      expect(x.none[0].voicing).toBeLessThan(0.2);
      expect(x.none[0].behind).toBeGreaterThan(0.65);
    }
  });

  it('is not made behind a short one, which builds its pressure as it did', () => {
    for (const ipa of ['ˈaba', 'ˈada']) {
      const { made, none } = both(ipa);
      expect(made[0].ms).toBeLessThan(50);
      expect(made[0].room).toBeLessThan(0.5);
      expect(Math.abs(made[0].voicing - none[0].voicing)).toBeLessThan(0.05);
      expect(Math.abs(made[0].behind - none[0].behind)).toBeLessThan(0.05);
      expect(made[0].behind).toBeGreaterThan(0.4);
    }
  });

  it('has nothing sudden in it: no jump of the pressure, no knock at the release', () => {
    note('room 2', long.map((x) => `[${x.ipa}] largest rise of the pressure in 1 ms ${x.made[0].jump.toFixed(2)} cmH2O (${x.none[0].jump.toFixed(2)} without), highest sample after the release ${x.made[0].peak.toFixed(3)} (${x.none[0].peak.toFixed(3)})`).join('; '));
    for (const x of long) {
      expect(x.made[0].jump).toBeLessThanOrEqual(x.none[0].jump + 0.1);
      expect(x.made[0].peak).toBeLessThanOrEqual(1.1 * x.none[0].peak);
      expect(x.made[0].flow).toBeLessThanOrEqual(1.02 * x.none[0].flow);
    }
  });

  it('is given back slowly, and made again for the next closure', () => {
    for (const x of long) {
      const [soon, late] = x.made[0].later.map((v) => v / x.made[0].room);
      expect(soon).toBeGreaterThan(0.25);
      expect(soon).toBeLessThan(0.6);
      expect(late).toBeLessThan(0.3);
    }
    const two = both('ˈabːabːa');
    note('room 3', `[ˈabːa] gives back its ${long[0].made[0].room.toFixed(1)} cm³: ${long[0].made[0].later.map((v) => v.toFixed(1)).join(' and ')} left 0.1 and 0.2 s after the release; [ˈabːabːa] voice at the end of each closure ${two.made.map((c) => c.voicing.toFixed(2)).join(' ')} (${two.none.map((c) => c.voicing.toFixed(2)).join(' ')} without)`);
    expect(two.made.length).toBe(2);
    for (const c of two.made) expect(c.voicing).toBeGreaterThan(0.35);
    for (const c of two.none) expect(c.voicing).toBeLessThan(0.2);
  });

  it('is larger for a voice whose folds leak', () => {
    const leaky = defaultParams();
    leaky.source.chink = 0.04;
    const got = long.map((x) => ({ ipa: x.ipa, tight: x.made[0], ...both(x.ipa, leaky) }));
    note('room 4', `folds that leak (a chink of 0.04 cm²): ${got.map((x) => `[${x.ipa}] voice ${x.made[0].voicing.toFixed(2)} with ${x.made[0].room.toFixed(1)} cm³ (${x.tight.room.toFixed(1)} for folds that shut; ${x.none[0].voicing.toFixed(2)} without the room)`).join('; ')}`);
    for (const x of got) {
      expect(x.made[0].voicing).toBeGreaterThan(0.35);
      expect(x.made[0].room).toBeGreaterThan(1.3 * x.tight.room);
      expect(x.none[0].voicing).toBeLessThan(0.1);
    }
  });
});

describe('a tap', () => {
  it('is a flick of the tip however long its time', () => {
    loadEnglishLexicon();
    const man = builtinVoice('man')!.design;
    const phones = textToPhones('the city', 'en');
    const plain = utterance(man, phones, 'en');
    const shut = [1, 4].map((by) => {
      const stretch = plain.score.phones.filter((p) => p.ipa !== '_').map((p) => (p.ipa === 'ɾ' ? by : 1));
      const u = utterance(man, phones, 'en', { timing: { stretch, pauses: [] } });
      const tap = u.score.phones.filter((p) => p.ipa === 'ɾ');
      expect(tap.length).toBe(1);
      const steps = run(u.params, u.score);
      const about = steps.slice(Math.round(1000 * tap[0].t0) - 30, Math.round(1000 * tap[0].t1) + 30);
      return { ms: about.filter((x) => x.area < SHUT).length, time: 1000 * (tap[0].t1 - tap[0].t0) };
    });
    note('tap', `the tap of "the city": shut ${shut[0].ms} ms in its ${shut[0].time.toFixed(0)} ms, ${shut[1].ms} ms when given ${shut[1].time.toFixed(0)} ms`);
    expect(shut[1].time).toBeGreaterThan(3 * shut[0].time);
    for (const s of shut) {
      expect(s.ms).toBeGreaterThanOrEqual(5);
      expect(s.ms).toBeLessThanOrEqual(15);
    }
  });
});
