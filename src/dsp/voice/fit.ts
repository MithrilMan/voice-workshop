/**
 * A voice of this simulator brought toward a recorded one, by measurement:
 * the recording is measured (voiceprint.ts), the voice says the same text
 * (or, when the text is not known, a passage of its own) and is measured the
 * same way, and its fields are moved a few at a time while the distance
 * between the two falls (analysis by synthesis). The pitch first, then the
 * melody, the size of the head and its formants, the folds, the hiss of the
 * consonants, the pace, and a last pass over the body and the folds.
 *
 * What comes out is a voice of the same kind, not a copy: what a recording
 * has beyond these measures, and beyond the fields of a voice, is not
 * carried over.
 */
import type { Phone } from '../speech/g2p';
import { VoiceEngine } from '../engine/engine';
import { voicePrint, VoicePrint, Clip } from '../analysis/voiceprint';
import { utterance } from './utterance';
import { builtinVoice } from './builtin';
import { VoiceDesign, cloneVoice, withField, fieldValue, VOICE_FIELDS } from './design';

/** what the voice says while it is fitted */
export interface Material { phones: Phone[]; lang: string }

/** what the voice says when the text of the recording is not known */
export const PASSAGES: Record<string, string> = {
  en: 'The north wind and the sun were arguing about which of them was stronger, when a traveler came along, wrapped in a warm coat. Is it far to the city? Not at all, it is just over the hill.',
  it: 'Ieri sera, sulla spiaggia, abbiamo guardato la luna piena salire sopra il mare. Nessuno parlava: era tutto così calmo. Torniamo domani?',
};

export interface Measure { key: string; label: string; target: number; start: number; now: number; unit: string }

export interface FitProgress {
  stage: string;
  evaluations: number;
  /** about how many evaluations the fit takes */
  budget: number;
  distance: number;
  design: VoiceDesign;
}

export interface FitOptions {
  /** the voice says the text of the recording (its pace is then compared second by second) */
  sameText: boolean;
  /** the voice to start from (otherwise a man, a woman or a child, by the pitch) */
  start?: VoiceDesign;
  /** 1: the full fit; less, fewer rounds */
  effort?: number;
  onProgress?: (p: FitProgress) => void;
  /** checked between evaluations: true stops the fit where it is */
  stop?: () => boolean;
}

export interface FitResult {
  design: VoiceDesign;
  target: VoicePrint;
  print: VoicePrint;
  startDistance: number;
  distance: number;
  evaluations: number;
  measures: Measure[];
}

type Kind = 'st' | 'pct' | 'db' | 'abs';
interface Term { key: string; label: string; unit: string; get: (p: VoicePrint) => number; kind: Kind; scale: number; text?: 'same' | 'other' }

