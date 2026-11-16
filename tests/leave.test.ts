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

  it('only right after its own release: a stop shut after a trill lets the air out by its own passage', () => {
    // while the body of the tongue closes for the first /k/ after an /r/ (from the start of the /k/ to its shut), how
    // much wider than the narrowest passage of the tract the passage given to the air is (it glides to each measure of
    // the shape, so while the tract shuts fast it is a few times wider): a dorsal seal is not left across, and the
    // trill's contacts are parted by its spring
    const widest = (voice: string, text: string) => {
      const u = utterance(builtinVoice(voice)!.design, textToPhones(text, 'it'), 'it');
      const ph = u.score.phones, r = ph.findIndex((q) => q.ipa.startsWith('r'));
      const k = ph.find((q, i) => i > r && q.ipa.startsWith('k'))!;
      const e = new VoiceEngine(fs, u.params);
      e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
      const out = new Float32Array(48);
      let most = 0;
      for (let i = 0; i < Math.round((k.t1 + 0.02) * 1000); i++) {
        e.process(out, 48);
        const tel = e.telemetry();
        if (i < Math.round(k.t0 * 1000)) continue;
        if (tel.constrictionArea < 0.004) break;
        if (tel.constrictionArea < 0.3) most = Math.max(most, tel.airPassage / tel.constrictionArea);
      }
      return most;
    };
    const rows: string[] = [], got: number[] = [];
    for (const voice of ['man', 'woman']) {
      for (const text of ['la rocca', 'Il nonno racconta sempre la stessa storia.', '[la ˈrɔkka]', '[il ˈnɔnno rakˈkonta]']) {
        const w = widest(voice, text);
        rows.push(`${voice} "${text}" ${w.toFixed(2)}`);
        got.push(w);
      }
    }
    note('a closure after a trill', `passage of the air against the narrowest of the tract, at most, while the /k/ shuts: ${rows.join('; ')}`);
    // (when the time since the last contact of the trill ran only while a leave applied, the tip that trilled was taken
    // to leave its seal 100 ms later, while the /k/ shut: the air was given a passage up to 8 times wider, and at the shut
    // it was cut off at once, a click; 10 to 20 times the narrowest passage where it happened, 3.5 to 6 since)
    for (const w of got) expect(w).toBeLessThan(8);
  });
});
