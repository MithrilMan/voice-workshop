/**
 * A sound of the mouth that imitates a recording: a noise, a drum hit, a
 * click, a hum, made into a sound of the voice's own mouth. Analysis by
 * synthesis: the recording is cut to its sound (from where it strikes to
 * where it dies away), and many sounds of speech (stops, ejectives,
 * affricates, fricatives, clicks, trills, inward sounds; hums and vowels on
 * the recording's own pitch when it has one) are said by the voice and cut
 * the same way; the one whose spectrum, moment by moment, is nearest the
 * recording's wins. The nearest are then held as long as the recording,
 * put in a row with other sounds (a stop before them, a hiss or a hum
 * after: a [p] going into a long [ts]), and refined on the size of the
 * head (higher or lower resonances), the length of their last sound and
 * how it dies away.
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
  /** hold the nearest to the recording's length, try them in a row with other sounds, refine them (true) */
  refine?: boolean;
  /** hears of the progress: tries done, of how many, the best so far */
  onProgress?: (done: number, total: number, best: string) => void;
}

export interface Imitation {
  /** the sound found, ready for a beat (BeatOptions.sounds): give it a name and a code of your own */
  sound: DrumSound;
  /** how far it is from the recording: the rms difference of their spectra, moment by moment, dB */
  distance: number;
  /** every sound tried, nearest first, each said the way that brought it nearest (ready for a beat, as `sound`) */
  tried: { ipa: string; distance: number; sound: DrumSound }[];
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

/** sounds tried before the best ones (a stop striking into them) and after them (a hiss or a hum they go on into) */
const BEFORE = ['p', 't', 'k', 'pʼ', 'tʼ', 'kʼ', 'b', 'd', 'ɡ', 'ʔ'];
const AFTER = ['s', 'ʃ', 'f', 'x', 'h', 'ɸ', 'ç', 'ts', 'tʃ'];
const AFTER_VOICED = ['m', 'n', 'z', 'v', 'a', 'u', 'i', 'r'];
/** sounds that go on as long as the breath: the long part of a recording after its strike is tried against each, held */
const CONTINUANT = new Set(['ɸ', 'f', 'θ', 's', 'ʃ', 'ɕ', 'ç', 'x', 'χ', 'ħ', 'h', 'ɬ', 's↓', 'ʃ↓', 'ʙ̥', 'r̥', 'm', 'n', 'ŋ', 'ʙ', 'r', 'v', 'z', 'ʒ', 'a', 'e', 'i', 'o', 'u', 'ə', 'ɯ']);

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
  const refine = o.refine !== false;
  const scale0 = voice.body.anatomy.scale || 1, length = target.length / fs;
  /**
   * a sound as said: its sounds in a row (IPA), the head's size (× the voice's), its last sound held (×),
   * the push let go through it (0-0.9)
   */
  interface Way { parts: string[]; scale: number; hold: number; fade: number }
  /**
   * and its IPA, how far it is from the recording, how long it is (s), how long its last sound is when not
   * held (s), how long it must be held to last as long as the recording, and how far its strike is from the
   * recording's (said as it is)
   */
  interface Try extends Way { ipa: string; distance: number; length: number; one: number; fit: number }
  const say = (t: Way) => drumHit(voice, t.parts.join(''), fs, {
    seed: 1, f0: voiced ? f0 : undefined, f0End: voiced ? f0End : undefined, hold: t.hold, fade: t.fade,
    knobs: Math.abs(t.scale - 1) > 1e-3 ? { 'body.anatomy.scale': +(scale0 * t.scale).toFixed(3) } : {},
  });
  const hop = Math.max(1, Math.round(0.005 * fs));
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
  const total = list.length + (refine ? LONGER + (apart ? continuants.length + PAIRS + BEFORE.length : 2 * (BEFORE.length + after.length)) + (BASES + 1) * EVALS : 0);
  /** what a sound is worth: its distance, and a tenth of a decibel for each sound more in the row (of two as near, the simpler) */
  const worth = (t: Try) => t.distance + 0.1 * (t.parts.length - 1);
  let done = 0, best = undefined as Try | undefined;
  const tried = new Map<string, Try>();
  /** each sound as it is said, its print */
  const prints = new Map<string, Print>();
  const progress = () => o.onProgress?.(Math.min(done, total - 1), total, best?.ipa ?? '');
  /** a sound said and measured against the recording (none: one the reader cannot say) */
  const measure = (w: Way): Try | undefined => {
    done++;
    const t: Way = { parts: w.parts, scale: +w.scale.toFixed(3), hold: +w.hold.toFixed(2), fade: +w.fade.toFixed(2) };
    const ipa = t.parts.join(''), key = `${ipa}|${t.scale}|${t.hold}|${t.fade}`;
    if (tried.has(key)) return tried.get(key);
    let r: Try | undefined;
    try {
      const hit = say(t);
      const last = hit.phones[hit.phones.length - 1], len = hit.samples.length / fs;
      const one = last ? Math.max(0.02, (last.t1 - last.t0) / t.hold) : 1;
      const fit = Math.max(1, Math.min(8, t.hold + (length - len) / one));
      const print = printOf(hit.samples, fs, bank, win);
      if (t.parts.length === 1 && t.scale === 1 && t.hold === 1 && t.fade === 0) prints.set(ipa, print);
      r = { ...t, ipa, distance: distanceOf(want, print, floor), length: len, one, fit };
      tried.set(key, r);
      if (!best || worth(r) < worth(best)) best = r;
    } catch { /* a sound the reader cannot say is left out */ }
    progress();
    return r;
  };
  /** the nearest `n` sounds, one way of saying each */
  const nearest = (n: number): Try[] => {
    const seen = new Set<string>();
    return [...tried.values()].sort((a, b) => worth(a) - worth(b)).filter((t) => !seen.has(t.ipa) && !!seen.add(t.ipa)).slice(0, n);
  };

