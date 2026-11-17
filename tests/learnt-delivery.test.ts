import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeliveryModel, DeliveryNet, Heard } from '../src/dsp/speech/deliveryNet';
import type { Phone } from '../src/dsp/speech/g2p';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { withField } from '../src/dsp/voice/design';
import { withEmotion } from '../src/dsp/voice/emotion';
import { setDeliveryModel, deliveryModel } from '../src/dsp/voice/interpret';
import { utterance } from '../src/dsp/voice/utterance';
import { note } from './helpers';

const MODEL = JSON.parse(readFileSync(new URL('../public/delivery/it.json', import.meta.url), 'utf-8')) as DeliveryModel;
/** the answers of the network that learnt it (PyTorch, single precision) on one sentence */
const CHECK = JSON.parse(readFileSync(new URL('./fixtures/delivery-check.json', import.meta.url), 'utf-8')) as {
  speaker: number; rows: (Record<string, unknown> & { ownDur: number; ownPause: number; ownF0: number[] })[]; y: number[][];
};

/** the sounds of a score, no pauses */
const sounds = (sc: { phones: { ipa: string; t0: number; t1: number }[] }) => sc.phones.filter((p) => p.ipa !== '_');

describe('a delivery learnt from recordings', () => {
  beforeAll(() => setDeliveryModel(MODEL));

  it('reads a sentence as the network that learnt it does', () => {
    const net = new DeliveryNet(MODEL);
    const heard: Heard[] = CHECK.rows.map((r) => ({ phone: r as unknown as Phone, dur: r.ownDur, pause: r.ownPause, st: r.ownF0 as [number, number, number] }));
    const said = net.say(heard, CHECK.speaker);
    let worst = 0;
    said.forEach((s, j) => {
      const y = CHECK.y[j];
      const ours = [Math.log(s.dur / 0.08), ...s.st.map((x) => x / 12), ...s.swell];
      const theirs = [y[0], y[2], y[3], y[4], y[5], y[6], y[7]];
      ours.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - theirs[k])); });
      // (a pause below nothing is none)
      if (y[1] > 0) worst = Math.max(worst, Math.abs(Math.log1p(s.pause / 0.05) - y[1]));
    });
    note('learnt delivery', `largest difference from the network that learnt it: ${worst.toExponential(2)} (weights in half precision)`);
    expect(worst).toBeLessThan(0.02);
  });

  it('gives a voice the speaker’s timing and melody around its own pitch, and keeps every sound', () => {
    const text = 'Domani mattina andiamo al mercato a comprare il pane, poi torniamo a casa.';
    const sara = builtinVoice('sara')!.design;
    const ph = textToPhones(text, 'it');
    const learnt = utterance(sara, ph, 'it').score, rules = utterance(withField(sara, 'speaking.delivery', 'rules'), ph, 'it').score;
    const a = sounds(learnt), b = sounds(rules);
    expect(a.map((p) => p.ipa)).toEqual(b.map((p) => p.ipa));
    // not the rules' timing
    const moved = a.reduce((s, p, i) => s + Math.abs(Math.log((p.t1 - p.t0) / (b[i].t1 - b[i].t0))), 0) / a.length;
    // the melody: around the voice's usual pitch, within a speaker's range
    const voiced = learnt.frames.filter((f) => f.t > a[0].t0 && f.t < a[a.length - 1].t1 && f.ps > 0.5);
    const st = voiced.map((f) => 12 * Math.log2(f.f0 / sara.speaking.f0)).sort((x, y) => x - y);
    const median = st[st.length >> 1], low = st[Math.floor(0.05 * st.length)], high = st[Math.floor(0.95 * st.length)];
    note('learnt delivery', `"${text}": ${learnt.duration.toFixed(2)} s (rules ${rules.duration.toFixed(2)} s), sounds ${(100 * (Math.exp(moved) - 1)).toFixed(0)} % off the rules' on average; pitch median ${median.toFixed(1)} st from the voice's, 5-95 % ${low.toFixed(1)} .. ${high.toFixed(1)} st`);
    expect(moved).toBeGreaterThan(0.05);
    expect(Math.abs(median)).toBeLessThan(3);
    expect(high - low).toBeGreaterThan(3);
    expect(high - low).toBeLessThan(18);
    expect(learnt.duration).toBeGreaterThan(0.6 * rules.duration);
    expect(learnt.duration).toBeLessThan(1.6 * rules.duration);
  });

  it('its melody widened by the range and by an emotion', () => {
    const sara = builtinVoice('sara')!.design;
    const ph = textToPhones('Domani mattina andiamo al mercato.', 'it');
    const spread = (d: typeof sara) => {
      const sc = utterance(d, ph, 'it').score;
      const st = sc.frames.filter((f) => f.ps > 0.5).map((f) => 12 * Math.log2(f.f0 / d.speaking.f0)).sort((x, y) => x - y);
      return st[Math.floor(0.95 * st.length)] - st[Math.floor(0.05 * st.length)];
    };
    const one = spread(sara), two = spread(withField(sara, 'speaking.range', 2));
    const joy = withEmotion(sara, 'joy'), sad = withEmotion(sara, 'sadness');
    note('learnt delivery', `melody 5-95 %: ${one.toFixed(1)} st, range 2: ${two.toFixed(1)} st, joy ${spread(joy).toFixed(1)} st, sadness ${spread(sad).toFixed(1)} st`);
    expect(two / one).toBeGreaterThan(1.8);
    expect(two / one).toBeLessThan(2.2);
    expect(spread(joy)).toBeGreaterThan(one);
    expect(spread(sad)).toBeLessThan(one);
  });

  it('the rules where it has no model or the voice asks for them, and for a copy of a recording', () => {
    const sara = builtinVoice('sara')!.design;
    expect(deliveryModel('it')).not.toBeNull();
    expect(deliveryModel('en')).toBeNull();
    const ph = textToPhones('la luna è piena', 'it');
    const rules = utterance(withField(sara, 'speaking.delivery', 'rules'), ph, 'it').score;
    const timing = { stretch: sounds(rules).map(() => 1), pauses: [] };
    expect(utterance(sara, ph, 'it', { timing, seed: 1 }).score.duration).toBeCloseTo(utterance(withField(sara, 'speaking.delivery', 'rules'), ph, 'it', { timing, seed: 1 }).score.duration, 6);
    const en = textToPhones('the moon is full', 'en');
    expect(utterance(sara, en, 'en', { seed: 1 }).score.duration).toBeCloseTo(utterance(withField(sara, 'speaking.delivery', 'rules'), en, 'en', { seed: 1 }).score.duration, 6);
  });
});
