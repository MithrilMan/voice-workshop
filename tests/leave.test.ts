import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { note } from './helpers';

/**
 * A tip that comes away from its closure lets the air out across the whole
 * of its seal: the pressure behind a /t/ or a /d/ is gone some ten
 * milliseconds after the release, also before a high vowel, where the jaw
 * is still up and the tip has only a few millimetres to come down. (Through
 * the narrow channel a held sound is drawn with, a third of the pressure
 * was still there 10 ms later, and the air went on hissing at the teeth.)
 */

const fs = 48000;

/** the pressure behind the stop, against the one at its release, by the milliseconds since the release */
function release(voice: string, text: string, ipa: string): (ms: number) => number {
  const u = utterance(builtinVoice(voice)!.design, textToPhones(text, 'it'), 'it');
  const t = u.score.phones.filter((q) => q.ipa === ipa)[0];
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
  const n = Math.round((u.score.duration + 0.1) * fs), out = new Float32Array(n);
  const po: number[] = [];
  let closed = -1, rel = -1;
  for (let i = 0; i + 48 <= n; i += 48) {
    e.process(out.subarray(i, i + 48), 48);
    const tel = e.telemetry(), time = i / fs;
    po.push(tel.po);
    if (time > t.t0 - 0.02 && closed < 0 && tel.constrictionArea < 0.004) closed = i / 48;
    if (closed >= 0 && rel < 0 && tel.constrictionArea >= 0.004) rel = i / 48;
  }
  if (rel < 0) throw new Error(`no release of ${ipa} in ${text}`);
  return (ms) => po[rel + ms] / po[rel];
}

describe('a tip that leaves its closure', () => {
  it('lets the pressure go in some ten milliseconds, also before a high vowel', () => {
    const rows: string[] = [], got: number[][] = [];
    for (const voice of ['man', 'woman']) {
      for (const [text, ipa] of [['la dita', 'd'], ['la tita', 't'], ['la data', 'd']] as const) {
        const po = release(voice, text, ipa);
        rows.push(`${voice} "${text}" ${(100 * po(10)).toFixed(0)} and ${(100 * po(20)).toFixed(0)} %`);
        got.push([po(10), po(20)]);
      }
    }
    note('a tip that leaves its closure', `of the pressure behind it, 10 and 20 ms after the release: ${rows.join('; ')}`);
    for (const [p10, p20] of got) {
      expect(p10).toBeLessThan(0.2);
      expect(p20).toBeLessThan(0.12);
    }
  });
});