  // 1. every sound as it is said
  for (const ipa of list) measure({ parts: [ipa], scale: 1, hold: 1, fade: 0 });
  if (!tried.size) throw new Error('no sound could be tried');
  if (refine) {
    const said = [...tried.values()];
    // 2. the nearest held as long as the recording (a long hiss is far from a short one, however alike they start)
    for (const t of nearest(LONGER)) { if (Math.abs(Math.log(t.fit / t.hold)) > 0.15) measure({ ...t, hold: t.fit }); else done++; }
    // 3. a long recording as a strike and what it goes into: the sounds that go on, each held as long as the
    //    rest, against the rest; every other sound going into each of the nearest three, joined on paper (no
    //    sound said), against the whole; the nearest six of those said
    if (apart && wantRest) {
      const rests: { ipa: string; hold: number; d: number; print: Print }[] = [];
      for (const t of said.filter((s) => CONTINUANT.has(s.ipa))) {
        done++;
        const hold = +Math.max(1, Math.min(8, 1 + (restLength - t.length) / t.one)).toFixed(2);
        try {
          const print = printOf(say({ parts: [t.ipa], scale: 1, hold, fade: 0 }).samples, fs, bank, win);
          rests.push({ ipa: t.ipa, hold, d: distanceOf(wantRest, print, floor), print });
        } catch { /* left out */ }
        progress();
      }
      rests.sort((a, b) => a.d - b.d);
      const pairs: { parts: string[]; hold: number; d: number }[] = [];
      for (const [ipa, print] of prints) {
        if (CONTINUANT.has(ipa)) continue;
        for (const r of rests.slice(0, RESTS)) pairs.push({ parts: [ipa, r.ipa], hold: r.hold, d: distanceOf(want, joined(print, r.print, restLevel, floor), floor) });
      }
      pairs.sort((a, b) => a.d - b.d);
      for (const q of pairs.slice(0, PAIRS)) measure({ parts: q.parts, scale: 1, hold: q.hold, fade: 0 });
    }
    // 4. more sounds in a row: a stop before the nearest (a [p] going into [ts]); unless it already goes on
    //    into a long rest, a hiss or a hum after it too (held for what is left of the recording's length, by
    //    its length as said alone), and once more round the nearest of those, if it is another
    const grow = (b: Try) => {
      for (const p of BEFORE) measure({ ...b, parts: [p, ...b.parts], scale: 1, fade: 0 });
      if (apart) return;
      for (const s of after) {
        const alone = tried.get(`${s}|1|1|0`);
        const hold = alone ? Math.max(1, Math.min(8, 1 + (length - (b.length - (b.hold - 1) * b.one) - alone.length) / alone.one)) : 1;
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
          : { ...at, hold: Math.max(0.4, Math.min(8, at.hold * Math.exp(dir * steps.hold))) };
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
  }
  /** a way of saying a sound as a sound for a beat */
  const soundOf = (t: Try, hint: string): DrumSound => {
    const knobs = Math.abs(t.scale - 1) > 1e-3 ? { 'body.anatomy.scale': +(scale0 * t.scale).toFixed(3) } : undefined;
    const hold = Math.abs(t.hold - 1) > 1e-3 ? t.hold : undefined;
    const fade = t.fade > 1e-3 ? t.fade : undefined;
    return {
      id: 'own', code: 'own', name: 'Your sound', family: 'fx', ipa: t.ipa, alternatives: [],
      ...(voiced ? { f0: Math.round(f0!), ...(f0End ? { f0End: Math.round(f0End) } : {}) } : {}),
      ...(hold ? { hold } : {}), ...(fade ? { fade } : {}), ...(knobs ? { knobs } : {}),
      level: -2, hint: `${hint}: [${t.ipa}]${knobs ? `, head ×${t.scale.toFixed(2)}` : ''}${hold ? `, held ×${hold}` : ''}${fade ? ', dying away' : ''}`,
    };
  };
  const fin = best ?? nearest(1)[0];
  const ours = say(fin);
  const all = nearest(Infinity);
  const sound: DrumSound = { ...soundOf(fin, "the mouth's nearest to a recording"), alternatives: all.filter((t) => t.ipa !== fin.ipa).slice(0, 4).map((t) => t.ipa) };
  o.onProgress?.(total, total, fin.ipa);
  return {
    sound, distance: +fin.distance.toFixed(2),
    tried: all.map((t) => ({ ipa: t.ipa, distance: +t.distance.toFixed(2), sound: soundOf(t, "the mouth's attempt at a recording") })),
    ...(voiced ? { f0: Math.round(f0!) } : {}), samples: ours.samples, target, fs,
  };
}
