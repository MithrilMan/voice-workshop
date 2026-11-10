/**
 * Copy synthesis: the timing, the melody and the swell of a recording put
 * on a voice of the simulator that says the same text. Our saying and the
 * recording are aligned by dynamic time warping of their cepstra; the score
 * is stretched where the recording is slower and squeezed where it is
 * faster, its pitch follows the recording's, and its lung pressure the rise
 * and fall of the recording's loudness. What is left between the two is
 * the sound itself: it shows how much of what makes a recording sound like
 * a person is in its prosody, and how much in its sound.
 */
import type { Clip } from '../analysis/voiceprint';
import type { Score, ScoreFrame, ScorePhone } from '../engine/params';
import { Articulators, ARTICULATOR_KEYS } from '../tract/types';
import { yin } from '../analysis/pitch';
import { melBank, applyMel } from '../analysis/mel';
import { powerSpectrum, hann } from '../util/fft';
import { TAM_TAU } from '../speech/tam';

/** analysis hop and window, s */
const HOP = 0.01;
const WIN = 0.025;
/** the planner's frame, s */
const FRAME = 0.005;
const N_MEL = 26;
const N_CEP = 13;
/** below the loudest frame by more than this, a frame is not speech (dB) */
const GATE = 35;
/** the level of a held vowel rises about this much for each doubling of the lung pressure (dB; 4, 8 and 16 cmH2O: -32.7, -22.2, -13.5 dB) */
const DB_PER_DOUBLING = 9.6;

export interface Analysis {
  /** cepstra c1..c12 of each frame (mel, 100 Hz to 7.6 kHz), the mean of the speech removed */
  cep: Float64Array[];
  /** level of each frame, dB */
  level: number[];
  /** pitch of each frame, Hz (0: no voice), when asked for */
  f0: number[];
}

/** the time of the middle of analysis frame k */
const centre = (k: number) => k * HOP + WIN / 2;

/** frames of a clip every 10 ms */
export function analyse(c: Clip, pitch = false): Analysis {
  const { samples: x, fs } = c;
  const n = Math.round(WIN * fs), hop = Math.round(HOP * fs), pn = Math.round(0.04 * fs);
  let size = 1;
  while (size < n) size <<= 1;
  const w = hann(n);
  const bank = melBank(N_MEL, size, fs, 100, Math.min(7600, fs / 2));
  const cep: Float64Array[] = [], level: number[] = [], f0: number[] = [];
  for (let s = 0; s + n <= x.length; s += hop) {
    const fr = x.subarray(s, s + n);
    let e = 0;
    for (let i = 0; i < n; i++) e += fr[i] * fr[i];
    level.push(10 * Math.log10(e / n + 1e-12));
    const mel = applyMel(bank, powerSpectrum(fr, size, w));
    const cc = new Float64Array(N_CEP - 1);
    for (let k = 1; k < N_CEP; k++) {
      let v = 0;
      for (let m = 0; m < N_MEL; m++) v += mel[m] * Math.cos((Math.PI * k * (m + 0.5)) / N_MEL);
      cc[k - 1] = v;
    }
    cep.push(cc);
    if (pitch) {
      const a = Math.max(0, s + (n >> 1) - (pn >> 1));
      const p = a + pn <= x.length ? yin(x.subarray(a, a + pn), fs, 60, 500, 0.15) : { f0: 0, confidence: 0 };
      f0.push(p.f0 > 0 && p.confidence > 0.6 ? p.f0 : 0);
    }
  }
  // the mean cepstrum of the speech removed: the two voices differ in it as a whole
  const top = Math.max(...level), mean = new Float64Array(N_CEP - 1);
  let count = 0;
  level.forEach((l, k) => { if (l > top - GATE) { count++; for (let j = 0; j < mean.length; j++) mean[j] += cep[k][j]; } });
  for (const c of cep) for (let j = 0; j < mean.length; j++) c[j] -= mean[j] / Math.max(1, count);
  if (pitch) octaves(f0);
  return { cep, level, f0 };
}

/** a voiced frame an octave or more off the median of its voiced neighbours is taken back to it */
function octaves(f0: number[]): void {
  const was = f0.slice();
  for (let i = 0; i < was.length; i++) {
    if (!was[i]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - 4); j <= Math.min(was.length - 1, i + 4); j++) if (was[j]) near.push(was[j]);
    near.sort((a, b) => a - b);
    const m = near[near.length >> 1];
    const oct = Math.round(Math.log2(m / was[i]));
    if (oct) f0[i] = was[i] * 2 ** oct;
  }
}