const TERMS: Term[] = [
  { key: 'f0', label: 'pitch', unit: 'Hz', get: (p) => p.f0, kind: 'st', scale: 0.3 },
  // the range is measured from the median, so that a melody can widen without the voice moving up or down
  { key: 'below', label: 'range below the median (5 %)', unit: 'st', get: (p) => 12 * Math.log2(p.f0 / p.f0Low), kind: 'abs', scale: 0.6 },
  { key: 'above', label: 'range above the median (95 %)', unit: 'st', get: (p) => 12 * Math.log2(p.f0High / p.f0), kind: 'abs', scale: 0.6 },
  { key: 'f0Sd', label: 'pitch spread', unit: 'st', get: (p) => p.f0Sd, kind: 'abs', scale: 0.4 },
  { key: 'F1', label: 'F1', unit: 'Hz', get: (p) => p.formants[0], kind: 'pct', scale: 5 },
  { key: 'F2', label: 'F2', unit: 'Hz', get: (p) => p.formants[1], kind: 'pct', scale: 3 },
  { key: 'F3', label: 'F3', unit: 'Hz', get: (p) => p.formants[2], kind: 'pct', scale: 3 },
  { key: 'F4', label: 'F4', unit: 'Hz', get: (p) => p.formants[3], kind: 'pct', scale: 3 },
  { key: 'h1h2', label: 'H1-H2', unit: 'dB', get: (p) => p.h1h2, kind: 'db', scale: 1.5 },
  { key: 'cpp', label: 'cepstral peak', unit: 'dB', get: (p) => p.cpp, kind: 'db', scale: 0.4 },
  // the harmonics at the formants against the first: the bands alone can be matched by more breath, which these tell apart
  { key: 'a1', label: 'H1-A1', unit: 'dB', get: (p) => p.h1a[0], kind: 'db', scale: 2 },
  { key: 'a2', label: 'H1-A2', unit: 'dB', get: (p) => p.h1a[1], kind: 'db', scale: 2 },
  { key: 'a3', label: 'H1-A3', unit: 'dB', get: (p) => p.h1a[2], kind: 'db', scale: 2 },
  { key: 'b1', label: 'voice 0.5-1 kHz', unit: 'dB', get: (p) => p.bands[1], kind: 'db', scale: 1.5 },
  { key: 'b2', label: 'voice 1-2 kHz', unit: 'dB', get: (p) => p.bands[2], kind: 'db', scale: 1.5 },
  { key: 'b3', label: 'voice 2-4 kHz', unit: 'dB', get: (p) => p.bands[3], kind: 'db', scale: 1.5 },
  { key: 'b4', label: 'voice 4-8 kHz', unit: 'dB', get: (p) => p.bands[4], kind: 'db', scale: 2 },
  { key: 'h0', label: 'hiss 2-4 kHz', unit: 'dB', get: (p) => p.hiss[0], kind: 'db', scale: 2.5 },
  { key: 'h1', label: 'hiss 4-8 kHz', unit: 'dB', get: (p) => p.hiss[1], kind: 'db', scale: 2.5 },
  { key: 'h2', label: 'hiss 8-10.5 kHz', unit: 'dB', get: (p) => p.hiss[2], kind: 'db', scale: 3 },
  { key: 'speech', label: 'time speaking', unit: 's', get: (p) => p.speech, kind: 'pct', scale: 4, text: 'same' },
  { key: 'syllables', label: 'syllables per second', unit: '/s', get: (p) => p.syllables, kind: 'pct', scale: 6, text: 'other' },
  { key: 'pause', label: 'mean pause', unit: 's', get: (p) => p.pause, kind: 'abs', scale: 0.06 },
];

function gap(t: Term, ours: VoicePrint, target: VoicePrint): number {
  const a = t.get(ours), b = t.get(target);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (t.key === 'pause' && a === 0 && b === 0) return NaN;
  switch (t.kind) {
    case 'st': return a > 0 && b > 0 ? 12 * Math.log2(a / b) : NaN;
    case 'pct': return b > 0 ? 100 * (a / b - 1) : NaN;
    default: return a - b;
  }
}

