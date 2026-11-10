import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { textToPhones } from '../src/dsp/speech/g2p';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { ScorePhone } from '../src/dsp/engine/params';
import { loadEnglishLexicon, note } from './helpers';

/**
 * Running speech has no sound in it that the mouth did not make.
 *
 * A model that moves in steps (the shape measured every few milliseconds,
 * the aerodynamics a little ahead of the tube, a closure that comes late)
 * leaves ticks in a sentence: single milliseconds that stand tens of
 * decibels out of what is around them, inside a vowel or in the silence of
 * a closure, where nothing is being released. They sound like clicks of the
 * tongue. These tests listen for them millisecond by millisecond in two
 * plain sentences, and check what makes them: when the mouth shuts against
 * the plan, and what a sibilant hisses with.
 */

const fs = 48000, MS = 48;
const STOPS = new Set(['p', 't', 'k', 'b', 'd', 'g']);

interface Frame { area: number; voice: number; mouth: number; teeth: number }
interface Take { phones: ScorePhone[]; out: Float32Array; tel: Frame[]; hf: Float64Array; top: number }

const takes = new Map<string, Take>();
/** a sentence as the man says it: the sound, and what the mouth does in every millisecond */
function take(text: string, lang: string): Take {
  const had = takes.get(text);
  if (had) return had;
  if (lang === 'en') loadEnglishLexicon();
  const u = utterance(builtinVoice('man')!.design, textToPhones(text, lang), lang);
  const e = new VoiceEngine(fs, u.params);
  e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
  const n = Math.round((u.score.duration + 0.1) * fs), out = new Float32Array(n), tel: Frame[] = [];
  for (let i = 0; i + MS <= n; i += MS) {
    e.process(out.subarray(i, i + MS), MS);
    const x = e.telemetry();
    tel.push({ area: x.constrictionArea, voice: x.voicingAmp, mouth: x.uMouth, teeth: x.levels.obstacle });
  }
  // how sharp each millisecond is: the power of the second difference of the wave
  const m = tel.length, hf = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let h = 0;
    for (let k = Math.max(2, i * MS); k < (i + 1) * MS; k++) { const d = out[k] - 2 * out[k - 1] + out[k - 2]; h += d * d; }
    hf[i] = 10 * Math.log10(h / MS + 1e-14);
  }
  const t: Take = { phones: u.score.phones, out, tel, hf, top: Math.max(...hf), };
  takes.set(text, t);
  return t;
}

/** the milliseconds that stand 15 dB out of the 20 around them, within 30 dB of the sharpest of the sentence */
function standouts(t: Take): { ms: number; rise: number; hf: number; phone?: ScorePhone }[] {
  const found = [];
  for (let i = 20; i < t.hf.length - 20; i++) {
    if (t.hf[i] < t.top - 30) continue;
    const around = [...t.hf.slice(i - 20, i - 2), ...t.hf.slice(i + 3, i + 21)].sort((x, y) => x - y);
    const rise = t.hf[i] - around[around.length >> 1];
    if (rise > 15 && t.hf[i] >= Math.max(t.hf[i - 1], t.hf[i + 1])) {
      found.push({ ms: i, rise, hf: t.hf[i] - t.top, phone: t.phones.find((p) => i / 1000 >= p.t0 && i / 1000 < p.t1) });
    }
  }
  return found;
}

/** for each stop of the sentence, when the mouth is shut */
function closures(t: Take): { phone: ScorePhone; before?: ScorePhone; shut: number; open: number }[] {
  const rows = [];
  for (let q = 0; q < t.phones.length; q++) {
    const p = t.phones[q];
    if (!STOPS.has(p.ipa)) continue;
    let shut = -1, open = -1;
    for (let i = Math.max(0, Math.round(p.t0 * 1000) - 60); i < Math.min(t.tel.length, Math.round(p.t1 * 1000) + 30); i++) {
      if (t.tel[i].area >= 0.004) continue;
      if (shut < 0) shut = i;
      open = i + 1;
    }
    if (shut >= 0 && shut / 1000 <= p.t1) rows.push({ phone: p, before: t.phones[q - 1], shut, open });
  }
  return rows;
}

const SENTENCES: [string, string][] = [['la luna è piena stanotte.', 'it'], ['where did you put the keys?', 'en']];

