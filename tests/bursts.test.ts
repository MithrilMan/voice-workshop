import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { textToPhones } from '../src/dsp/speech/g2p';
import { passageIn, constrictionOf } from '../src/dsp/speech/derive';
import type { Articulators } from '../src/dsp/tract/types';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { note, loadEnglishLexicon, bandPower } from './helpers';

/**
 * How loud the burst of a stop is against the vowel that follows.
 *
 * Measured the way Nicolaidis, Sfakianaki, Vlahavas & Kafentzis (2019, ICPhS,
 * "An acoustic study of Greek voiceless stops") measured it on unaspirated
 * /p t k/ before /a/ and /i/: the RMS of a 10 ms Hamming window centred on
 * the onset of the burst, less that of a 30 ms window at the start of the
 * vowel. They found /p/ -11.2 dB before /a/ and -11.0 before /i/, /t/ -10.7
 * and -13.0, /k/ -5.9 and -11.1; and the voice starting 16 and 14 ms after
 * the release of /p/, 12 and 23 after /t/, 30 and 63 after /k/.
 */

const fs = 48000;
const GREEK: Record<string, [number, number]> = { pa: [-11.2, 16], pi: [-11.0, 14], ta: [-10.7, 12], ti: [-13.0, 23], ka: [-5.9, 30], ki: [-11.1, 63] };

function burst(text: string, ipa: string, pop = true): { rel: number; vot: number } {
  const u = utterance(builtinVoice('man')!.design, textToPhones(text, 'it'), 'it');
  u.params.noise.burstOn = pop;
  const t = u.score.phones.filter((q) => q.ipa === ipa)[0];
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
  const n = Math.round((u.score.duration + 0.1) * fs), out = new Float32Array(n);
  let closed = false, release = -1, onset = -1;
  for (let i = 0; i + 48 <= n; i += 48) {
    e.process(out.subarray(i, i + 48), 48);
    const tel = e.telemetry(), time = i / fs;
    if (time > t.t0 - 0.02 && tel.constrictionArea < 0.005) closed = true;
    if (closed && release < 0 && tel.constrictionArea > 0.005) release = time;
    if (release > 0 && onset < 0 && tel.voicingAmp > 0.5) onset = time;
  }
  const win = (at: number, len: number) => {
    const m = Math.round(len * fs), a = Math.round(at * fs);
    let s = 0, w2 = 0;
    for (let i = 0; i < m; i++) { const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (m - 1)); s += (w * (out[a + i] ?? 0)) ** 2; w2 += w * w; }
    return 10 * Math.log10(s / w2 + 1e-14);
  };
  // the onset of the burst as it is seen on a waveform: the first millisecond within 15 dB of its loudest one, before the voice
  const ms = (at: number) => { let q = 0; for (let i = Math.round(at * fs); i < Math.round(at * fs) + 48; i++) q += (out[i] ?? 0) ** 2; return q / 48; };
  const end = Math.max(release + 0.004, Math.min(onset, release + 0.04));
  let top = 0;
  for (let at = release - 0.001; at < end; at += 0.0005) top = Math.max(top, ms(at));
  let seen = release;
  for (let at = release - 0.001; at < end; at += 0.0005) if (ms(at) > top * 0.0316) { seen = at; break; }
  return { rel: win(seen - 0.005, 0.01) - win(onset, 0.03), vot: onset - release };
}

/** where the mouth is shut when the stop is let go: the front edge of the contact, which ends the cavity the burst rings in, cm from the lips */
function shutAt(text: string, ipa: string): number {
  const u = utterance(builtinVoice('man')!.design, textToPhones(text, 'it'), 'it');
  const t = u.score.phones.filter((q) => q.ipa === ipa)[0];
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
  const block = new Float32Array(48);
  let last: Articulators | undefined;
  for (let i = 0; i < (u.score.duration + 0.1) * fs; i += 48) {
    e.process(block, 48);
    const shut = e.telemetry().constrictionArea < 0.005;
    if (i / fs > t.t0 - 0.02 && shut) last = { ...(e as unknown as { art: Articulators }).art };
    else if (last) break;
  }
  if (!last) return -1;
  // (the tip is shut in the engine by a finer grid than the one measured here: as narrow as the narrowest, to 0.02 cm²)
  const least = Math.max(0, constrictionOf(last).area) + 0.02;
  for (let x = 1; x < 14; x += 0.1) if (passageIn(last, [x - 0.2, x + 0.2]) < least) return x;
  return -1;
}

