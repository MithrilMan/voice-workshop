import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, EngineParams } from '../src/dsp/engine/params';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { note, rmsDb, spectralCentroid } from './helpers';

const fs = 48000;
/** the quietest 10 ms of a consonant and its middle, against the loudest 10 ms of the vowel before it, dB */
const closure = (ipa: string, walls?: number) => {
  const sc = buildScore(textToPhones(`[ˈa${ipa}a]`, 'it'), { lang: 'it' });
  const p = defaultParams(); if (walls !== undefined) p.wallRadiation = walls;
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const out = new Float32Array(Math.round(sc.duration * fs)); e.process(out, out.length);
  const c = sc.phones[1], v = sc.phones[0];
  const win = (t: number) => out.subarray(Math.round(t * fs), Math.round((t + 0.01) * fs));
  let quiet = Infinity, top = -Infinity;
  for (let t = c.t0; t + 0.01 <= c.t1; t += 0.005) quiet = Math.min(quiet, rmsDb(win(t)));
  for (let t = v.t0; t + 0.01 <= v.t1; t += 0.005) top = Math.max(top, rmsDb(win(t)));
  const mid = out.subarray(Math.round((c.t0 + 0.3 * (c.t1 - c.t0)) * fs), Math.round((c.t0 + 0.7 * (c.t1 - c.t0)) * fs));
  return { quiet: quiet - top, mid };
};
const held = (v: string, edit: (p: EngineParams) => void = () => {}) => {
  const p = defaultParams(); p.phonate = true; edit(p);
  p.articulators = { ...p.articulators, ...PHONEMES[v].art };
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure();
  const out = new Float32Array(fs); e.process(out, out.length);
  return rmsDb(out.subarray(fs / 2));
};

describe('the walls are heard through the skin', () => {
  it('a voiced closure hums low through the walls; a voiceless one stays silent', () => {
    const b = closure('b'), d = closure('d'), g = closure('g'), p = closure('p'), mute = closure('b', 0);
    const bar = [b, d, g].map((x) => x.quiet);
    const hum = spectralCentroid(b.mid, fs, 50, 8000, 512);
    note('voice bar', `quietest 10 ms of the closure against the vowel: /b/ ${b.quiet.toFixed(0)}, /d/ ${d.quiet.toFixed(0)}, /g/ ${g.quiet.toFixed(0)} dB (/b/ ${mute.quiet.toFixed(0)} dB with the walls unheard), /p/ ${p.quiet.toFixed(0)} dB; the hum of /b/ centred at ${hum.toFixed(0)} Hz`);
    for (const q of bar) { expect(q).toBeGreaterThan(-32); expect(q).toBeLessThan(-15); }
    expect(mute.quiet).toBeLessThan(-60);
    expect(p.quiet).toBeLessThan(-50);
    // a low hum: the walls carry the voice's lowest harmonics
    expect(hum).toBeLessThan(600);
  });

  it('a held close vowel is no longer far below an open one, and a nasal keeps its level', () => {
    const a = held('a'), u = held('u'), i = held('i'), m = held('m');
    const u0 = held('u', (p) => { p.wallRadiation = 0; }) - held('a', (p) => { p.wallRadiation = 0; });
    note('vowel levels', `held, against /a/: /i/ ${(i - a).toFixed(1)} dB, /u/ ${(u - a).toFixed(1)} dB (${u0.toFixed(1)} with the walls unheard), /m/ ${(m - a).toFixed(1)} dB`);
    expect(u - a).toBeGreaterThan(-10);
    expect(u - a).toBeGreaterThan(u0 + 2);
    expect(i - a).toBeGreaterThan(-5);
    // a held /m/ stays 7-9 dB below /a/ (Fletcher 1953)
    expect(m - a).toBeLessThan(-6.5);
    expect(m - a).toBeGreaterThan(-9.5);
  });
});
