import { describe, it, expect } from 'vitest';
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { transferMagnitudes } from '../src/dsp/tract/acoustics';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH, Articulators } from '../src/dsp/tract/types';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { phonemeFor, constrictionOf, notesForIpa } from '../src/dsp/speech/derive';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams, Score } from '../src/dsp/engine/params';
import { bandPower, note, rmsDb } from './helpers';

const geometry = (a: Partial<Articulators>) => computeGeometry({ ...DEFAULT_ARTICULATORS, ...a }, DEFAULT_ANATOMY, DEFAULT_TEETH);
/** the narrowest section of the tube above the folds, cm² */
const tube = (a: Partial<Articulators>) => {
  const g = geometry(a);
  let m = Infinity;
  for (let i = 0; i <= g.lastRay; i++) if (g.s[i] < 2) m = Math.min(m, g.hits[i].area);
  return m;
};
const db = (x: number) => 10 * Math.log10(x);
const FREQS = Array.from({ length: 200 }, (_, i) => 50 + 25 * i);
/** the ring of the voice: the 2.4-3.6 kHz band against the first formant's, dB (transfer function) */
const ring = (a: Partial<Articulators>) => {
  const m = transferMagnitudes(sectionsFromGeometry(geometry(a)), FREQS);
  let hi = 0, lo = 0;
  FREQS.forEach((f, i) => { if (f >= 2400 && f < 3600) hi += m[i] ** 2; else if (f < 1200) lo += m[i] ** 2; });
  return db(hi / lo);
};
/** a held vowel, half a second after the onset */
const hold = (a: Partial<Articulators>) => {
  const p = defaultParams(); p.phonate = true;
  p.articulators = { ...p.articulators, ...a };
  const e = new VoiceEngine(48000, p); e.snapArticulators(); e.snapPressure();
  const out = new Float32Array(48000); e.process(out, out.length);
  return out.subarray(24000);
};
const render = (sc: Score) => {
  const e = new VoiceEngine(48000, defaultParams());
  e.snapArticulators(); e.snapPressure(); e.playScore(sc);
  const out = new Float32Array(Math.round(sc.duration * 48000)); e.process(out, out.length);
  return out;
};