/**
 * every /t/ of a word as the studio plays it: its burst against the start of its vowel (as above),
 * for how many milliseconds its hiss stays within 10 dB of that start, when the voice begins,
 * how much of the noise before it lies below 3 kHz, and by how much its first 15 ms stand over the rest
 */
function hisses(text: string, lang: string): { rel: number; loud: number; vot: number; low: number; step: number }[] {
  const u = utterance(builtinVoice('man')!.design, textToPhones(text, lang), lang);
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.playScore(u.score);
  const n = Math.round((u.score.duration + 0.2) * fs), out = new Float32Array(n);
  const tel: { area: number; voice: number }[] = [];
  for (let i = 0; i + 48 <= n; i += 48) { e.process(out.subarray(i, i + 48), 48); const x = e.telemetry(); tel.push({ area: x.constrictionArea, voice: x.voicingAmp }); }
  const win = (at: number, len: number) => {
    const m = Math.round(len * fs), a = Math.round(at * fs);
    let s = 0, w2 = 0;
    for (let i = 0; i < m; i++) { const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (m - 1)); s += (w * (out[a + i] ?? 0)) ** 2; w2 += w * w; }
    return 10 * Math.log10(s / w2 + 1e-14);
  };
  const ms = (i: number) => { let q = 0; for (let k = i * 48; k < (i + 1) * 48; k++) q += out[k] * out[k]; return 10 * Math.log10(q / 48 + 1e-14); };
  const rows = [];
  for (const p of u.score.phones) {
    if (p.ipa !== 't') continue;
    let closed = false, release = -1, onset = -1;
    for (let i = Math.max(0, Math.round(p.t0 * 1000) - 20); i < tel.length && onset < 0; i++) {
      if (tel[i].area < 0.005) closed = true;
      if (closed && release < 0 && tel[i].area > 0.005) release = i;
      if (release > 0 && tel[i].voice > 0.5) onset = i;
    }
    if (release < 0 || onset < 0) continue;
    const vowel = win(onset / 1000, 0.03);
    let loud = 0;
    for (let i = release - 1; i < onset; i++) if (ms(i) > vowel - 10) loud++;
    const noise = out.subarray(release * 48, Math.max(release + 6, onset - 5) * 48);
    const low = bandPower(noise, fs, 200, 3000, 256) * 2800 / (bandPower(noise, fs, 200, 20000, 256) * 19800);
    const level = (a: number, b: number) => { let q = 0; for (let k = a * 48; k < b * 48; k++) q += out[k] * out[k]; return 10 * Math.log10(q / ((b - a) * 48) + 1e-14); };
    const step = onset - release > 30 ? level(release, release + 15) - level(release + 15, onset - 5) : 0;
    rows.push({ rel: win(release / 1000 - 0.005, 0.01) - vowel, loud, vot: onset - release, low, step });
  }
  return rows;
}

