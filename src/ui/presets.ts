import { EngineParams, Score, ScoreFrame } from '../dsp/engine/params';
import { PHONEMES } from '../dsp/speech/phonemes';
import { phonemeFor } from '../dsp/speech/derive';
import { DEFAULT_ARTICULATORS } from '../dsp/tract/types';
import { BUILTIN_VOICES } from '../dsp/voice/builtin';
import { applyDesign } from '../dsp/voice/design';
import { colourCurve, NoiseColour, NOISE_CURVE_POINTS, noiseCurveFreq } from '../dsp/noise/noise';

export interface Preset { id: string; name: string; hint: string; apply: (p: EngineParams) => void }

/**
 * Speaker presets: the first nine voices that come with the simulator
 * (src/dsp/voice/builtin.ts), applied to the hands as a whole voice: body,
 * folds, usual pitch and loudness, larynx and glottis.
 */
export const VOICE_PRESETS: Preset[] = BUILTIN_VOICES.slice(0, 9).map((v) => ({ id: v.id, name: v.name, hint: v.hint, apply: (p: EngineParams) => applyDesign(p, v.design) }));

/** Persistent, person-specific parts of the filter (timbre). */
export const TIMBRE_PRESETS: Preset[] = [
  { id: 'neutral', name: 'Neutral', hint: 'reference anatomy', apply: (p) => { p.anatomy.pharynxWidth = 1; p.anatomy.nasalLeak = 0; p.articulators.larynx = 0; } },
  { id: 'dark', name: 'Dark', hint: 'low larynx and wide pharynx: lower formants', apply: (p) => { p.articulators.larynx = -0.9; p.anatomy.pharynxWidth = 1.3; p.anatomy.nasalLeak = 0; } },
  { id: 'bright', name: 'Bright', hint: 'high larynx and narrow pharynx: higher formants', apply: (p) => { p.articulators.larynx = 0.7; p.anatomy.pharynxWidth = 0.75; p.anatomy.nasalLeak = 0; } },
  { id: 'nasal', name: 'Nasal', hint: 'the velum lets sound into the nose', apply: (p) => { p.anatomy.nasalLeak = 0.7; } },
  { id: 'warm', name: 'Warm', hint: 'slightly wide pharynx, slightly low larynx', apply: (p) => { p.articulators.larynx = -0.4; p.anatomy.pharynxWidth = 1.15; p.anatomy.nasalLeak = 0.1; } },
  { id: 'hollow', name: 'Hollow', hint: 'very wide pharynx and slightly rounded lips', apply: (p) => { p.anatomy.pharynxWidth = 1.45; p.articulators.lipRound = Math.max(p.articulators.lipRound, 0.35); p.articulators.lipProtrude = Math.max(p.articulators.lipProtrude, 0.3); } },
];

/** Sets the articulators (and glottal setting) of a phoneme. */
export function applyPhoneme(ipa: string, p: EngineParams): void {
  // the sound as this head makes it (the same constriction in the same place)
  const ph = PHONEMES[ipa] && phonemeFor(ipa, p);
  if (!ph) return;
  if (ph.manner === 'vowel') {
    const keepLarynx = p.articulators.larynx;
    p.articulators = { ...DEFAULT_ARTICULATORS, ...ph.art, larynx: keepLarynx };
  } else {
    // consonants: start from a neutral vowel so that the articulators the
    // consonant does not control have a sensible position
    const keepLarynx = p.articulators.larynx;
    p.articulators = { ...DEFAULT_ARTICULATORS, ...PHONEMES['ə'].art, ...ph.art, larynx: keepLarynx };
  }
  p.abduction = ph.manner === 'stop' ? 0 : ph.abduction;
  p.phonate = true;
}

/** Noise colour presets for the user noise designer. */
export const NOISE_SHAPES: { id: string; name: string; curve: () => number[] }[] = [
  ...(['white', 'pink', 'brown', 'blue', 'violet'] as NoiseColour[]).map((c) => ({
    id: c,
    name: { white: 'White', pink: 'Pink', brown: 'Brown', blue: 'Blue', violet: 'Violet' }[c],
    curve: () => Array.from(colourCurve(c)),
  })),
  { id: 'sss', name: 'Like an “s”', curve: () => bandCurve(6000, 1.1, 0, -30) },
  { id: 'shh', name: 'Like “sh”', curve: () => bandCurve(3000, 1.0, 0, -28) },
  { id: 'fff', name: 'Like an “f” (flat)', curve: () => bandCurve(7000, 3, 0, -12) },
  { id: 'band', name: 'Narrow band 1 kHz', curve: () => bandCurve(1000, 0.35, 0, -40) },
];

/** A curve with a peak at fc (Hz), bandwidth in octaves, peak and floor levels (dB). */
export function bandCurve(fc: number, octaves: number, peak: number, floor: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < NOISE_CURVE_POINTS; i++) {
    const d = Math.log2(noiseCurveFreq(i) / fc) / octaves;
    out.push(floor + (peak - floor) * Math.exp(-0.5 * d * d * 4));
  }
  return out;
}

/** Score following an F0 contour (melody pad, singing); it has no articulators, so the hands keep the tract. */
export function contourScore(points: { t: number; f0: number }[], ps: number, abduction = 0): Score {
  const frames: ScoreFrame[] = [];
  const dur = points.length ? points[points.length - 1].t : 0;
  const FR = 0.005;
  let j = 0;
  for (let t = 0; t <= dur + 0.3; t += FR) {
    while (j < points.length - 2 && points[j + 1].t <= t) j++;
    const a = points[j], b = points[Math.min(j + 1, points.length - 1)];
    const u = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    const f0 = a.f0 > 0 && b.f0 > 0 ? a.f0 * Math.pow(b.f0 / a.f0, u) : (u < 0.5 ? a.f0 : b.f0);
    const voiced = f0 > 0;
    frames.push({ t, abduction: voiced ? abduction : 0.6, f0: voiced ? f0 : (points.find((q) => q.f0 > 0)?.f0 ?? 120), ps: t < dur ? ps : 0 });
  }
  return { frames, phones: [{ ipa: '', t0: 0, t1: dur }], duration: dur };
}
