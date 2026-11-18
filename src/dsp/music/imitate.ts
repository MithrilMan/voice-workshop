/**
 * A sound of the mouth that imitates a recording: a noise, a drum hit, a
 * click, a hum, made into a sound of the voice's own mouth; or an effect
 * made of several (a run of taps, then a roar) made into as many sounds in
 * time. Analysis by synthesis: the recording is cut to its sound (from where
 * it strikes to where it dies away), and many sounds of speech (stops,
 * ejectives, affricates, fricatives, clicks, trills, inward sounds; hums and
 * vowels on the recording's own pitch when it has one) are said by the voice
 * and cut the same way; the one whose spectrum, moment by moment, is nearest
 * the recording's wins. The nearest are then held as long as the recording,
 * put in a row with other sounds (a stop before them, a hiss or a hum after:
 * a [p] going into a long [ts]), and refined on the size of the head (higher
 * or lower resonances), the length of their last sound and how it dies away.
 *
 * A recording that strikes again and again (its level climbing 12 dB or
 * more after a dip, 70 ms or more apart) is heard as sounds in time: each
 * stretch from one strike to the next is imitated so (stretches alike once,
 * the loudest of them), and the sound found is made of them, each at its
 * time and level (DrumSound.parts).
 *
 * It finds the nearest sound the mouth can make, not a copy: a whistle, a
 * sound with two pitches, or one that is not a sound of a mouth at all
 * come out as the mouth's nearest attempt (the distance says how near).
 */
import { drumHit, envelope, BEATBOX_KIT, type DrumHit, type DrumPart, type DrumSound } from './beat';
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
/** sounds tried before the best ones (a stop striking into them) and after them (a hiss or a hum they go on into) */
const BEFORE = ['p', 't', 'k', 'pʼ', 'tʼ', 'kʼ', 'b', 'd', 'ɡ', 'ʔ'];
const AFTER = ['s', 'ʃ', 'f', 'x', 'h', 'ɸ', 'ç', 'ts', 'tʃ'];
const AFTER_VOICED = ['m', 'n', 'z', 'v', 'a', 'u', 'i', 'r'];
/** sounds that go on as long as the breath: the long part of a recording after its strike is tried against each, held */
const CONTINUANT = new Set(['ɸ', 'f', 'θ', 's', 'ʃ', 'ɕ', 'ç', 'x', 'χ', 'ħ', 'h', 'ɬ', 's↓', 'ʃ↓', 'ʙ̥', 'r̥', 'm', 'n', 'ŋ', 'ʙ', 'r', 'v', 'z', 'ʒ', 'a', 'e', 'i', 'o', 'u', 'ə', 'ɯ']);
/** the longest stretch of a recording imitated, ms from its first strike */
const LONGEST = 4000;
/** the most stretches of a recording searched each on its own (the others take the sound of the one nearest them) */
const GROUPS = 4;
/** the longest a last sound is held, × its spoken length */
const MAX_HOLD = 12;

export interface ImitateOptions {
  /** the sounds to try (IPA), in place of the usual ones */
  candidates?: string[];
  /** hold the nearest to the recording's length, try them in a row with other sounds, refine them (true) */
  refine?: boolean;
  /** a recording that strikes again and again heard as sounds in time (true); false: as one sound */
  phrase?: boolean;
  /** hears of the progress: tries done, of how many, the best so far */
  onProgress?: (done: number, total: number, best: string) => void;
}

export interface Imitation {
  /** the sound found, ready for a beat (BeatOptions.sounds): give it a name and a code of your own */
  sound: DrumSound;
  /** how far it is from the recording: the rms difference of their spectra, moment by moment, dB */
  distance: number;
  /** every sound tried, nearest first, each said the way that brought it nearest (ready for a beat, as `sound`); none for sounds in time */
  tried: { ipa: string; distance: number; sound: DrumSound }[];
  /** the recording's pitch, Hz (none: without voice, or sounds in time) */
  f0?: number;
  /** sounds in time: each stretch of the recording, when it strikes (s after the first), how long it is (s), the sound found for it and how far that is (dB) */
  events?: { at: number; length: number; ipa: string; distance: number }[];
  /** our sound, and the recording cut to its sound, at `fs` */
  samples: Float32Array;
  target: Float32Array;
  fs: number;
}

