import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  voiceList, voiceKnobs, createVoice, knob, speak, dialogue, toWav, decodeWav, analyse, voiceFromRecordings,
  setDeliveryModel, voiceToJson, voiceFromJson, DeliveryModel,
} from '../src/library';
import { note } from './helpers';

const MODEL = JSON.parse(readFileSync(new URL('../public/delivery/it.json', import.meta.url), 'utf-8')) as DeliveryModel;
const peakOf = (x: ArrayLike<number>) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };

describe('the library', () => {
  it('voices by id or by knobs, kept within their ranges', () => {
    const ids = voiceList().map((v) => v.id);
    expect(ids).toContain('sara');
    expect(ids).toContain('nicola');
    expect(voiceKnobs().length).toBeGreaterThan(50);
    const v = createVoice('sara', { 'speaking.f0': 230, 'body.anatomy.scale': 9 });
    expect(knob(v, 'speaking.f0')).toBe(230);
    expect(knob(v, 'body.anatomy.scale')).toBeLessThan(2);
    expect(() => createVoice('nobody')).toThrow();
    expect(() => createVoice(undefined, { 'no.such.knob': 1 })).toThrow();
    // a voice as a file and back
    expect(voiceFromJson(voiceToJson(v))).toEqual(v);
    expect(createVoice(JSON.parse(voiceToJson(v)))).toEqual(v);
  });

  it('says a text, phonemes of any language, and writes a WAV', () => {
    const v = createVoice();
    const s = speak(v, 'la luna è piena', { lang: 'it', fs: 24000, peak: -1 });
    expect(s.samples.every(Number.isFinite)).toBe(true);
    expect(peakOf(s.samples)).toBeCloseTo(10 ** (-1 / 20), 4);
    expect(s.phones.filter((p) => p.ipa !== '_').map((p) => p.ipa).join('')).toMatch(/^lalunaɛpj[eɛ]na$/);
    expect(s.duration).toBeGreaterThan(0.6);
    // Czech as written in IPA
    const cz = speak(v, '[r̝ɛka]', { lang: 'cs', fs: 24000 });
    expect(cz.phones.some((p) => p.ipa.startsWith('r̝'))).toBe(true);
    const wav = toWav(s), back = decodeWav(wav);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(back.fs).toBe(24000);
    expect(back.samples.length).toBe(s.samples.length);
  });

  it('an emotion moves the pitch and the pace the way listeners hear it', () => {
    const v = createVoice('woman');
    const text = 'oggi andiamo al mare con gli amici';
    const at = (e?: 'joy' | 'sadness') => { const s = speak(v, text, { lang: 'it', fs: 24000, emotion: e }); return { f0: analyse([s]).f0, dur: s.phones[s.phones.length - 1].t1 }; };
    const n = at(), joy = at('joy'), sad = at('sadness');
    note('library', `emotion: f0 ${sad.f0.toFixed(0)} / ${n.f0.toFixed(0)} / ${joy.f0.toFixed(0)} Hz, length ${sad.dur.toFixed(2)} / ${n.dur.toFixed(2)} / ${joy.dur.toFixed(2)} s (sadness / neutral / joy)`);
    expect(joy.f0).toBeGreaterThan(n.f0 * 1.08);
    expect(sad.f0).toBeLessThan(n.f0 * 0.95);
    expect(sad.dur).toBeGreaterThan(n.dur * 1.1);
    expect(joy.dur).toBeLessThan(n.dur);
  });

  it('a learnt way of saying where its model is set, the rules otherwise', () => {
    const sara = createVoice('sara');
    setDeliveryModel(null);
    expect(speak(sara, 'ciao a tutti', { fs: 16000 }).delivery).toBe('rules');
    setDeliveryModel(MODEL);
    const s = speak(sara, 'ciao a tutti', { fs: 16000 });
    expect(s.delivery).toBe('learnt');
    expect(speak(sara, 'hello everyone', { lang: 'en', fs: 16000 }).delivery).toBe('rules');
    setDeliveryModel(null);
  });

  it('a dialogue: voices one after another', () => {
    const a = createVoice('nicola'), b = createVoice('sara');
    const one = speak(a, 'ciao, come stai?', { fs: 16000 }), two = speak(b, 'bene, grazie!', { fs: 16000 });
    const d = dialogue([{ voice: a, text: 'ciao, come stai?' }, { voice: b, text: 'bene, grazie!' }], { fs: 16000, gap: 0.4 });
    expect(d.samples.length).toBe(one.samples.length + two.samples.length + Math.round(0.4 * 16000));
    // the second voice starts after the first and the silence
    const firstOfB = d.phones.find((p, i) => i > 0 && p.t0 >= one.duration);
    expect(firstOfB!.t0).toBeGreaterThanOrEqual(one.duration + 0.4 - 1e-6);
  });

  it('a voice measured and brought toward recordings (here only started)', () => {
    const rec = speak(createVoice('nicola'), 'ieri sera abbiamo guardato la luna', { fs: 16000 });
    const p = analyse([rec]);
    expect(p.f0).toBeGreaterThan(75);
    expect(p.f0).toBeLessThan(115);
    expect(() => voiceFromRecordings([rec], { lang: 'it', texts: ['uno', 'due'] })).toThrow();
    const r = voiceFromRecordings([rec], { lang: 'it', texts: ['ieri sera abbiamo guardato la luna'], stop: () => true });
    expect(r.evaluations).toBeLessThanOrEqual(2);
    expect(r.design.speaking.f0).toBeLessThan(165);
  });
});
