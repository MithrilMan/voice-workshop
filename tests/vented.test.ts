import { describe, it, expect } from 'vitest';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { textToPhones } from '../src/dsp/speech/g2p';
import { phonemeFor, constrictionOf, shapeOf, vented } from '../src/dsp/speech/derive';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { IPA_VOWELS } from '../src/dsp/speech/ipa';
import { Anatomy, Articulators, ARTICULATOR_KEYS, ARTICULATOR_RANGES, DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, within } from '../src/dsp/tract/types';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { utterance } from '../src/dsp/voice/utterance';
import { loadEnglishLexicon, note } from './helpers';

const VOWELS = [...new Set([...Object.keys(PHONEMES), ...Object.keys(IPA_VOWELS)])].filter((s) => phonemeFor(s)?.manner === 'vowel');
const whole = (art: Partial<Articulators>): Articulators => ({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...art });
/** a vowel's narrowest passage on a head, cm² on that head: as its posture leaves it, and as the voice says it */
function passages(symbol: string, an: Partial<Anatomy>, tongueX = 0) {
  const anatomy = { ...DEFAULT_ANATOMY, ...an }, shape = shapeOf({ anatomy }), s2 = anatomy.scale * anatomy.scale;
  const own = constrictionOf(whole(phonemeFor(symbol)!.art)).area;
  const posture = whole(phonemeFor(symbol, shape)!.art);
  posture.tongueX += tongueX;
  return { need: 0.85 * Math.min(own, 0.3), before: constrictionOf(posture, shape).area * s2, after: constrictionOf(vented(symbol, posture, shape, anatomy.scale), shape).area * s2 };
}
/** heads with a low palate, as voices fitted to recordings have them */
const LOW: [string, Partial<Anatomy>, number][] = [
  ['a low palate on a smaller head', { scale: 0.91, palateHeight: 0.66, tongueSize: 0.96 }, -0.025],
  ['a lower palate on a small head', { scale: 0.83, palateHeight: 0.8 }, -0.05],
];

describe('a vowel still lets the air through', () => {
  it("is left as it is on the drawing's head", () => {
    expect(VOWELS.length).toBeGreaterThanOrEqual(20);
    for (const s of VOWELS) {
      const posture = whole(phonemeFor(s)!.art);
      expect(vented(s, posture, undefined, 1)).toEqual(posture);
    }
  });

  it('on a small head, or under a tongue kept back', () => {
    const lines: string[] = [];
    for (const [scale, tongueX, few] of [[0.83, 0, 8], [0.83, -0.08, 8], [1, -0.08, 4]]) {
      const all = VOWELS.map((s) => passages(s, { scale }, tongueX));
      const short = all.filter((x) => x.before < x.need - 0.005);
      lines.push(`size ${scale}, tongue ${tongueX}: ${short.length} of ${all.length} vowels too narrow as their posture leaves them (the narrowest ${Math.min(...all.map((x) => x.before / x.need)).toFixed(2)} of what it needs), ${all.filter((x) => x.after < x.need - 0.005).length} as the voice says them`);
      expect(short.length).toBeGreaterThanOrEqual(few);
      for (const x of all) expect(x.after).toBeGreaterThanOrEqual(x.need - 0.005);
    }
    note('vented', lines.join('; '));
  });

  it('with every articulator inside its range under a low palate, where another one can do it', () => {
    // the body of the tongue pushed below its range would not get there in the time of a short vowel
    for (const [, an] of LOW) {
      const shape = shapeOf({ anatomy: { ...DEFAULT_ANATOMY, ...an } });
      for (const s of VOWELS) {
        const art = whole(phonemeFor(s, shape)!.art);
        for (const k of ARTICULATOR_KEYS) {
          const [lo, hi] = ARTICULATOR_RANGES[k];
          expect(art[k], `${s} ${k}`).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(art[k], `${s} ${k}`).toBeLessThanOrEqual(hi + 1e-6);
        }
      }
    }
  });

  it('the r-coloured vowels of "ever heard" keep their voice under a low palate', () => {
    loadEnglishLexicon();
    const lines: string[] = [];
    for (const [name, an, tongueX] of LOW) {
      const d = JSON.parse(JSON.stringify(builtinVoice('woman')!.design));
      Object.assign(d.body.anatomy, an);
      d.habits.tongueX = tongueX;
      const u = utterance(d, textToPhones('ever heard is', 'en'), 'en');
      const e = new VoiceEngine(48000, u.params);
      e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
      const buf = new Float32Array(48), steps: { area: number; voicing: number; behind: number }[] = [];
      for (let t = 0; t < u.score.duration; t += 0.001) {
        e.process(buf, 48);
        const x = e.telemetry();
        steps.push({ area: x.constrictionArea, voicing: x.voicingAmp, behind: x.po / Math.max(1, x.ps) });
      }
      const coloured = u.score.phones.filter((p) => p.ipa === 'ɚ' || p.ipa === 'ɝ');
      expect(coloured.length).toBe(2);
      for (const p of coloured) {
        const len = p.t1 - p.t0, mid = steps.slice(Math.round(1000 * (p.t0 + 0.3 * len)), Math.round(1000 * (p.t1 - 0.3 * len)));
        const area = Math.min(...mid.map((x) => x.area)), voicing = Math.min(...mid.map((x) => x.voicing)), behind = Math.max(...mid.map((x) => x.behind));
        lines.push(`${name} [${p.ipa}] passage ${area.toFixed(2)} cm², voice ${voicing.toFixed(2)}, ${behind.toFixed(2)} of the lungs' pressure behind it`);
        expect(area).toBeGreaterThan(0.15);
        expect(voicing).toBeGreaterThan(0.6);
        expect(behind).toBeLessThan(0.3);
      }
    }
    note('vented 2', lines.join('; '));
  });

  it('a posture already past a range is not pulled back, nor pushed further', () => {
    const [lo] = ARTICULATOR_RANGES.tongueY;
    expect(within('tongueY', 0, lo - 1)).toBe(lo);
    expect(within('tongueY', lo - 0.3, lo - 0.3)).toBe(lo - 0.3);
    expect(within('tongueY', lo - 0.3, lo - 0.5)).toBe(lo - 0.3);
    expect(within('tongueY', lo - 0.3, lo + 0.2)).toBe(lo + 0.2);
  });
});
