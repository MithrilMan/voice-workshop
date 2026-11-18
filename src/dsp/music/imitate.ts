/**
 * A sound of the mouth that imitates a recording: a noise, a drum hit, a
 * click, a hum, made into a sound of the voice's own mouth. Analysis by
 * synthesis: the recording is cut to its sound (from where it strikes to
 * where it dies away), and many sounds of speech (stops, ejectives,
 * affricates, fricatives, clicks, trills, inward sounds; hums and vowels on
 * the recording's own pitch when it has one) are said by the voice and cut
 * the same way; the one whose spectrum, moment by moment, is nearest the
 * recording's wins. The best few are then refined on the size of the head
 * (higher or lower resonances) and the length of their last sound.
 *
 * It finds the nearest sound the mouth can make, not a copy: a whistle, a
 * sound with two pitches, or one that is not a sound of a mouth at all
 * come out as the mouth's nearest attempt (the distance says how near).
 */
import { drumHit, envelope, strikeOf, BEATBOX_KIT, type DrumSound } from './beat';
import { pitchTrack } from './transcribe';
import { decimate } from '../analysis/lpc';
import { melBank, applyMel, type MelBank } from '../analysis/mel';
import { powerSpectrum, hann } from '../util/fft';
import type { VoiceDesign } from '../voice/design';

/** sounds without voice tried for a recording without pitch */
const VOICELESS = [
  'p', 't', 'k', 'q', 'ʔ', 'pʼ', 'tʼ', 'kʼ', 'qʼ', 'pf', 'ts', 'tʃ', 'tɕ', 'kx', 'pɸ', 'tsʼ', 'tʃʼ', 'kxʼ', 'pɸʼ', 'pʃ', 'kʃ',
  'ɸ', 'f', 'θ', 's', 'ʃ', 'ɕ', 'ç', 'x', 'χ', 'ħ', 'h', 'ɬ', 'sː', 'ʃː', 'fː', 'xː',
  'ʘ', 'ǀ', 'ǃ', 'ǂ', 'ǁ', 'ǃʷ', 'ʙ̥', 'r̥', 'ʙ̥ː', 'r̥ː', 'p↓', 'k↓', 's↓', 'ʃ↓', 't↓s↓', 'ʙ̥↓',
];
/** sounds with voice tried on the recording's pitch */
const VOICED = ['m', 'n', 'ŋ', 'mː', 'ʙ', 'ʙː', 'r', 'v', 'z', 'ʒ', 'a', 'e', 'i', 'o', 'u', 'ə', 'ɯ', 'aː', 'uː', 'iː', 'ə̰ː', 'bmː', 'ɓ', 'ʔʌ̆', 'ᵑǃ', 'ɰɯ', 'wa', 'ja', 'ba', 'da', 'ɡa'];

export interface ImitateOptions {
  /** the sounds to try (IPA), in place of the usual ones */
  candidates?: string[];
  /** refine the best few on the size of the head and their length (true) */
  refine?: boolean;
  /** hears of the progress: tries done, of how many, the best so far */
  onProgress?: (done: number, total: number, best: string) => void;
}

export interface Imitation {
  /** the sound found, ready for a beat (BeatOptions.sounds): give it a name and a code of your own */
  sound: DrumSound;
  /** how far it is from the recording: the rms difference of their spectra, moment by moment, dB */
  distance: number;
  /** every sound tried, nearest first */
  tried: { ipa: string; distance: number }[];
  /** the recording's pitch, Hz (none: without voice) */
  f0?: number;
  /** our sound, and the recording cut to its sound, at `fs` */
  samples: Float32Array;
  target: Float32Array;
  fs: number;
}

/**
 * A recording cut to its sound as a sound of the kit is cut (strikeOf):
 * from 12 ms before it strikes to where it falls into the background
 * (1.2 s on at most); and how far below its loudest the background is, dB.
 */
function cutToSound(x: Float32Array, fs: number): { cut: Float32Array; floor: number } {
  const env = envelope(x, fs);
  if (!env.length) throw new Error('the recording is empty');
  const top = Math.max(...env), floor = [...env].sort((a, b) => a - b)[Math.floor(0.1 * env.length)];
  if (top - floor < 12 || top < -75) throw new Error('no sound found in the recording: make it louder, or nearer the microphone');
  const { hit } = strikeOf(env, 0, 50);
  const quiet = Math.max(top - 50, floor + 8);
  let end = hit;
  while (end < env.length - 1 && end - hit < 1200 && env.slice(end + 1, end + 40).some((v) => v >= quiet)) end++;
  const ms = fs / 1000;
  return { cut: x.slice(Math.max(0, Math.round((hit - 12) * ms)), Math.min(x.length, Math.round((end + 10) * ms))), floor: Math.max(-60, floor + 6 - top) };
}

interface Print { frames: Float64Array[]; energy: number[] }
const FLOOR = -60;