/** the first and last frames of speech */
function extent(level: number[]): [number, number] {
  const top = Math.max(...level);
  const first = level.findIndex((l) => l > top - GATE);
  let last = level.length - 1;
  while (last > first && level[last] <= top - GATE) last--;
  return [Math.max(0, first), last];
}

/**
 * Where in our saying each moment of the recording is: a map from the
 * recording's time to ours, monotone. The two are aligned by dynamic time
 * warping of their cepstra between the first and the last frame of speech
 * (symmetric steps, within a band about the diagonal), the path is
 * smoothed over 70 ms, and outside the speech time runs on at the same
 * pace in both.
 */
export function align(rec: Analysis, ours: Analysis): (tRec: number) => number {
  const [r0, r1] = extent(rec.level), [o0, o1] = extent(ours.level);
  const R = r1 - r0 + 1, O = o1 - o0 + 1;
  const band = Math.max(20, Math.round(0.25 * Math.max(R, O)));
  const d = (i: number, j: number) => {
    const a = rec.cep[r0 + i], b = ours.cep[o0 + j];
    let s = 0;
    for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2;
    return Math.sqrt(s);
  };
  const D = new Float64Array(R * O).fill(Infinity), step = new Int8Array(R * O);
  for (let i = 0; i < R; i++) {
    const mid = (i * (O - 1)) / Math.max(1, R - 1);
    for (let j = Math.max(0, Math.floor(mid - band)); j <= Math.min(O - 1, Math.ceil(mid + band)); j++) {
      const c = d(i, j);
      if (i === 0 && j === 0) { D[0] = c; continue; }
      let best = Infinity, how = 0;
      if (i > 0 && j > 0 && D[(i - 1) * O + j - 1] + 2 * c < best) { best = D[(i - 1) * O + j - 1] + 2 * c; how = 0; }
      if (i > 0 && D[(i - 1) * O + j] + c < best) { best = D[(i - 1) * O + j] + c; how = 1; }
      if (j > 0 && D[i * O + j - 1] + c < best) { best = D[i * O + j - 1] + c; how = 2; }
      D[i * O + j] = best;
      step[i * O + j] = how;
    }
  }
  // back along the path: for each frame of the recording, the mean of our frames it meets
  const sum = new Float64Array(R), cnt = new Float64Array(R);
  let i = R - 1, j = O - 1;
  for (;;) {
    sum[i] += j; cnt[i]++;
    if (i === 0 && j === 0) break;
    const how = step[i * O + j];
    if (how === 0) { i--; j--; } else if (how === 1) i--; else j--;
    if (i < 0 || j < 0) break;
  }
  const raw = Array.from(sum, (s, k) => s / Math.max(1, cnt[k]));
  const smooth = raw.map((_, k) => { let s = 0, c = 0; for (let q = Math.max(0, k - 3); q <= Math.min(R - 1, k + 3); q++) { s += raw[q]; c++; } return s / c; });
  for (let k = 1; k < R; k++) smooth[k] = Math.max(smooth[k], smooth[k - 1]);
  // our frame (fractional) for each frame of the recording, the speech of both lined up
  const map = (k: number): number => (k <= r0 ? o0 - (r0 - k) : k >= r1 ? o1 + (k - r1) : o0 + smooth[Math.floor(k - r0)] + (smooth[Math.min(R - 1, Math.floor(k - r0) + 1)] - smooth[Math.floor(k - r0)]) * (k - Math.floor(k)));
  return (tRec: number) => centre(map((tRec - WIN / 2) / HOP));
}

/** the inverse of a monotone map, by bisection */
function inverse(f: (t: number) => number, lo: number, hi: number): (y: number) => number {
  return (y: number) => {
    let a = lo, b = hi;
    for (let k = 0; k < 40; k++) { const m = 0.5 * (a + b); if (f(m) < y) a = m; else b = m; }
    return 0.5 * (a + b);
  };
}

/** a frame of the score at any time: the numbers between two frames, the rest from the nearer */
function frameAt(fr: ScoreFrame[], t: number): ScoreFrame {
  const x = Math.max(0, Math.min(fr[fr.length - 1].t, t)) / FRAME;
  const i = Math.max(0, Math.min(fr.length - 2, Math.floor(x))), u = x - i;
  const a = fr[i], b = fr[i + 1];
  const out = { ...(u < 0.5 ? a : b) } as ScoreFrame & Record<string, unknown>;
  for (const k of Object.keys(a)) {
    const va = (a as unknown as Record<string, unknown>)[k], vb = (b as unknown as Record<string, unknown>)[k];
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * u;
  }
  if (a.art && b.art) {
    const art = {} as Articulators;
    for (const k of ARTICULATOR_KEYS) art[k] = a.art[k] + (b.art[k] - a.art[k]) * u;
    out.art = art;
  }
  return out;
}

