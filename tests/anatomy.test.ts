import { describe, it, expect } from 'vitest';
import { computeGeometry } from '../src/dsp/tract/geometry';
import { sectionsFromGeometry } from '../src/dsp/tract/areaFunction';
import { formants } from '../src/dsp/tract/acoustics';
import { DEFAULT_ANATOMY, DEFAULT_ARTICULATORS, DEFAULT_TEETH } from '../src/dsp/tract/types';
import { PHONEMES } from '../src/dsp/speech/phonemes';
import { phonemeFor, constrictionOf, notesForIpa } from '../src/dsp/speech/derive';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { note } from './helpers';

const fs = 48000;
const geometryOf = (sym: string) => computeGeometry({ ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...(PHONEMES[sym] ?? phonemeFor(sym)!).art }, DEFAULT_ANATOMY, DEFAULT_TEETH);

/** level of a nasal's murmur against the vowel after it (dB) */
function murmur(text: string): number {
  const score = buildScore(textToPhones(text, 'it'), { lang: 'it' });
  const ph = score.phones.find((q) => q.ipa !== 'a')!;
  const e = new VoiceEngine(fs, defaultParams());
  e.snapArticulators(); e.snapPressure(); e.playScore(score);
  const n = Math.round((score.duration + 0.1) * fs), out = new Float32Array(n);
  for (let i = 0; i < n; i += 128) e.process(out.subarray(i, Math.min(n, i + 128)), Math.min(128, n - i));
  const rms = (t0: number, t1: number) => {
    const x = out.subarray(Math.round(t0 * fs), Math.round(t1 * fs));
    return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  };
  const mid = 0.5 * (ph.t0 + ph.t1);
  return 20 * Math.log10(rms(mid - 0.02, mid + 0.02) / rms(ph.t1 + 0.04, ph.t1 + 0.08));
}

describe('anatomy behind the velum', () => {
  it('a velar lateral closes the midline with the dorsum and lets the air by the sides, and /l/ keeps its formants', () => {
    const g = geometryOf('ʟ');
    const sides = g.hits.slice(0, g.lastRay + 1).map((h, i) => ({ h, fromLips: g.length - g.s[i] })).filter(({ h }) => h.d <= 0 && h.lateral > 0);
    note('velar lateral', `ʟ: midline closed with lateral channels over ${sides.length} grid lines, ${Math.min(...sides.map((x) => x.fromLips)).toFixed(1)}-${Math.max(...sides.map((x) => x.fromLips)).toFixed(1)} cm from the lips`);
    expect(sides.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...sides.map((x) => x.fromLips))).toBeGreaterThan(7);
    expect(phonemeFor('ʟ')!.manner).toBe('lateral');
    expect(notesForIpa('ʟ')).toEqual([]);
    // the channels of /l/ still open only in front of the molars
    const f3 = formants(sectionsFromGeometry(geometryOf('l')), {}, 4000)[2].f;
    expect(Math.abs(f3 - 2421)).toBeLessThan(15);
  });

  it('a uvular nasal: the nose joins behind the uvular closure, so its murmur is as loud as that of /ŋ/', () => {
    expect(phonemeFor('ɴ')!.place).toBe('uvular');
    expect(constrictionOf(phonemeFor('ɴ')!.art).fromLips).toBeGreaterThan(constrictionOf(PHONEMES['ŋ'].art).fromLips + 1.5);
    const ng = murmur('[aˈŋa]'), N = murmur('[aˈɴa]');
    note('uvular nasal', `murmur against the vowel: [ŋ] ${ng.toFixed(1)} dB, [ɴ] ${N.toFixed(1)} dB`);
    expect(N).toBeGreaterThan(ng - 6);
    expect(notesForIpa('ɴ')).toEqual([]);
  });

  it('an epiglottal fricative narrows the pharynx lower than a pharyngeal one', () => {
    const h = constrictionOf(phonemeFor('ʜ')!.art), ph = constrictionOf(phonemeFor('ħ')!.art);
    note('epiglottal fricative', `ʜ ${h.fromLips.toFixed(1)} cm from the lips, ħ ${ph.fromLips.toFixed(1)} cm, both ${h.area.toFixed(2)} cm²`);
    expect(h.area).toBeCloseTo(0.1, 1);
    expect(h.fromLips).toBeGreaterThan(ph.fromLips + 0.5);
  });
});