/**
 * A spectrogram of a sound: mel bands every 5 ms, each the power of 25 ms
 * around it (a noise said twice is never the same noise: averaged, its
 * spectrum is), dB against its loudest moment, floored 60 dB below it.
 */
function printOf(x: ArrayLike<number>, fs: number, bank: MelBank, win: number): Print {
  const hop = Math.max(1, Math.round(0.005 * fs)), w = hann(win);
  const raw: Float64Array[] = [], rawE: number[] = [];
  const buf = new Float64Array(win);
  for (let s = 0; s + hop <= x.length; s += hop) {
    for (let i = 0; i < win; i++) buf[i] = s + i < x.length ? x[s + i] : 0;
    const p = powerSpectrum(buf, win, w);
    let e = 0;
    for (let k = 0; k < p.length; k++) e += p[k];
    const m = applyMel(bank, p);
    for (let b = 0; b < m.length; b++) m[b] = Math.exp(m[b]);
    raw.push(m);
    rawE.push(e);
  }
  const frames: Float64Array[] = [], energy: number[] = [];
  for (let f = 0; f < raw.length; f++) {
    const m = new Float64Array(bank.nMels);
    let e = 0, n = 0;
    for (let g = Math.max(0, f - 2); g <= Math.min(raw.length - 1, f + 2); g++) { for (let b = 0; b < m.length; b++) m[b] += raw[g][b]; e += rawE[g]; n++; }
    for (let b = 0; b < m.length; b++) m[b] = 10 * Math.log10(m[b] / n + 1e-20);
    frames.push(m);
    energy.push(10 * Math.log10(e / n + 1e-20));
  }
  const top = Math.max(...energy);
  for (let f = 0; f < frames.length; f++) {
    energy[f] -= top;
    for (let b = 0; b < frames[f].length; b++) frames[f][b] = Math.max(FLOOR, frames[f][b] - top);
  }
  return { frames, energy };
}

/**
 * How far two sounds are: the rms difference of their spectra moment by
 * moment (each floored at `floor` dB, the background of the recording),
 * loud moments counting most, along the best alignment of the two in time
 * that never puts a moment more than 30 ms from its place (the same sound
 * said twice is never timed quite the same).
 */
function distanceOf(a: Print, b: Print, floor = FLOOR): number {
  const n = Math.max(a.frames.length, b.frames.length), bands = a.frames[0]?.length ?? 0, R = 6;
  const at = (p: Print, f: number) => p.frames[f];
  const cost = (i: number, j: number): [number, number] => {
    const fa = at(a, i), fb = at(b, j);
    const w = 10 ** (Math.max(fa ? a.energy[i] : floor, fb ? b.energy[j] : floor, floor) / 20);
    let d = 0;
    for (let k = 0; k < bands; k++) { const x = Math.max(floor, fa ? fa[k] : floor) - Math.max(floor, fb ? fb[k] : floor); d += x * x; }
    return [(w * d) / bands, w];
  };
  // dynamic time warping in a band around the diagonal: the least weighted sum, and its weights
  const S = new Float64Array(n * n).fill(Infinity), W = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) {
      const [c, w] = cost(i, j);
      let s = 0, ws = 0;
      if (i > 0 || j > 0) {
        s = Infinity;
        for (const [pi, pj] of [[i - 1, j - 1], [i - 1, j], [i, j - 1]]) {
          if (pi < 0 || pj < 0) continue;
          const v = S[pi * n + pj];
          if (v < s) { s = v; ws = W[pi * n + pj]; }
        }
      }
      S[i * n + j] = s + c; W[i * n + j] = ws + w;
    }
  }
  return Math.sqrt(S[n * n - 1] / Math.max(W[n * n - 1], 1e-9));
}