/** the score said with the recording's timing: each of its moments where the map puts it */
export function warpScore(sc: Score, ourTime: (tRec: number) => number, recSeconds: number): Score {
  const recTime = inverse(ourTime, -1, recSeconds + 5);
  const duration = Math.max(0.1, recTime(sc.duration));
  const frames: ScoreFrame[] = [];
  for (let k = 0; k * FRAME <= duration + 0.25; k++) frames.push({ ...frameAt(sc.frames, ourTime(k * FRAME)), t: k * FRAME });
  const phones: ScorePhone[] = sc.phones.map((p) => ({ ...p, t0: recTime(p.t0), t1: recTime(p.t1) }));
  return { ...sc, frames, phones, duration };
}

/**
 * The recording's pitch at every frame of a score on its timing (between
 * its voiced frames, a glide in log). The engine follows the pitch of the
 * frames through three smoothing stages, about three time constants late,
 * so the frames are given it that much early.
 */
export function imposePitch(sc: Score, rec: Analysis): Score {
  const lead = 3 * (sc.f0Tau ?? TAM_TAU.f0);
  const f = rec.f0, n = f.length;
  const voiced = f.map((x, k) => (x > 0 ? k : -1)).filter((k) => k >= 0);
  if (!voiced.length) return sc;
  const filled = new Float64Array(n);
  let v = 0;
  for (let k = 0; k < n; k++) {
    while (v < voiced.length - 1 && voiced[v + 1] <= k) v++;
    const a = voiced[v], b = voiced[Math.min(voiced.length - 1, v + 1)];
    if (k <= a || a === b) filled[k] = f[a];
    else filled[k] = Math.exp(Math.log(f[a]) + ((Math.log(f[b]) - Math.log(f[a])) * (k - a)) / (b - a));
  }
  const at = (t: number) => {
    const x = Math.max(0, Math.min(n - 1, (t - WIN / 2) / HOP)), i = Math.min(n - 2, Math.floor(x));
    return n < 2 ? filled[0] : filled[i] + (filled[i + 1] - filled[i]) * (x - i);
  };
  return { ...sc, frames: sc.frames.map((fr) => ({ ...fr, f0: at(fr.t + lead) })) };
}

/**
 * The swell of the recording's loudness on the lung pressure: the gap
 * between its level and ours (on the same timing), over the frames where it
 * has a voice and both are loud, smoothed over about 100 ms, its mean
 * removed and held within 8 dB, becomes a factor on the pressure (given
 * early by the lag of the lungs, as the pitch is).
 */
export function imposeLoudness(sc: Score, rec: Analysis, ours: Analysis): Score {
  const lead = 3 * TAM_TAU.ps;
  const smooth = swell(rec, ours), n = smooth.length;
  if (!n) return sc;
  const at = (t: number) => {
    const x = Math.max(0, Math.min(n - 1, (t - WIN / 2) / HOP)), i = Math.min(n - 2, Math.floor(x));
    return n < 2 ? 0 : smooth[i] + (smooth[i + 1] - smooth[i]) * (x - i);
  };
  return { ...sc, frames: sc.frames.map((fr) => (fr.ps > 0 ? { ...fr, ps: fr.ps * 2 ** (at(fr.t + lead) / DB_PER_DOUBLING) } : fr)) };
}

/**
 * How much louder the recording is than ours, frame by frame, as a slow
 * swell (dB): over the frames where it has a voice and both are within
 * 25 dB of their loudest, smoothed over about 100 ms, its mean removed and
 * held within 8 dB; 0 far from any such frame. Empty when there is none.
 */
export function swell(rec: Analysis, ours: Analysis): number[] {
  const n = Math.min(rec.level.length, ours.level.length);
  const rt = Math.max(...rec.level), ot = Math.max(...ours.level);
  const gap: number[] = [], ok: boolean[] = [];
  for (let k = 0; k < n; k++) {
    ok.push(rec.f0[k] > 0 && rec.level[k] > rt - 25 && ours.level[k] > ot - 25);
    gap.push(rec.level[k] - ours.level[k]);
  }
  let s = 0, c = 0;
  for (let k = 0; k < n; k++) if (ok[k]) { s += gap[k]; c++; }
  if (!c) return [];
  const mean = s / c;
  const smooth = gap.map((_, k) => {
    let a = 0, w = 0;
    for (let q = Math.max(0, k - 15); q <= Math.min(n - 1, k + 15); q++) if (ok[q]) { const g = Math.exp(-0.5 * ((q - k) / 5) ** 2); a += g * (gap[q] - mean); w += g; }
    return w > 0.3 ? Math.max(-8, Math.min(8, a / w)) : 0;
  });
  return smooth;
}