describe('bursts of the voiceless stops', () => {
  it('an English /t/ is let go into a hiss at the ridge, an Italian one into its vowel', () => {
    // The tip of an English /t/ before a vowel comes off slowly, through the
    // channel of an [s]: what is heard between the closure and the voice is
    // that hiss, high and even, with no louder stage at its start. (Let go at
    // once with the folds wide apart, the air hissed at the teeth through a
    // passage as wide as a vowel's: 16 ms as loud as the vowel, a third and
    // more of them between 0.9 and 3 kHz, and then a faint breath.) An
    // Italian /t/ is over in a few milliseconds
    loadEnglishLexicon();
    const en = hisses('tattoo', 'en'), it = hisses('tattoo', 'it'), tea = hisses('tea', 'en')[0], ti = hisses('ti', 'it')[0];
    const say = (r: { rel: number; loud: number; vot: number; low: number; step: number }) => `voice after ${r.vot} ms, ${r.loud} ms within 10 dB of the vowel, ${(100 * r.low).toFixed(0)} % below 3 kHz${r.vot > 30 ? `, first 15 ms ${r.step >= 0 ? '+' : ''}${r.step.toFixed(1)} dB on the rest` : ''}`;
    note('fricated release', `"tattoo" in English: ${en.map(say).join('; ')}; in Italian: ${it.map(say).join('; ')}; "tea" ${say(tea)}; Italian "ti" ${say(ti)}`);
    expect(en.length).toBe(2);
    expect(it.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(en[i].vot).toBeGreaterThan(it[i].vot + 15);
      expect(en[i].loud).toBeGreaterThan(it[i].loud);
      expect(en[i].low).toBeLessThan(0.15);
    }
    for (const r of [en[1], tea]) {
      expect(r.vot).toBeGreaterThan(50);
      expect(r.vot).toBeLessThan(90);
      expect(r.low).toBeLessThan(0.15);
      expect(r.step).toBeLessThan(6);
    }
  });

  it('the burst of the tip of the tongue is a hiss, not a pop', () => {
    // the same bursts without the pop of the air let out
    const p = burst('la pata', 'p').rel - burst('la pata', 'p', false).rel;
    const t = burst('la tata', 't').rel - burst('la tata', 't', false).rel;
    note('what a burst is made of', `without the pop of the air let out the burst of /p/ loses ${p.toFixed(1)} dB, that of /t/ ${t.toFixed(1)} dB`);
    // (a pop with no hiss in it is a click of the tongue)
    expect(Math.abs(t)).toBeLessThan(3);
    expect(Math.abs(p)).toBeLessThan(6);
  });

  it('as loud against their vowel as measured on speakers, the velar before /a/ apart', () => {
    const words: [string, string, string][] = [['la pata', 'p', 'pa'], ['la pita', 'p', 'pi'], ['la tata', 't', 'ta'], ['la tita', 't', 'ti'], ['la cata', 'k', 'ka'], ['la chita', 'k', 'ki']];
    const got: Record<string, { rel: number; vot: number }> = {};
    for (const [text, ipa, key] of words) got[key] = burst(text, ipa);
    note('bursts against the vowel', words.map(([, , key]) => `/${key}/ ${got[key].rel.toFixed(1)} dB (speakers ${GREEK[key][0].toFixed(1)}), voice after ${(got[key].vot * 1000).toFixed(0)} ms (${GREEK[key][1]})`).join('; '));
    // no burst is louder than its vowel
    for (const key of Object.keys(got)) expect(got[key].rel).toBeLessThan(-3);
    // the lips and the tip of the tongue within 5 dB of the speakers
    for (const key of ['pa', 'pi', 'ta', 'ti']) expect(Math.abs(got[key].rel - GREEK[key][0])).toBeLessThan(5);
    // the velar before /i/ too; before /a/ the model's burst is weak (a stated limit)
    expect(Math.abs(got.ki.rel - GREEK.ki[0])).toBeLessThan(7);
    expect(got.ka.rel).toBeGreaterThan(-22);
    // the voice starts latest after the velar, which opens slowest
    for (const v of ['a', 'i']) {
      expect(got['k' + v].vot).toBeGreaterThan(got['p' + v].vot);
      expect(got['k' + v].vot).toBeGreaterThan(got['t' + v].vot);
      expect(got['k' + v].vot).toBeLessThan(0.07);
    }
  });

  it('a velar is made where its vowel is, a tip of the tongue stays at the ridge', () => {
    // nothing in the plan says so: the body of the tongue, which is slow, is
    // still on its way from one vowel to the next when it meets the palate
    const k = { i: shutAt('la chita', 'k'), a: shutAt('la cata', 'k'), u: shutAt('la cuta', 'k'), o: shutAt('la cota', 'k') };
    const t = { i: shutAt('la tita', 't'), o: shutAt('la tota', 't') };
    note('place of a velar', `let go at ${k.i.toFixed(1)} cm from the lips before /i/, ${k.a.toFixed(1)} before /a/, ${k.u.toFixed(1)} before /u/, ${k.o.toFixed(1)} before /o/; /t/ at ${t.i.toFixed(1)} before /i/ and ${t.o.toFixed(1)} before /o/`);
    expect(k.i).toBeLessThan(k.a);
    expect(k.a).toBeLessThan(k.u);
    expect(k.u).toBeLessThan(k.o);
    expect(k.o - k.i).toBeGreaterThan(1);
    expect(k.o - k.i).toBeLessThan(2.5);
    expect(Math.abs(t.o - t.i)).toBeLessThan(0.8);
  });
});
