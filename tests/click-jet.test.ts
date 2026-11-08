import { describe, it, expect } from 'vitest';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { bandPower, note, spectralPeak } from './helpers';

const fs = 48000;
/** the first 8 ms after a click's front opens, and a stretch of the vowel after it */
const release = (c: string, jet: boolean) => {
  const sc = buildScore(textToPhones(`[aˈ${c}a]`, 'it'), { lang: 'it' });
  const p = defaultParams(); p.noise.fricationOn = jet;
  const e = new VoiceEngine(fs, p); e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const en = e as unknown as { clickFrontArea: number; clickAero: { po: number } };
  const blk = 24, out = new Float32Array(Math.round(sc.duration * fs));
  let at = -1;
  for (let i = 0; i < out.length; i += blk) {
    e.process(out.subarray(i, i + blk), Math.min(blk, out.length - i));
    if (at < 0 && en.clickFrontArea > 0.004 && en.clickAero.po < -5 * 980) at = i / fs;
  }
  const v = sc.phones[2];
  return { seg: out.subarray(Math.round((at - 0.001) * fs), Math.round((at + 0.007) * fs)), vowel: out.subarray(Math.round((v.t0 + 0.04) * fs), Math.round((v.t0 + 0.08) * fs)) };
};
const hiss = (r: { seg: Float32Array; vowel: Float32Array }) => 10 * Math.log10(bandPower(r.seg, fs, 3000, 12000, 256) / bandPower(r.vowel, fs, 3000, 12000, 256));

describe('the jet of a click', () => {
  it('the air rushing into the cavity of a dental click hisses, high, as a fricative does', () => {
    const jet = release('ǀ', true), none = release('ǀ', false);
    const peak = spectralPeak(jet.seg, fs, 2000, 12000, 256);
    note('click jet', `[ǀ] release, the 8 ms after the front opens against the vowel above 3 kHz: ${hiss(jet).toFixed(1)} dB with its jet, ${hiss(none).toFixed(1)} dB without; its hiss peaks at ${(peak / 1000).toFixed(1)} kHz`);
    expect(hiss(jet)).toBeGreaterThan(hiss(none) + 10);
    expect(peak).toBeGreaterThan(3000);
  });
});
