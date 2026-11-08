import { describe, it, expect } from 'vitest';
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { formants } from '../src/dsp/tract/acoustics';
import { Anatomy, DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../src/dsp/tract/types';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { IPA_CONSONANTS, IPA_VOWELS } from '../src/dsp/speech/ipa';
import { phonemeFor, constrictionOf, shapeOf, CLOSED_AREA } from '../src/dsp/speech/derive';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { note } from './helpers';

const head = (an: Partial<Anatomy>) => ({ anatomy: { ...DEFAULT_ANATOMY, ...an }, teeth: { ...DEFAULT_TEETH } });
const SYMBOLS = [...new Set([...Object.keys(PHONEMES), ...Object.keys(IPA_CONSONANTS), ...Object.keys(IPA_VOWELS)])].filter((s) => phonemeFor(s));

/** F1-F3 of a sound held on a head: the posture as the drawing's head makes it, or as that head does */
function formantsOf(sym: string, an: Partial<Anatomy>, adapted = true): number[] {
  const h = head(an);
  const ph = adapted ? phonemeFor(sym, h)! : PHONEMES[sym];
  const g = computeGeometry({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...ph.art }, h.anatomy, h.teeth);
  return formants(sectionsFromGeometry(g)).slice(0, 3).map((f) => f.f);
}

describe('the shape of the head', () => {
  it("the drawing's own head is the planner as it was", () => {
    const phones = textToPhones('la luna e le stelle, chi lo sa?', 'it');
    expect(JSON.stringify(buildScore(phones, { lang: 'it', head: head({}) }))).toBe(JSON.stringify(buildScore(phones, { lang: 'it' })));
    for (const s of SYMBOLS) expect(phonemeFor(s, head({})), s).toBe(phonemeFor(s));
  });

  it('the size, the length of the pharynx and the nose change no sound: a posture scales with the head', () => {
    const other = head({ scale: 0.72, pharynx: 0.8, nasalLeak: 0.3, nasalCycle: 1, nostrilLeft: 0, piriform: 0 });
    expect(shapeOf(other)).toBeUndefined();
    for (const s of SYMBOLS) expect(phonemeFor(s, other), s).toBe(phonemeFor(s));
  });

  it('on a low or a high palate, a narrow or a wide arch or pharynx, every sound keeps its constriction', () => {
    const shapes: Partial<Anatomy>[] = [{ palateHeight: 0.6 }, { palateHeight: 1.45 }, { archWidth: 0.8 }, { archWidth: 1.25 }, { pharynxWidth: 0.7 }, { pharynxWidth: 1.4 }];
    const marked: string[] = [];
    for (const an of shapes) {
      const h = head(an), shape = shapeOf(h)!;
      for (const s of SYMBOLS) {
        const c = phonemeFor(s)!, a = phonemeFor(s, h)!;
        const was = constrictionOf(c.art).area, now = constrictionOf(a.art, shape).area;
        const what = `${s} on ${JSON.stringify(an)}: ${was.toFixed(3)} -> ${now.toFixed(3)} cm²`;
        if (a.approx === 'anatomy' && c.approx !== 'anatomy') { marked.push(what); continue; }
        if (c.manner === 'vowel') expect(now, what).toBeGreaterThanOrEqual(Math.min(0.25, 0.8 * was));
        else if (was < CLOSED_AREA) expect(now, what).toBeLessThan(CLOSED_AREA);
        else if (was <= 0.4) {
          // a lateral keeps its passage within its bounds (0.85-1.2), any other consonant within a few per cent
          const [lo, hi] = c.manner === 'lateral' ? [0.84, 1.21] : [0.85, 1.15];
          expect(now / was, what).toBeGreaterThan(lo);
          expect(now / was, what).toBeLessThan(hi);
        }
      }
    }
    note('head shapes', `${SYMBOLS.length} sounds on six head shapes; marked approximate: ${marked.join('; ') || 'none'}`);
    // the velar lateral cannot keep its sides open under a very low palate without opening its closure
    expect(marked.length).toBeLessThanOrEqual(2);
  });

  it('a high vault darkens the front vowels and a low one brightens them; a wide arch lowers their second formant', () => {
    const [, f2] = formantsOf('i', {});
    const [, high] = formantsOf('i', { palateHeight: 1.3 }), [, low] = formantsOf('i', { palateHeight: 0.7 });
    const [, wide] = formantsOf('i', { archWidth: 1.2 }), [, narrow] = formantsOf('i', { archWidth: 0.85 });
    note('palate', `/i/ F2: ${Math.round(f2)} Hz; vault 1.3 ${Math.round(high)}, vault 0.7 ${Math.round(low)}; arch 1.2 ${Math.round(wide)}, arch 0.85 ${Math.round(narrow)}`);
    expect(high).toBeLessThan(f2 - 100);
    expect(low).toBeGreaterThan(f2 + 30);
    expect(wide).toBeLessThan(f2 - 30);
    expect(narrow).toBeGreaterThan(f2 + 30);
    // the speaker aims at the vowel: what is left is a fraction of what the same posture would give
    const [, raw] = formantsOf('i', { palateHeight: 0.7 }, false);
    expect(raw - f2).toBeGreaterThan(low - f2);
    // a low vault no longer brings an [ɛ] up toward [e]: the tongue comes down with it
    const [e1] = formantsOf('ɛ', {}), [e1low] = formantsOf('ɛ', { palateHeight: 0.7 });
    expect(Math.abs(e1low - e1)).toBeLessThan(25);
  });

  it('speaking with a low palate, every stop still closes and builds its pressure', () => {
    const h = head({ palateHeight: 0.6 });
    const sc = buildScore(textToPhones('kaka gaga tata cece', 'it'), { lang: 'it', head: h });
    const p = defaultParams();
    p.anatomy = { ...h.anatomy };
    const e = new VoiceEngine(48000, p);
    e.snapArticulators(); e.snapPressure(); e.playScore(sc);
    const pv = e as unknown as { aero: { po: number }; psCur: number };
    const buf = new Float32Array(48);
    const peaks: number[] = [];
    let last = -1;
    for (let t = 0; t < sc.duration; t += 0.001) {
      e.process(buf, 48);
      const i = sc.phones.findIndex((x) => t >= x.t0 && t < x.t1);
      if (i < 0 || !'kgttʃ'.includes(sc.phones[i].ipa)) continue;
      if (i !== last) { peaks.push(0); last = i; }
      peaks[peaks.length - 1] = Math.max(peaks[peaks.length - 1], pv.aero.po / Math.max(1, pv.psCur));
    }
    note('low palate', `pressure behind each stop against the lungs' (palate 0.6): ${peaks.map((x) => x.toFixed(2)).join(' ')}`);
    expect(peaks.length).toBe(8);
    for (const x of peaks) expect(x).toBeGreaterThan(0.4);
  });
});