/** the level of each millisecond smoothed over 10 ms (as power), dB */
function smoothed(env: readonly number[]): number[] {
  const p = env.map((e) => 10 ** (e / 10)), out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 5); j < Math.min(p.length, i + 5); j++) { s += p[j]; n++; }
    out.push(10 * Math.log10(s / n + 1e-20));
  }
  return out;
}

/**
 * Where each sound of a recording strikes, ms (its level every millisecond
 * given): where the level, smoothed over 10 ms, climbs 12 dB or more within
 * 30 ms to within 30 dB of the loudest, 70 ms or more after the strike
 * before (the beats of a trill come closer: a trill is one sound); the
 * strike is the first millisecond within 12 dB of where the climb tops out.
 * A sound that swells in (a hum) strikes where it first comes within 12 dB
 * of the loudest.
 */
function strikesOf(env: readonly number[], sm: readonly number[], top: number): number[] {
  const out: number[] = [];
  for (let i = 30; i < sm.length; i++) {
    if (sm[i] < top - 30) continue;
    let lo = Infinity;
    for (let j = i - 30; j < i; j++) lo = Math.min(lo, sm[j]);
    if (sm[i] - lo < 12) continue;
    let peak = i;
    for (let j = i; j < Math.min(env.length, i + 40); j++) if (env[j] > env[peak]) peak = j;
    let s = i - 20;
    while (s < peak && env[s] < env[peak] - 12) s++;
    if (!out.length || s - out[out.length - 1] >= 70) out.push(s);
    i = peak + 10;
  }
  const first = env.findIndex((e) => e >= top - 12);
  if (!out.length || out[0] - first >= 70) out.unshift(first);
  return out;
}

/**
 * A recording cut to its sound as a sound of the kit is cut: from 12 ms
 * before it first strikes to where it last stands above its background (4 s
 * on at most); how far below its loudest the background is, dB; and where
 * each of its sounds strikes (see strikesOf), s from the start of the cut.
 */
function cutToSound(x: Float32Array, fs: number): { cut: Float32Array; floor: number; strikes: number[] } {
  const env = envelope(x, fs);
  if (!env.length) throw new Error('the recording is empty');
  const top = Math.max(...env), floor = [...env].sort((a, b) => a - b)[Math.floor(0.1 * env.length)];
  if (top - floor < 12 || top < -75) throw new Error('no sound found in the recording: make it louder, or nearer the microphone');
  const sm = smoothed(env), strikes = strikesOf(env, sm, top), hit = strikes[0];
  const quiet = Math.max(top - 50, floor + 8);
  let end = Math.min(env.length - 1, hit + LONGEST);
  while (end > hit && sm[end] < quiet) end--;
  const ms = fs / 1000, a = Math.max(0, Math.round((hit - 12) * ms));
  return {
    cut: x.slice(a, Math.min(x.length, Math.round((end + 10) * ms))),
    floor: Math.max(-60, floor + 6 - top),
    strikes: strikes.filter((s) => s < end - 30).map((s) => (s * ms - a) / fs),
  };
}