describe('running speech without ticks', () => {
  it('no millisecond stands out of a vowel, and none loudly out of a closure', () => {
    for (const [text, lang] of SENTENCES) {
      const t = take(text, lang), found = standouts(t), shut = closures(t);
      const edge = (ms: number) => Math.min(...shut.map((c) => Math.min(Math.abs(ms - c.shut), Math.abs(ms - c.open))));
      let inside = 0, loud = 0;
      for (const f of found) {
        // the first sound of the sentence starts from silence
        if (!f.phone || f.phone === t.phones[0] || f.ms < 80) continue;
        const c = shut.find((c) => f.ms >= c.shut && f.ms < c.open);
        // within a closure only the end of the voice is heard, and faintly; a release is sharp
        if (c) { if (f.ms < c.open - 4 && f.hf > -20) loud++; continue; }
        // anywhere else a sharp millisecond belongs to a stop: to its release, or to
        // the voice that starts again after one the glottis held (the /t/ of "put the")
        if (!STOPS.has(f.phone.ipa) && edge(f.ms) > 25) inside++;
      }
      note(`ticks in "${text}"`, `${found.length} ms stand out, all at the start of the voice or at the edges of the stops: ${found.map((f) => `${f.ms} (${f.phone?.ipa ?? '-'}) +${f.rise.toFixed(0)}`).join(', ')}`);
      expect(inside).toBe(0);
      expect(loud).toBe(0);
    }
  });

  it('a stop shuts when it is planned to, and no breath runs ahead of it', () => {
    for (const [text, lang] of SENTENCES) {
      const t = take(text, lang), rows: string[] = [];
      for (const c of closures(t)) {
        const p = c.phone, late = c.shut - p.t0 * 1000;
        // the breath that leaves the mouth after the voice has stopped and before the mouth is shut
        let breath = 0;
        for (let i = Math.max(0, c.shut - 60); i < c.shut; i++) if (t.tel[i].voice < 0.5 && t.tel[i].mouth > 50) breath++;
        rows.push(`${p.ipa} ${late >= 0 ? '+' : ''}${late.toFixed(0)} ms, shut ${c.open - c.shut} of ${((p.t1 - p.t0) * 1000).toFixed(0)}`);
        expect(late).toBeLessThan(25);
        expect(late).toBeGreaterThan(-15);
        expect(c.open - c.shut).toBeGreaterThan(30);
        // (a stop after a fricative takes its breath over: the /t/ of "st")
        if ('ptk'.includes(p.ipa) && c.before && !'sʃfθ'.includes(c.before.ipa)) expect(breath).toBeLessThan(4);
      }
      note(`stops of "${text}"`, `shut against the plan: ${rows.join('; ')}`);
    }
  });

  it('a word that begins and ends without voice has no vowel of its own before or after', () => {
    // as the studio plays it: the lungs start from rest
    loadEnglishLexicon();
    const rows: string[] = [];
    for (const text of ['tonight', 'this', 'stop']) {
      const u = utterance(builtinVoice('man')!.design, textToPhones(text, 'en'), 'en');
      const e = new VoiceEngine(fs, u.params);
      e.snapArticulators(); e.playScore(u.score);
      const n = Math.round((u.score.duration + 0.3) * fs), out = new Float32Array(n);
      const voice: number[] = [];
      for (let i = 0; i + MS <= n; i += MS) { e.process(out.subarray(i, i + MS), MS); voice.push(e.telemetry().voicingAmp); }
      const ph = u.score.phones, vowel = ph.find((p) => 'əɪɑaɪ'.includes(p.ipa[0]))!;
      const peak = (t0: number, t1: number) => { let m = 0; for (let i = Math.max(0, Math.round(t0 * fs)); i < Math.min(n, t1 * fs); i++) m = Math.max(m, Math.abs(out[i])); return m; };
      const loud = peak(vowel.t0, ph[ph.length - 1].t0);
      // before the first sound: nothing; after the last: its breath dying away, and no pulse of the folds
      const before = peak(0, ph[0].t0 - 0.005) / loud;
      const last = ph[ph.length - 1];
      const after = Math.max(...voice.slice(Math.round(last.t1 * 1000), Math.round(last.t1 * 1000) + 250));
      const tail = peak(last.t1 + 0.06, last.t1 + 0.3) / loud;
      rows.push(`"${text}" ${(20 * Math.log10(before + 1e-7)).toFixed(0)} dB before, the folds at ${after.toFixed(2)} of their swing after, ${(20 * Math.log10(tail + 1e-7)).toFixed(0)} dB 60 ms on`);
      expect(before).toBeLessThan(0.03);
      expect(after).toBeLessThan(0.2);
      expect(tail).toBeLessThan(0.1);
    }
    note('edges of a word without voice', `against the loudest of the word: ${rows.join('; ')}`);
  });

  it('a sibilant hisses against the teeth through its length, and louder than the release of a stop', () => {
    const t = take('la luna è piena stanotte.', 'it');
    const s = t.phones.find((p) => p.ipa === 's')!;
    const a = Math.round(s.t0 * 1000), b = Math.round(s.t1 * 1000);
    // (the /t/ that follows shuts the mouth a few milliseconds before its time)
    const span = t.tel.slice(a, b).filter((f) => f.area >= 0.004), most = Math.max(...span.map((f) => f.teeth));
    // narrow soon: within 20 ms of its start the passage is the passage of a fricative
    const narrow = span.findIndex((f) => f.area < 0.2);
    // the teeth sound through most of it
    const sounding = span.filter((f) => f.teeth > most * 0.25).length / span.length;
    const power = (from: number, to: number) => {
      let q = 0;
      for (let i = from; i < to; i++) q += 10 ** (t.hf[i] / 10);
      return 10 * Math.log10(q / (to - from));
    };
    const hiss = power(a + 20, b - 10);
    const releases = closures(t).filter((c) => c.phone.ipa === 't').map((c) => power(c.open - 2, c.open + 12) - hiss);
    note('sibilant in a sentence', `/s/ of "stanotte" narrower than 0.2 cm² after ${narrow} ms, the teeth sounding through ${(sounding * 100).toFixed(0)}% of it; the releases of /t/ ${releases.map((r) => r.toFixed(1)).join(' and ')} dB against its hiss`);
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(narrow).toBeLessThan(20);
    expect(sounding).toBeGreaterThan(0.6);
    for (const r of releases) expect(r).toBeLessThan(0);
  });
});