describe('the epilarynx and its sphincter', () => {
  it('at rest the tube is as it was; drawn in it narrows to a shut; below zero it widens', () => {
    const rest = tube({});
    note('epilarynx', `narrowest section of the tube: ${rest.toFixed(2)} cm² at rest, ${tube({ epilarynx: 0.5 }).toFixed(2)} at 0.5, ${tube({ epilarynx: 1 }).toFixed(3)} shut, ${tube({ epilarynx: -0.5 }).toFixed(2)} at −0.5`);
    expect(rest).toBeGreaterThan(0.35);
    expect(rest).toBeLessThan(0.7);
    expect(tube({ epilarynx: 0.5 })).toBeLessThan(0.5 * rest);
    expect(tube({ epilarynx: 1 })).toBeLessThan(0.004);
    // the folds' end of the tube is not drawn in, and below zero it widens
    expect(geometry({ epilarynx: 1 }).hits[0].area).toBeCloseTo(geometry({}).hits[0].area, 3);
    const wide = geometry({ epilarynx: -0.5 }), mid = geometry({});
    for (let i = 2; i < 8; i++) expect(wide.hits[i].area).toBeGreaterThan(mid.hits[i].area);
  });

  it('narrowed, it rings: the band around 3 kHz rises in every vowel (the singer’s formant, twang)', () => {
    const gains: string[] = [];
    for (const v of ['a', 'i', 'u']) {
      const art = PHONEMES[v].art;
      const g3 = ring({ ...art, epilarynx: 0.5 }) - ring(art), g6 = ring({ ...art, epilarynx: 0.6 }) - ring(art);
      gains.push(`${v} +${g3.toFixed(1)} dB at 0.5, +${g6.toFixed(1)} at 0.6`);
      expect(g3, v).toBeGreaterThan(3);
      expect(g6, v).toBeGreaterThan(g3);
    }
    // and in the sound made: the same band against the first formant's
    const band = (x: Float32Array) => db(bandPower(x, 48000, 2400, 3600) / bandPower(x, 48000, 50, 1200));
    const a0 = hold(PHONEMES.a.art), a5 = hold({ ...PHONEMES.a.art, epilarynx: 0.5 });
    const made = band(a5) - band(a0);
    note('twang', `transfer function: ${gains.join('; ')}; held [a] made: +${made.toFixed(1)} dB at 0.5`);
    expect(made).toBeGreaterThan(1);
  });

  it('the epiglottals are made by the sphincter: ʡ shuts it, ʜ ʢ hiss through it', () => {
    const stop = phonemeFor('ʡ')!, fric = phonemeFor('ʜ')!, voiced = phonemeFor('ʢ')!;
    expect(stop.art.epilarynx).toBeGreaterThan(0.9);
    expect(fric.art.epilarynx).toBeGreaterThan(0.4);
    expect(voiced.art).toEqual(fric.art);
    const s = constrictionOf(stop.art), f = constrictionOf(fric.art), ph = constrictionOf(phonemeFor('ħ')!.art);
    note('epiglottals', `ʡ ${s.area.toFixed(3)} cm² at ${s.fromLips.toFixed(1)} cm from the lips, ʜ ${f.area.toFixed(2)} cm² at ${f.fromLips.toFixed(1)} cm, ħ at ${ph.fromLips.toFixed(1)} cm`);
    expect(s.area).toBeLessThan(0.004);
    expect(f.area).toBeCloseTo(0.1, 1);
    // below the pharyngeals, in the tube above the folds
    expect(f.fromLips).toBeGreaterThan(ph.fromLips + 2);
    for (const x of ['ʡ', 'ʜ', 'ʢ']) expect(notesForIpa(x), x).toEqual([]);
    // the pharynx above stays open: the root is not what makes them
    expect(constrictionOf({ ...fric.art, epilarynx: 0 }).area).toBeGreaterThan(0.4);
  });

  it('an epiglottal stop silences the voice; its fricative hisses', () => {
    const sc = buildScore(textToPhones('[ˈaʡa ˈaʜa]', 'it'), { lang: 'it' });
    const out = render(sc);
    const phone = (ipa: string) => sc.phones.find((q) => q.ipa === ipa)!;
    const part = (ipa: string) => { const p = phone(ipa); const m = 0.5 * (p.t0 + p.t1), h = 0.25 * (p.t1 - p.t0); return out.subarray(Math.round((m - h) * 48000), Math.round((m + h) * 48000)); };
    /** the quietest 10 ms of a phone */
    const quietest = (ipa: string) => {
      const p = phone(ipa);
      let m = Infinity;
      for (let t = p.t0; t + 0.01 <= p.t1; t += 0.005) m = Math.min(m, rmsDb(out.subarray(Math.round(t * 48000), Math.round((t + 0.01) * 48000))));
      return m;
    };
    const vowel = rmsDb(part('a')), stop = quietest('ʡ'), hiss = rmsDb(part('ʜ'));
    note('epiglottals made', `against the vowel: ʡ closure ${(stop - vowel).toFixed(0)} dB, ʜ ${(hiss - vowel).toFixed(1)} dB`);
    expect(stop).toBeLessThan(vowel - 40);
    expect(hiss).toBeGreaterThan(vowel - 35);
    expect(hiss).toBeGreaterThan(stop + 20);
  });

  it('a voice with twang keeps the tube narrow through all it says, but an epiglottal makes its own', () => {
    const sc = buildScore(textToPhones('[ˈlatʃa ˈaʡa]', 'it'), { lang: 'it', setting: { epilarynx: 0.4 } });
    for (const p of sc.phones) {
      const f = sc.frames[Math.round((0.5 * (p.t0 + p.t1)) / 0.005)];
      if (p.ipa === 'ʡ') expect(f.art!.epilarynx, p.ipa).toBeGreaterThan(0.9);
      else expect(f.art!.epilarynx, p.ipa).toBeCloseTo(0.4, 1);
    }
  });
});
