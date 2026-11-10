import { describe, it, expect } from 'vitest';
import { voicePrint, Clip } from '../src/dsp/analysis/voiceprint';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { fitVoice, say, distance } from '../src/dsp/voice/fit';
import { note, loadEnglishLexicon } from './helpers';

const FS = 24000;

/** a buzz through two resonances, its pitch gliding from f0a to f0b */
function buzz(f0a: number, f0b: number, seconds: number): Clip {
  const n = Math.round(seconds * FS), x = new Float32Array(n);
  let phase = 0;
  const res = [[700, 80], [1200, 90]].map(([f, bw]) => { const r = Math.exp((-Math.PI * bw) / FS); return { a1: 2 * r * Math.cos((2 * Math.PI * f) / FS), a2: -r * r, y1: 0, y2: 0 }; });
  for (let i = 0; i < n; i++) {
    const f0 = f0a * (f0b / f0a) ** (i / n);
    phase += f0 / FS;
    let v = 0;
    if (phase >= 1) { phase -= 1; v = 1; }
    for (const r of res) { const y = v + r.a1 * r.y1 + r.a2 * r.y2; r.y2 = r.y1; r.y1 = y; v = y; }
    x[i] = 0.01 * v;
  }
  return { samples: x, fs: FS };
}

function held(sym: string, voice = 'man'): Clip {
  const p = defaultParams();
  const P = PHONEMES[sym];
  Object.assign(p.anatomy, builtinVoice(voice)!.design.body.anatomy);
  p.articulators = { ...p.articulators, ...P.art };
  p.source.f0 = voice === 'man' ? 110 : 210;
  p.abduction = P.abduction; p.voicing = true; p.phonate = true;
  const e = new VoiceEngine(FS, p);
  e.snapArticulators();
  const out = new Float32Array(FS);
  e.process(out, out.length);
  return { samples: out.subarray(FS / 4), fs: FS };
}

describe('measuring a voice', () => {
  it('finds the pitch of a buzz and how far it moves', () => {
    const steady = voicePrint([buzz(140, 140, 1.5)]);
    const glide = voicePrint([buzz(100, 200, 2)]);
    expect(Math.abs(steady.f0 / 140 - 1)).toBeLessThan(0.01);
    expect(steady.f0Sd).toBeLessThan(0.2);
    // over a glide of an octave the 5th and 95th percentiles lie near its ends
    expect(Math.abs(12 * Math.log2(glide.f0Low / 100))).toBeLessThan(1.5);
    expect(Math.abs(12 * Math.log2(glide.f0High / 200))).toBeLessThan(1.5);
  });

  it('finds the formants of a held vowel, and those of a smaller head higher', () => {
    const a = voicePrint([held('a')]), w = voicePrint([held('a', 'woman')]);
    note('voiceprint formants', `held /a/ (the waveguide's own 729/1298/2594): ${a.formants.slice(0, 3).map((f) => f.toFixed(0)).join('/')} Hz; the woman's head ${w.formants.slice(0, 3).map((f) => f.toFixed(0)).join('/')} Hz`);
    expect(Math.abs(a.formants[0] / 729 - 1)).toBeLessThan(0.08);
    expect(Math.abs(a.formants[1] / 1298 - 1)).toBeLessThan(0.06);
    for (let j = 0; j < 3; j++) expect(w.formants[j]).toBeGreaterThan(a.formants[j] * 1.05);
  });
});

describe('fitting a voice to a recording', () => {
  it('brings a starting voice toward one it has not been told', () => {
    // the recording is one of the simulator's own voices: what the fit
    // finds can be checked against what made it
    loadEnglishLexicon();
    const material = [{ phones: textToPhones('Is it raining in the city today? Not at all.', 'en'), lang: 'en' }];
    const target = voicePrint(say(builtinVoice('sky')!.design, material, FS));
    const start = builtinVoice('woman')!.design;
    const res = fitVoice(target, material, { sameText: true, start, effort: 0.3 });
    note('voice fit', `the Sky-like voice from the woman's, one sentence, effort 0.3: distance ${res.startDistance.toFixed(2)} -> ${res.distance.toFixed(2)} in ${res.evaluations} evaluations; pitch ${res.print.f0.toFixed(0)} Hz (target ${target.f0.toFixed(0)}), usual pitch set ${res.design.speaking.f0} (made with 172)`);
    expect(res.distance).toBeLessThan(0.6 * res.startDistance);
    expect(Math.abs(12 * Math.log2(res.print.f0 / target.f0))).toBeLessThan(0.5);
    expect(distance(target, target, null, true)).toBe(0);
  }, 240000);
});