/** the loudest 20 ms of a sound, dB (rms) */
function loudness(x: ArrayLike<number>, fs: number): number {
  const w = Math.max(1, Math.round(0.02 * fs)), hop = Math.max(1, w >> 2);
  let best = 0;
  for (let i = 0; i + w <= x.length; i += hop) { let e = 0; for (let k = i; k < i + w; k++) e += x[k] * x[k]; best = Math.max(best, e / w); }
  return 10 * Math.log10(best + 1e-20);
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
    const m = applyMel(bank, p);
    // (the energy of the bands themselves, from 100 Hz: the air of a [p] blown on a microphone thumps below it)
    let e = 0;
    for (let b = 0; b < m.length; b++) { m[b] = Math.exp(m[b]); e += m[b]; }
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

/** a print up to its `n`-th moment (a sound cut where the next one strikes), against its own loudest moment again */
function upTo(p: Print, n: number): Print {
  if (p.frames.length <= n) return p;
  const energy = p.energy.slice(0, n), top = Math.max(...energy);
  return { frames: p.frames.slice(0, n).map((f) => f.map((v) => Math.max(FLOOR, v - top))), energy: energy.map((e) => e - top) };
}

/** how far under the loudest band of a moment a band still counts, dB; how much a difference of level counts against one of colour */
const RANGE = 30, LEVEL = 0.3;

/**
 * How far two sounds are: the rms difference of their spectra moment by
 * moment (each floored at `floor` dB, the background of the recording, and
 * 30 dB under the loudest band of the moment: what is far under the loud
 * part of a sound is not heard), the colour counting fully and the level
 * of the whole moment (one louder all over) a third as much (a burst and
 * the hiss after it are never loud in the same way twice); louder moments
 * counting more (20 dB down, a third as much: the hiss after a burst is as
 * much the sound as the burst); along the best alignment of the two in
 * time that never puts a moment more than 60 ms from its place (the same
 * sound said twice is never timed quite the same).
 */
function distanceOf(a: Print, b: Print, floor = FLOOR): number {
  const n = Math.max(a.frames.length, b.frames.length), bands = a.frames[0]?.length ?? 0, R = 12;
  const x = new Float64Array(bands);
  const cost = (i: number, j: number): [number, number] => {
    const fa = a.frames[i], fb = b.frames[j];
    const w = 10 ** (Math.max(fa ? a.energy[i] : floor, fb ? b.energy[j] : floor, floor) / 40);
    let top = floor;
    for (let k = 0; k < bands; k++) top = Math.max(top, fa ? fa[k] : floor, fb ? fb[k] : floor);
    const lo = Math.max(floor, top - RANGE);
    let m = 0;
    for (let k = 0; k < bands; k++) { x[k] = Math.max(lo, fa ? fa[k] : floor) - Math.max(lo, fb ? fb[k] : floor); m += x[k]; }
    m /= bands;
    let d = 0;
    for (let k = 0; k < bands; k++) d += (x[k] - m) ** 2;
    return [w * (d / bands + LEVEL * m * m), w];
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

/** the level of a stretch of a print, dB: the average of its moments above `floor` */
function levelOf(energy: readonly number[], floor: number): number {
  const above = energy.filter((e) => e > floor);
  return above.length ? above.reduce((s, e) => s + e, 0) / above.length : floor;
}

/**
 * The print of one sound going into another, joined on paper (neither is
 * said again): the first up to where it has died 20 dB under its loudest,
 * then the second, set to `level` dB under the loudest of the first (its
 * moments above `floor`, on average).
 */
function joined(a: Print, b: Print, level: number, floor: number): Print {
  let peak = 0;
  for (let f = 1; f < a.energy.length; f++) if (a.energy[f] > a.energy[peak]) peak = f;
  let end = peak + 1;
  while (end < a.energy.length && a.energy[end] > a.energy[peak] - 20) end++;
  const shift = level - levelOf(b.energy, floor);
  const energy = [...a.energy.slice(0, end), ...b.energy.map((e) => e + shift)];
  const top = Math.max(...energy);
  const frames = [...a.frames.slice(0, end), ...b.frames.map((f) => f.map((v) => v + shift))].map((f) => f.map((v) => Math.max(FLOOR, v - top)));
  return { frames, energy: energy.map((e) => e - top) };
}

/** a way of saying a sound: its sounds in a row (IPA), the head's size (× the voice's), its last sound held (×), the push let go through it (0-0.9) */
interface Way { parts: string[]; scale: number; hold: number; fade: number }
/** a way said: its print, how long it is (s), how long its last sound is when not held (s) */
interface Said { print: Print; length: number; one: number }

/**
 * A voice's mouth saying sounds for an imitation: each way of saying a
 * sound (on each pitch) said once, its print kept for every stretch of a
 * recording that tries it.
 */
class Mouth {
  private memo = new Map<string, Said | null>();
  readonly scale0: number;
  constructor(readonly voice: Readonly<VoiceDesign>, readonly fs: number, readonly bank: MelBank, readonly win: number) {
    this.scale0 = voice.body.anatomy.scale || 1;
  }

  /** the fields of the voice changed for a head of `scale` × its own */
  knobs(scale: number): Record<string, number> | undefined {
    return Math.abs(scale - 1) > 1e-3 ? { 'body.anatomy.scale': +(this.scale0 * scale).toFixed(3) } : undefined;
  }

  hit(w: Way, f0?: number, f0End?: number): DrumHit {
    return drumHit(this.voice, w.parts.join(''), this.fs, { seed: 1, f0, f0End, hold: w.hold, fade: w.fade, knobs: this.knobs(w.scale) ?? {} });
  }

  /** a way said (none: one the reader cannot say) */
  said(w: Way, f0?: number, f0End?: number): Said | undefined {
    const key = `${w.parts.join('')}|${w.scale}|${w.hold}|${w.fade}|${f0 ?? ''}|${f0End ?? ''}`;
    if (!this.memo.has(key)) {
      try {
        const h = this.hit(w, f0, f0End), last = h.phones[h.phones.length - 1];
        this.memo.set(key, { print: printOf(h.samples, this.fs, this.bank, this.win), length: h.samples.length / this.fs, one: last ? Math.max(0.02, (last.t1 - last.t0) / w.hold) : 1 });
      } catch { this.memo.set(key, null); }
    }
    return this.memo.get(key) ?? undefined;
  }
}

/** a way tried: its IPA, how far it is from the recording, how long it is (s), how long its last sound is when not held (s), and how long that must be held for it to last as long as the recording */
interface Try extends Way { ipa: string; distance: number; length: number; one: number; fit: number }

/** what a search found */
interface Found {
  best: Try;
  /** the nearest way of saying each sound tried, nearest first */
  all: Try[];
  voiced: boolean;
  f0?: number;
  f0End?: number;
  /** a way as a sound for a beat */
  soundOf(t: Try, hint: string): DrumSound;
}

/**
 * The search for the sound of `mouth` nearest one stretch of a recording
 * (cut as the kit's sounds are, its background `floor` dB under its
 * loudest); `limit`, s: the stretch is cut there by the next sound, and so
 * is every sound tried for it.
 */
function search(mouth: Mouth, target: Float32Array, floor: number, o: ImitateOptions, limit?: number): { total: number; best: () => string; run: (progress: (done: number) => void) => Found } {
  const { fs, bank, win } = mouth;
  const want = printOf(target, fs, bank, win);
  if (want.frames.length < 3) throw new Error('the sound is too short to imitate');
  const hop = Math.max(1, Math.round(0.005 * fs));
  const most = limit === undefined ? Infinity : Math.max(3, Math.round((limit * fs) / hop));
  const cut = (p: Print) => (Number.isFinite(most) ? upTo(p, most) : p);

  // its pitch, if most of its loud part has one (and a glide, if it moves by more than a semitone and a half),
  // to the nearest quarter of a semitone (stretches on nearly the same pitch say their sounds once)
  const tr = pitchTrack(target, fs, 50, 1000);
  const loud = tr.level.map((l, i) => ({ l, f: tr.f0[i] })).filter((x) => x.l > Math.max(...tr.level) - 25);
  const voicedF = loud.map((x) => x.f).filter((f) => f > 0);
  // (a burst rings for a few milliseconds at its resonance: a voice holds its pitch for 60 ms at least)
  const voiced = loud.length > 0 && voicedF.length >= 0.5 * loud.length && voicedF.length >= 6;
  const med = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const quarter = (f: number) => 55 * 2 ** (Math.round(48 * Math.log2(f / 55)) / 48);
  let f0: number | undefined, f0End: number | undefined;
  if (voiced) {
    const third = Math.max(1, Math.floor(voicedF.length / 3));
    const a = med(voicedF.slice(0, third)), b = med(voicedF.slice(-third));
    f0 = quarter(med(voicedF));
    if (Math.abs(12 * Math.log2(b / a)) > 1.5) { f0 = quarter(a); f0End = quarter(b); }
  }

  // the sounds to try: the usual ones (those with voice on the recording's pitch, if it has one), and the kit's
  const kit = BEATBOX_KIT.flatMap((s) => [s.ipa, ...s.alternatives]);
  const list = [...new Set(o.candidates ?? [...(voiced ? VOICED : []), ...VOICELESS, ...kit])];
  const refine = o.refine !== false, length = target.length / fs;
  // where the recording's strike ends and what it goes into begins (a [p] and the long [s] after it): 20 ms
  // after its loudest early moment, once 6 dB under it, 80 ms at most; looked at apart if 100 ms or more follow
  const peak = want.energy.slice(0, 25).reduce((b, e, i, a) => (e > a[b] ? i : b), 0);
  let split = peak + 4;
  while (split < peak + 16 && split < want.energy.length - 1 && want.energy[split] > want.energy[peak] - 6) split++;
  const restLength = length - split * hop / fs, apart = refine && restLength >= 0.1;
  const wantRest = apart ? printOf(target.subarray(split * hop), fs, bank, win) : undefined;
  const restLevel = levelOf(want.energy.slice(split), floor);

  const LONGER = 12, RESTS = 3, PAIRS = 6, BASES = 2, EVALS = 16;
  const after = [...AFTER, ...(voiced ? AFTER_VOICED : [])];
  const continuants = list.filter((ipa) => CONTINUANT.has(ipa));
  const total = list.length + (refine ? LONGER + (apart ? continuants.length + PAIRS + BEFORE.length : 2 * (BEFORE.length + after.length)) + (BASES + 1) * EVALS + 2 : 0);
  /** what a sound is worth: its distance, and a tenth of a decibel for each sound more in the row (of two as near, the simpler) */
  const worth = (t: Try) => t.distance + 0.1 * (t.parts.length - 1);
  const said = (w: Way) => mouth.said(w, f0, f0End);
  let done = 0, best = undefined as Try | undefined, progress: (done: number) => void = () => undefined;
  const tried = new Map<string, Try>();
  /** a way said and measured against the recording (none: one the reader cannot say) */
  const measure = (w: Way): Try | undefined => {
    done++;
    const t: Way = { parts: w.parts, scale: +w.scale.toFixed(3), hold: +w.hold.toFixed(2), fade: +w.fade.toFixed(2) };
    const ipa = t.parts.join(''), key = `${ipa}|${t.scale}|${t.hold}|${t.fade}`;
    if (tried.has(key)) return tried.get(key);
    const s = said(t);
    let r: Try | undefined;
    if (s) {
      r = { ...t, ipa, distance: distanceOf(want, cut(s.print), floor), length: s.length, one: s.one, fit: Math.max(1, Math.min(MAX_HOLD, t.hold + (length - s.length) / s.one)) };
      tried.set(key, r);
      if (!best || worth(r) < worth(best)) best = r;
    }
    progress(done);
    return r;
  };
  /** the nearest `n` sounds, one way of saying each */
  const nearest = (n: number): Try[] => {
    const seen = new Set<string>();
    return [...tried.values()].sort((a, b) => worth(a) - worth(b)).filter((t) => !seen.has(t.ipa) && !!seen.add(t.ipa)).slice(0, n);
  };

  const run = (p: (done: number) => void): Found => {
    progress = p;
    // 1. every sound as it is said
    for (const ipa of list) measure({ parts: [ipa], scale: 1, hold: 1, fade: 0 });
    if (!tried.size) throw new Error('no sound could be tried');
    if (refine) {
      const alone = [...tried.values()];
      // 2. the nearest held as long as the recording (a long hiss is far from a short one, however alike they start)
      for (const t of nearest(LONGER)) { if (Math.abs(Math.log(t.fit / t.hold)) > 0.15) measure({ ...t, hold: t.fit }); else done++; }
      // 3. a long recording as a strike and what it goes into: the sounds that go on, each held as long as the
      //    rest, against the rest; every other sound going into each of the nearest three, joined on paper (no
      //    sound said), against the whole; the nearest six of those said
      if (apart && wantRest) {
        const rests: { ipa: string; hold: number; d: number; print: Print }[] = [];
        for (const t of alone.filter((s) => CONTINUANT.has(s.ipa))) {
          done++;
          const hold = +Math.max(1, Math.min(MAX_HOLD, 1 + (restLength - t.length) / t.one)).toFixed(2);
          const s = said({ parts: [t.ipa], scale: 1, hold, fade: 0 });
          if (s) rests.push({ ipa: t.ipa, hold, d: distanceOf(wantRest, s.print, floor), print: s.print });
          progress(done);
        }
        rests.sort((a, b) => a.d - b.d);
        const pairs: { parts: string[]; hold: number; d: number }[] = [];
        for (const t of alone) {
          const s = CONTINUANT.has(t.ipa) ? undefined : said({ parts: [t.ipa], scale: 1, hold: 1, fade: 0 });
          if (s) for (const r of rests.slice(0, RESTS)) pairs.push({ parts: [t.ipa, r.ipa], hold: r.hold, d: distanceOf(want, cut(joined(s.print, r.print, restLevel, floor)), floor) });
        }
        pairs.sort((a, b) => a.d - b.d);
        for (const q of pairs.slice(0, PAIRS)) measure({ parts: q.parts, scale: 1, hold: q.hold, fade: 0 });
      }
      // 4. more sounds in a row: a stop before the nearest (a [p] going into [ts]); unless it already goes on
      //    into a long rest, a hiss or a hum after it too (held for what is left of the recording's length, by
      //    its length as said alone), and once more round the nearest of those, if it is another
      const grow = (b: Try) => {
        for (const s of BEFORE) measure({ ...b, parts: [s, ...b.parts], scale: 1, fade: 0 });
        if (apart) return;
        for (const s of after) {
          const one = tried.get(`${s}|1|1|0`);
          const hold = one ? Math.max(1, Math.min(MAX_HOLD, 1 + (length - (b.length - (b.hold - 1) * b.one) - one.length) / one.one)) : 1;
          measure({ parts: [...b.parts, s], scale: 1, hold, fade: 0 });
        }
      };
      const base = nearest(1)[0];
      grow(base);
      const now = nearest(1)[0];
      if (now.ipa !== base.ipa && !apart) grow(now);
      // 5. the nearest few refined, and the nearest single sound (of two as near, the simpler): the head larger
      //    or smaller, the last sound longer or shorter, dying away or not
      const single = nearest(Infinity).find((t) => t.parts.length === 1);
      const refined = nearest(BASES);
      if (single && !refined.some((t) => t.ipa === single.ipa)) refined.push(single);
      for (const c of refined) {
        let at = c, evals = 0, steps = { scale: 0.1, hold: 0.25, fade: 0.3 };
        const moved = (key: 'scale' | 'hold' | 'fade', dir: number): Way => key === 'fade'
          ? { ...at, fade: Math.max(0, Math.min(0.9, at.fade + dir * steps.fade)) }
          : key === 'scale'
            ? { ...at, scale: Math.max(0.7, Math.min(1.35, at.scale * Math.exp(dir * steps.scale))) }
            : { ...at, hold: Math.max(0.4, Math.min(MAX_HOLD, at.hold * Math.exp(dir * steps.hold))) };
        for (let round = 0; round < 6 && evals < EVALS; round++) {
          let better = false;
          for (const key of ['hold', 'fade', 'scale'] as const) {
            for (const dir of [1, -1]) {
              const w = moved(key, dir);
              if (evals >= EVALS || Math.abs(w[key] - at[key]) < 1e-3) continue;
              evals++;
              const r = measure(w);
              if (r && r.distance < at.distance - 0.05) { at = r; better = true; break; }
            }
          }
          if (!better) steps = { scale: steps.scale / 2, hold: steps.hold / 2, fade: steps.fade / 2 };
        }
        done += EVALS - evals;
      }
      // 6. the nearest held so that it is heard as long as the recording (to where it falls 30 dB under its
      //    loudest), in two steps, if that keeps it as near (within 0.15 dB): near the end of a dying hiss the
      //    distance hardly tells a longer one from a shorter (a stretch cut by the next sound needs none)
      const heard = (q: Print) => { let f = q.energy.length - 1; while (f > 0 && q.energy[f] < -30) f--; return (f * hop) / fs; };
      const first = nearest(1)[0];
      let at: Try | undefined = limit === undefined ? first : undefined;
      for (let step = 0; step < 2; step++) {
        const s = at && said(at);
        const hold = s && at ? Math.max(0.4, Math.min(MAX_HOLD, at.hold + (heard(want) - heard(s.print)) / at.one)) : 0;
        if (!at || !hold || Math.abs(Math.log(hold / at.hold)) <= 0.05) { done += 2 - step; break; }
        at = measure({ ...at, hold });
        if (at && at.distance <= first.distance + 0.15) best = at;
      }
    }
    const soundOf = (t: Try, hint: string): DrumSound => {
      const knobs = mouth.knobs(t.scale);
      const hold = Math.abs(t.hold - 1) > 1e-3 ? t.hold : undefined;
      const fade = t.fade > 1e-3 ? t.fade : undefined;
      return {
        id: 'own', code: 'own', name: 'Your sound', family: 'fx', ipa: t.ipa, alternatives: [],
        ...(voiced ? { f0: Math.round(f0!), ...(f0End ? { f0End: Math.round(f0End) } : {}) } : {}),
        ...(hold ? { hold } : {}), ...(fade ? { fade } : {}), ...(knobs ? { knobs } : {}),
        level: -2, hint: `${hint}: [${t.ipa}]${knobs ? `, head ×${t.scale.toFixed(2)}` : ''}${hold ? `, held ×${hold}` : ''}${fade ? ', dying away' : ''}`,
      };
    };
    return { best: best ?? nearest(1)[0], all: nearest(Infinity), voiced, f0, f0End, soundOf };
  };
  return { total, best: () => best?.ipa ?? '', run };
}

/** Finds the sound of a voice's mouth nearest a recording, or the sounds in time (see above). */
export function imitate(voice: Readonly<VoiceDesign>, samples: Float32Array, fs0: number, o: ImitateOptions = {}): Imitation {
  // analysed at about 24 kHz
  const k = fs0 > 30000 ? Math.round(fs0 / 24000) : 1;
  const fs = fs0 / k;
  const { cut: target, floor, strikes } = cutToSound(k > 1 ? Float32Array.from(decimate(samples, k)) : samples, fs);
  const win = 2 ** Math.round(Math.log2(0.02 * fs));
  const mouth = new Mouth(voice, fs, melBank(24, win, fs, 100, Math.min(11000, fs / 2 - 200)), win);

  if (o.phrase === false || strikes.length < 2) {
    const s = search(mouth, target, floor, o);
    const f = s.run((done) => o.onProgress?.(Math.min(done, s.total - 1), s.total, s.best()));
    const sound: DrumSound = { ...f.soundOf(f.best, "the mouth's nearest to a recording"), alternatives: f.all.filter((t) => t.ipa !== f.best.ipa).slice(0, 4).map((t) => t.ipa) };
    o.onProgress?.(s.total, s.total, f.best.ipa);
    return {
      sound, distance: +f.best.distance.toFixed(2),
      tried: f.all.map((t) => ({ ipa: t.ipa, distance: +t.distance.toFixed(2), sound: f.soundOf(t, "the mouth's attempt at a recording") })),
      ...(f.voiced ? { f0: Math.round(f.f0!) } : {}), samples: mouth.hit(f.best, f.f0, f.f0End).samples, target, fs,
    };
  }

  // sounds in time: each stretch from 12 ms before a strike to 12 ms before the next (the last to the end)
  const pre = Math.round(0.012 * fs);
  const segs = strikes.map((t, i) => {
    const a = Math.max(0, Math.round(t * fs) - pre), last = i + 1 === strikes.length;
    const x = target.subarray(a, last ? target.length : Math.max(a + win, Math.round(strikes[i + 1] * fs) - pre));
    return { at: t - strikes[0], x, last, print: printOf(x, fs, mouth.bank, win), level: loudness(x, fs) };
  });
  const top = Math.max(...segs.map((s) => s.level));
  // stretches alike (within 3 dB of each other, and of much the same length) share one search, made on the
  // loudest of them; no more than four searches (stretches less alike are put together if need be)
  const order = segs.map((_, i) => i).sort((a, b) => segs[b].level - segs[a].level);
  let groups: number[][] = [];
  for (let alike = 3; ; alike += 1.5) {
    groups = [];
    for (const i of order) {
      const g = groups.find((h) => {
        const r = segs[h[0]], ratio = segs[i].x.length / r.x.length;
        return ratio > 0.7 && ratio < 1.43 && distanceOf(r.print, segs[i].print, floor) < alike;
      });
      if (g) g.push(i); else groups.push([i]);
    }
    if (groups.length <= GROUPS || alike > 12) break;
  }
  const searches = groups.map((g) => {
    const s = segs[g[0]];
    return search(mouth, s.x, Math.min(-12, floor + top - s.level), o, s.last ? undefined : s.x.length / fs);
  });
  const total = searches.reduce((t, s) => t + s.total, 0);
  let before = 0;
  const found = searches.map((s) => {
    const f = s.run((done) => o.onProgress?.(Math.min(before + done, total - 1), total, s.best()));
    before += s.total;
    return f;
  });

  const parts: DrumPart[] = [], events: NonNullable<Imitation['events']> = [];
  groups.forEach((g, gi) => {
    const f = found[gi], one = f.soundOf(f.best, '');
    for (const i of g) {
      parts.push({
        at: +segs[i].at.toFixed(4), ipa: one.ipa,
        ...(one.f0 ? { f0: one.f0 } : {}), ...(one.f0End ? { f0End: one.f0End } : {}), ...(one.hold ? { hold: one.hold } : {}),
        ...(one.fade ? { fade: one.fade } : {}), ...(one.knobs ? { knobs: one.knobs } : {}), gain: +(segs[i].level - top).toFixed(1),
      });
      events.push({ at: +segs[i].at.toFixed(3), length: +(segs[i].x.length / fs).toFixed(3), ipa: one.ipa, distance: +f.best.distance.toFixed(2) });
    }
  });
  parts.sort((a, b) => a.at - b.at);
  events.sort((a, b) => a.at - b.at);
  const sound: DrumSound = {
    id: 'own', code: 'own', name: 'Your sound', family: 'fx', ipa: parts.map((p) => p.ipa).join(' '), alternatives: [], parts, level: -2,
    hint: `the mouth's nearest to a recording: ${parts.length} sounds in ${(target.length / fs).toFixed(1)} s`,
  };
  const ours = drumHit(voice, sound, fs, { seed: 1 });
  const distance = distanceOf(printOf(target, fs, mouth.bank, win), printOf(ours.samples, fs, mouth.bank, win), floor);
  o.onProgress?.(total, total, sound.ipa);
  return { sound, distance: +distance.toFixed(2), tried: [], events, samples: ours.samples, target, fs };
}
