import { VoiceDesign, withField, fieldValue, VOICE_FIELDS } from './design';

/**
 * Emotions as changes of a voice: rules from the literature, not learnt.
 *
 * What listeners hear as an emotion in a voice is mostly in its pitch (level
 * and range), its pace, its loudness and the way its folds close (pressed or
 * breathy), and in how carefully it articulates. The directions here follow
 * the reviews of Murray & Arnott (1993) and Scherer (2003), and the acoustic
 * profiles measured by Banse & Scherer (1996): joy higher and wider, faster,
 * louder; sadness lower, narrower, slower, softer and breathier, articulated
 * less; anger louder, pressed, faster and more precise; fear higher, faster,
 * less regular; tenderness lower, softer, slower and breathier. The sizes are
 * moderate choices, not measured here (those papers give directions and rough
 * sizes, which differ from speaker to speaker), scaled by `strength`.
 */
export type Emotion = 'neutral' | 'joy' | 'sadness' | 'anger' | 'fear' | 'tenderness';

interface Change {
  /** pitch, semitones */
  st: number;
  /** factors on the accent height (the range of the melody), the pace and the lung pressure */
  range: number;
  rate: number;
  push: number;
  /** breathiness: + breathier (more open folds), - pressed */
  breath: number;
  /** jitter, factor */
  jitter: number;
  /** care of articulation, added */
  precision: number;
}

export const EMOTIONS: Readonly<Record<Emotion, Readonly<Change>>> = {
  neutral: { st: 0, range: 1, rate: 1, push: 1, breath: 0, jitter: 1, precision: 0 },
  joy: { st: 3, range: 1.35, rate: 1.1, push: 1.2, breath: -0.1, jitter: 1, precision: 0.1 },
  sadness: { st: -2, range: 0.6, rate: 0.82, push: 0.8, breath: 0.35, jitter: 1.2, precision: -0.35 },
  anger: { st: 2, range: 1.3, rate: 1.08, push: 1.45, breath: -0.35, jitter: 1.2, precision: 0.35 },
  fear: { st: 4, range: 1.15, rate: 1.15, push: 1.05, breath: 0.15, jitter: 2, precision: -0.1 },
  tenderness: { st: -1, range: 0.8, rate: 0.9, push: 0.85, breath: 0.25, jitter: 1, precision: 0 },
};

const num = (d: VoiceDesign, path: string) => fieldValue(d, VOICE_FIELDS.find((f) => f.path === path)!) as number;

/** A copy of a voice with an emotion on it, `strength` 0 (none) .. 1 (as in the table) .. 2 (stronger). */
export function withEmotion(voice: Readonly<VoiceDesign>, emotion: Emotion, strength = 1): VoiceDesign {
  const e = EMOTIONS[emotion] ?? EMOTIONS.neutral;
  const k = Math.max(0, Math.min(2, strength));
  const f = (factor: number) => Math.pow(factor, k);
  let d = voice as VoiceDesign;
  const set = (path: string, v: number) => { d = withField(d, path, v); };
  set('speaking.f0', num(d, 'speaking.f0') * 2 ** ((e.st * k) / 12));
  // the range of the melody: of the rules' accents, and of a learnt delivery's
  set('speaking.accent', num(d, 'speaking.accent') * f(e.range));
  set('speaking.range', num(d, 'speaking.range') * f(e.range));
  set('speaking.rate', num(d, 'speaking.rate') * f(e.rate));
  set('speaking.ps', num(d, 'speaking.ps') * f(e.push));
  set('phonation.jitter', num(d, 'phonation.jitter') * f(e.jitter));
  set('habits.precision', num(d, 'habits.precision') + e.precision * k);
  // breathy or pressed, in each model of the folds: the shape of the drawn pulse, the rest gap of the areas, the
  // hiss of the glottis with it
  const b = e.breath * k;
  set('phonation.rd', num(d, 'phonation.rd') * 2 ** b);
  set('phonation.gapLow', num(d, 'phonation.gapLow') * 2 ** b);
  set('phonation.gapHigh', num(d, 'phonation.gapHigh') * 2 ** b);
  set('phonation.aspiration', num(d, 'phonation.aspiration') + 8 * b);
  return d === voice ? withField(d, 'speaking.f0', num(d, 'speaking.f0')) : d;
}
