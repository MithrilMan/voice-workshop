import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { welch } from '../src/dsp/util/fft';
import { note, loadEnglishLexicon } from './helpers';

/**
 * Above 10 kHz, against what Monson, Lotto & Story (2012, JASA 132) measured
 * on axis in an anechoic room, 44.1 kHz: third-octave levels of the
 * long-term spectrum of normal speech (their Table II, dB SPL at 1 m) and of
 * held voiceless fricatives (their Table III).
 */
const FS = 48000, N = 4096;
const TOP = [10079, 12699, 16000, 20159];
const SPEECH: Record<number, number> = { 1000: 50.4, 10079: 41.9, 12699: 36.7, 16000: 31.5, 20159: 24.8 };
const S: Record<number, number> = { 8000: 53.2, 10079: 51.9, 12699: 46.9, 16000: 41.7, 20159: 34.1 };

function third(w: ArrayLike<number>, c: number): number {
  const lo = c / 2 ** (1 / 6), hi = c * 2 ** (1 / 6);
  let s = 0;
  for (let k = 1; k < w.length; k++) { const f = (k * FS) / N; if (f >= lo && f < hi) s += w[k]; }
  return 10 * Math.log10(s + 1e-30);
}

describe('the top of the spectrum', () => {
  it('speech and /s/ fall above 10 kHz as they were measured', () => {
    loadEnglishLexicon();
    const acc = new Float64Array(N / 2 + 1);
    for (const t of ['The north wind and the sun were disputing which was the stronger, when a traveler came along wrapped in a warm cloak.', 'Is it raining in the city today?', 'A buzz, a hiss and a filter.']) {
      const u = utterance(builtinVoice('man')!.design, textToPhones(t, 'en'), 'en');
      const e = new VoiceEngine(FS, u.params);
      e.snapArticulators(); e.playScore(u.score);
      const n = Math.round((u.score.duration + 0.1) * FS), out = new Float32Array(n);
      e.process(out, n);
      welch(out, N).forEach((v, k) => { acc[k] += v * n; });
    }
    const p = defaultParams(), P = PHONEMES.s;
    p.articulators = { ...p.articulators, ...P.art }; p.abduction = P.abduction; p.voicing = P.voiced; p.phonate = true;
    const e = new VoiceEngine(FS, p);
    e.snapArticulators();
    const s = new Float32Array(Math.round(0.8 * FS));
    e.process(s, s.length);
    const ws = welch(s.subarray(12000), N);
    const speech = TOP.map((f) => third(acc, f) - third(acc, 1000) - (SPEECH[f] - SPEECH[1000]));
    const sib = TOP.map((f) => third(ws, f) - third(ws, 8000) - (S[f] - S[8000]));
    const say = (d: number[]) => TOP.map((f, j) => `${(f / 1000).toFixed(1)} kHz ${d[j] >= 0 ? '+' : ''}${d[j].toFixed(1)}`).join(', ');
    note('high frequencies', `against the measured spectra, dB: speech (a man, three sentences, re 1 kHz) ${say(speech)}; held /s/ (re 8 kHz) ${say(sib)} (before the losses above the plane waves: speech -1.6, +8.2, +17.5, +20.0; /s/ -2.4, +2.6, +17.1, +22.5)`);
    for (let j = 0; j < 3; j++) {
      expect(Math.abs(speech[j]), `speech ${TOP[j]}`).toBeLessThan(6);
      expect(Math.abs(sib[j]), `/s/ ${TOP[j]}`).toBeLessThan(6);
    }
    expect(Math.abs(speech[3])).toBeLessThan(10);
    expect(Math.abs(sib[3])).toBeLessThan(10);
  });
});