/** Finds the sound of a voice's mouth nearest a recording (see above). */
export function imitate(voice: Readonly<VoiceDesign>, samples: Float32Array, fs0: number, o: ImitateOptions = {}): Imitation {
  // analysed at about 24 kHz
  const k = fs0 > 30000 ? Math.round(fs0 / 24000) : 1;
  const fs = fs0 / k;
  const { cut: target, floor } = cutToSound(k > 1 ? Float32Array.from(decimate(samples, k)) : samples, fs);
  const win = 2 ** Math.round(Math.log2(0.02 * fs));
  const bank = melBank(24, win, fs, 100, Math.min(11000, fs / 2 - 200));
  const want = printOf(target, fs, bank, win);
  if (want.frames.length < 3) throw new Error('the sound is too short to imitate');

  // its pitch, if most of its loud part has one (and a glide, if it moves by more than a semitone and a half)
  const tr = pitchTrack(target, fs, 50, 1000);
  const loud = tr.level.map((l, i) => ({ l, f: tr.f0[i] })).filter((x) => x.l > Math.max(...tr.level) - 25);
  const voicedF = loud.map((x) => x.f).filter((f) => f > 0);
  // (a burst rings for a few milliseconds at its resonance: a voice holds its pitch for 60 ms at least)
  const voiced = loud.length > 0 && voicedF.length >= 0.5 * loud.length && voicedF.length >= 6;
  const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  let f0: number | undefined, f0End: number | undefined;
  if (voiced) {
    const third = Math.max(1, Math.floor(voicedF.length / 3));
    const a = med(voicedF.slice(0, third)), b = med(voicedF.slice(-third));
    f0 = med(voicedF);
    if (Math.abs(12 * Math.log2(b / a)) > 1.5) { f0 = a; f0End = b; }
  }

  // the sounds to try: the usual ones (those with voice on the recording's pitch, if it has one), and the kit's
  const kit = BEATBOX_KIT.flatMap((s) => [s.ipa, ...s.alternatives]);
  const list = [...new Set(o.candidates ?? [...(voiced ? VOICED : []), ...VOICELESS, ...kit])];
  const say = (ipa: string, knobs: Record<string, number> = {}, hold = 1) => drumHit(voice, ipa, fs, { seed: 1, f0: voiced ? f0 : undefined, f0End: voiced ? f0End : undefined, hold, knobs });
  const total = list.length + (o.refine === false ? 0 : 3 * 16);
  let done = 0;
  const tried: { ipa: string; distance: number }[] = [];
  for (const ipa of list) {
    try { tried.push({ ipa, distance: distanceOf(want, printOf(say(ipa).samples, fs, bank, win), floor) }); } catch { /* a sound the reader cannot say is left out */ }
    done++;
    tried.sort((a, b) => a.distance - b.distance);
    o.onProgress?.(done, total, tried[0]?.ipa ?? '');
  }
  if (!tried.length) throw new Error('no sound could be tried');

  // the best three refined: the head larger or smaller, the last sound longer or shorter
  const scale0 = voice.body.anatomy.scale || 1;
  let best = { ipa: tried[0].ipa, scale: 1, hold: 1, distance: tried[0].distance };
  if (o.refine !== false) {
    for (const c of tried.slice(0, 3)) {
      let at = { scale: 1, hold: 1 }, d = c.distance, steps = { scale: 0.1, hold: 0.45 }, evals = 0;
      const tryAt = (p: { scale: number; hold: number }) => {
        evals++; done++;
        const h = say(c.ipa, { 'body.anatomy.scale': scale0 * p.scale }, p.hold);
        const dist = distanceOf(want, printOf(h.samples, fs, bank, win), floor);
        o.onProgress?.(Math.min(done, total), total, best.ipa);
        return dist;
      };
      for (let round = 0; round < 4 && evals < 16; round++) {
        let moved = false;
        for (const key of ['scale', 'hold'] as const) {
          for (const dir of [1, -1]) {
            if (evals >= 16) break;
            const p = { ...at, [key]: at[key] * Math.exp(dir * steps[key]) };
            p.scale = Math.max(0.7, Math.min(1.35, p.scale));
            p.hold = Math.max(0.4, Math.min(3, p.hold));
            const dist = tryAt(p);
            if (dist < d - 0.05) { d = dist; at = p; moved = true; break; }
          }
        }
        if (!moved) { steps = { scale: steps.scale / 2, hold: steps.hold / 2 }; }
      }
      done += 16 - evals;
      if (d < best.distance) best = { ipa: c.ipa, scale: at.scale, hold: at.hold, distance: d };
    }
  }
  const knobs = Math.abs(best.scale - 1) > 1e-3 ? { 'body.anatomy.scale': +(scale0 * best.scale).toFixed(3) } : undefined;
  const hold = Math.abs(best.hold - 1) > 1e-3 ? +best.hold.toFixed(2) : undefined;
  const ours = say(best.ipa, knobs, hold ?? 1);
  const sound: DrumSound = {
    id: 'own', code: 'own', name: 'Your sound', family: 'fx', ipa: best.ipa,
    alternatives: tried.filter((t) => t.ipa !== best.ipa).slice(0, 4).map((t) => t.ipa),
    ...(voiced ? { f0: Math.round(f0!), ...(f0End ? { f0End: Math.round(f0End) } : {}) } : {}),
    ...(hold ? { hold } : {}), ...(knobs ? { knobs } : {}),
    level: -2, hint: `the mouth's nearest to a recording: [${best.ipa}]${knobs ? `, head ×${best.scale.toFixed(2)}` : ''}${hold ? `, held ×${hold}` : ''}`,
  };
  o.onProgress?.(total, total, best.ipa);
  return { sound, distance: +best.distance.toFixed(2), tried: tried.map((t) => ({ ipa: t.ipa, distance: +t.distance.toFixed(2) })), ...(voiced ? { f0: Math.round(f0!) } : {}), samples: ours.samples, target, fs };
}