/** how far one print is from another, as the root mean square of the chosen gaps, each in its own scale */
export function distance(ours: VoicePrint, target: VoicePrint, keys: string[] | null, sameText: boolean): number {
  let s = 0, n = 0;
  for (const t of TERMS) {
    if (keys && !keys.includes(t.key)) continue;
    if (t.text && (t.text === 'same') !== sameText) continue;
    const g = gap(t, ours, target);
    if (Number.isNaN(g)) continue;
    s += (g / t.scale) ** 2; n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

interface Stage { name: string; params: [string, number][]; terms: string[]; rounds: number }

const BODY: [string, number][] = [['body.anatomy.scale', 0.04], ['body.anatomy.pharynx', 0.05], ['body.anatomy.palateHeight', 0.15], ['body.anatomy.tongueSize', 0.04], ['habits.tongueX', 0.1]];
const FOLDS: [string, number][] = [['phonation.rd', 0.2], ['phonation.returnPhase', 0.2], ['phonation.chink', 0.02], ['phonation.aspiration', 4], ['habits.epilarynx', 0.15]];
const STAGES: Stage[] = [
  { name: 'melody', params: [['speaking.accent', 1.5], ['speaking.style.phrase', 0.3], ['speaking.style.floor', 2], ['speaking.style.finalFall', 1.5], ['speaking.style.downstep', 0.05], ['speaking.style.endCreak', 0.2]], terms: ['below', 'above', 'f0Sd'], rounds: 3 },
  { name: 'body', params: BODY, terms: ['F1', 'F2', 'F3', 'F4', 'b1', 'b2', 'b3'], rounds: 3 },
  { name: 'folds', params: FOLDS, terms: ['h1h2', 'cpp', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4'], rounds: 2 },
  { name: 'hiss', params: [['phonation.obstacle', 4], ['phonation.frication', 4]], terms: ['h0', 'h1', 'h2'], rounds: 3 },
  { name: 'pace', params: [['speaking.rate', 0.08], ['speaking.style.pauseShort', 0.1], ['speaking.style.pauseLong', 0.15]], terms: ['speech', 'syllables', 'pause'], rounds: 2 },
  { name: 'polish', params: [...BODY, ...FOLDS].map(([p, s]) => [p, s / 2] as [string, number]), terms: [], rounds: 1 },
];

/** says the material with a voice, at a sample rate */
export function say(d: VoiceDesign, material: Material[], fs: number): Clip[] {
  return material.map((m) => {
    const u = utterance(d, m.phones, m.lang);
    const e = new VoiceEngine(fs, u.params);
    e.snapArticulators(); e.playScore(u.score);
    const n = Math.round((u.score.duration + 0.15) * fs), out = new Float32Array(n);
    e.process(out, n);
    return { samples: out, fs };
  });
}

/** the voice to start from, by the pitch of the recording */
export function startingVoice(target: VoicePrint): VoiceDesign {
  const id = target.f0 < 165 ? 'man' : target.f0 < 255 ? 'woman' : 'child';
  const d = cloneVoice(builtinVoice(id)!.design);
  return withField(d, 'speaking.f0', Math.round(target.f0));
}

export function fitVoice(target: VoicePrint, material: Material[], opt: FitOptions): FitResult {
  const fs = Math.max(16000, Math.min(24000, Math.round(target.fs)));
  const effort = Math.max(0.3, Math.min(1, opt.effort ?? 1));
  const budget = Math.round(5 + STAGES.reduce((a, s) => a + s.params.length * 1.6 * Math.max(1, Math.round(s.rounds * effort)), 0));
  let evaluations = 0;
  const measure = (d: VoiceDesign) => { evaluations++; return voicePrint(say(d, material, fs)); };
  let best = cloneVoice(opt.start ?? startingVoice(target));
  best.id = 'fitted';
  let print = measure(best);
  const startPrint = print;
  const all = () => distance(print, target, null, opt.sameText);
  const report = (stage: string) => opt.onProgress?.({ stage, evaluations, budget, distance: all(), design: best });
  const stopped = () => !!opt.stop?.();
  report('start');

  // the usual pitch: the planned pitch moved by what the heard one lacks
  const pitch = () => {
    for (let i = 0; i < 2 && !stopped(); i++) {
      const miss = 12 * Math.log2(target.f0 / print.f0);
      if (!Number.isFinite(miss) || Math.abs(miss) < 0.15) return;
      const d = withField(best, 'speaking.f0', Math.round((fieldValue(best, VOICE_FIELDS.find((f) => f.path === 'speaking.f0')!) as number) * 2 ** (miss / 12)));
      const p = measure(d);
      if (Math.abs(12 * Math.log2(target.f0 / p.f0)) < Math.abs(miss)) { best = d; print = p; }
      report('pitch');
    }
  };
  pitch();

  for (const stage of STAGES) {
    if (stopped()) break;
    const keys = stage.terms.length ? stage.terms : null;
    let cost = distance(print, target, keys, opt.sameText);
    const steps = new Map(stage.params);
    const rounds = Math.max(1, Math.round(stage.rounds * effort));
    for (let r = 0; r < rounds && !stopped(); r++) {
      for (const [path] of stage.params) {
        if (stopped()) break;
        const field = VOICE_FIELDS.find((f) => f.path === path);
        if (!field) continue;
        const step = steps.get(path)!;
        const v = fieldValue(best, field) as number;
        for (const dir of [1, -1]) {
          const d = withField(best, path, v + dir * step);
          if (fieldValue(d, field) === v) continue;
          const p = measure(d);
          const c = distance(p, target, keys, opt.sameText);
          report(stage.name);
          if (c < cost - 1e-3) { best = d; print = p; cost = c; break; }
        }
      }
      for (const [path, s] of steps) steps.set(path, s / 2);
    }
    if (stage.name === 'melody' || stage.name === 'polish') pitch();
  }
  report('done');
  const measures: Measure[] = TERMS.filter((t) => !t.text || (t.text === 'same') === opt.sameText).map((t) => ({ key: t.key, label: t.label, unit: t.unit, target: t.get(target), start: t.get(startPrint), now: t.get(print) }));
  return { design: best, target, print, startDistance: distance(startPrint, target, null, opt.sameText), distance: all(), evaluations, measures };
}
