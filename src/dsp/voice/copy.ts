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
import type { Score, ScoreFrame } from '../engine/params';
import { yin } from '../analysis/pitch';
import { melBank, applyMel } from '../analysis/mel';
import { powerSpectrum, hann } from '../util/fft';
import { autocorr, levinson } from '../analysis/lpc';
import { TAM_TAU } from '../speech/tam';
import { phonemeFor } from '../speech/derive';
import type { Phone } from '../speech/g2p';

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
 * (symmetric steps, within a band about the diagonal), with the level of
 * each frame below its loudest as one more coordinate (a third of its dB,
 * down to 60 dB: with the mean of the speech removed from the cepstra, a
 * silence would otherwise look like an average sound), the path is
 * smoothed over 70 ms, and outside the speech time runs on at the same
 * pace in both.
 */
export function align(rec: Analysis, ours: Analysis): (tRec: number) => number {
  const [r0, r1] = extent(rec.level), [o0, o1] = extent(ours.level);
  const R = r1 - r0 + 1, O = o1 - o0 + 1;
  const band = Math.max(20, Math.round(0.25 * Math.max(R, O)));
  const rt = Math.max(...rec.level), ot = Math.max(...ours.level);
  const d = (i: number, j: number) => {
    const a = rec.cep[r0 + i], b = ours.cep[o0 + j];
    let s = ((Math.max(-60, rec.level[r0 + i] - rt) - Math.max(-60, ours.level[o0 + j] - ot)) / 3) ** 2;
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

export interface Timing { stretch: number[]; pauses: number[] }

/** a silence of the recording this long, at the end of a word, is a pause our text did not have */
const PAUSE_MIN = 0.15;

/**
 * A score said with the recording's timing: every sound of our saying is
 * made as long as the stretch of the recording the alignment gives it (no
 * shorter than 40 % of ours nor than 20 ms, since a slip of the alignment
 * is not a sound, and no longer than three times; what one cannot take
 * passes to the next, so that the sounds after it stay where the
 * recording has them), every pause as long as
 * the recording's, and the planner plans every gesture again on those
 * lengths, so that none is cut short. A silence of the recording inside a
 * word of ours, where our text has no pause, becomes one at the end of
 * that word (or of the word before, if it lies early in the sound); the
 * phones said, with those pauses, come back with the score, to be aligned
 * again. Three rounds, as some parts (the breath after a stop) keep their
 * own length. The score then waits for the recording's first sound.
 */
export function copyTiming(phones: Phone[], plan: (phones: Phone[], timing?: Timing) => Score, rec: Analysis, ourTime: (tRec: number) => number, recSeconds: number): { score: Score; phones: Phone[] } {
  const plain = plan(phones);
  const recTime = inverse(ourTime, -1, recSeconds + 5);
  const top = Math.max(...rec.level);
  /** the longest silence of the recording between two times, and its middle */
  const silence = (t0: number, t1: number) => {
    let best = 0, mid = 0, run = 0;
    for (let k = Math.max(0, Math.ceil((t0 - WIN / 2) / HOP)); k < rec.level.length && centre(k) <= t1; k++) {
      if (rec.level[k] < top - GATE) { run++; if (run * HOP > best) { best = run * HOP; mid = centre(k) - (best - HOP) / 2; } } else run = 0;
    }
    return { len: best, mid };
  };
  // the sounds the planner keeps (one unit each), and the phone of each
  const kept = phones.map((p, i) => (phonemeFor(p.ipa) ? i : -1)).filter((i) => i >= 0);
  const want: number[] = [], after: number[] = [];
  let k = -1, debt = 0;
  for (const p of plain.phones) {
    const a = recTime(p.t0), b = recTime(p.t1);
    if (p.ipa === '_') { if (k >= 0) after[k] = (after[k] ?? 0) + Math.max(0.01, b - a + debt); debt = 0; continue; }
    k++;
    const ours = p.t1 - p.t0, s = silence(a, b);
    let len = b - a;
    if (s.len >= PAUSE_MIN) {
      // the end of this word, or of the one before
      const ends = (j: number) => !!(phones[kept[j]]?.wordEnd || phones[kept[j]]?.pause);
      let j = k;
      if (s.mid > 0.5 * (a + b)) { while (j < kept.length - 1 && !ends(j)) j++; }
      else { j = k - 1; while (j >= 0 && !ends(j)) j--; }
      if (j >= 0) { len -= s.len; after[j] = (after[j] ?? 0) + s.len; }
    }
    want[k] = Math.min(3 * ours, Math.max(0.4 * ours, 0.02, len + debt));
    debt += len - want[k];
  }
  const last = want.length - 1;
  const said = phones.map((p) => ({ ...p }));
  after.forEach((len, j) => { if (len > 0 && j < last && !said[kept[j]].pause) said[kept[j]] = { ...said[kept[j]], pause: 'short', wordEnd: true }; });
  const pauses: number[] = [];
  for (let j = 0; j < last; j++) if (said[kept[j]]?.pause) pauses.push(after[j] ?? 0.01);
  const stretch = want.map(() => 1);
  let sc = plan(said, { stretch: [...stretch], pauses });
  for (let round = 0; round < 3; round++) {
    const now = sc.phones.filter((p) => p.ipa !== '_');
    if (now.length !== want.length) return { score: plain, phones };
    now.forEach((p, j) => { if (p.t1 > p.t0) stretch[j] *= want[j] / (p.t1 - p.t0); });
    sc = plan(said, { stretch: [...stretch], pauses });
  }
  // our first sound where the recording's is: later (rest until then), or earlier, its lead in cut short
  const start = recTime(plain.phones[0]?.t0 ?? 0) - (sc.phones[0]?.t0 ?? 0);
  const cut = Math.min(-start, (sc.phones[0]?.t0 ?? 0) - 0.01);
  return { score: start > FRAME ? delay(sc, start) : cut > FRAME ? advance(sc, cut) : sc, phones: said };
}

/** a score that begins earlier, the start of its lead in cut */
function advance(sc: Score, s: number): Score {
  const k = Math.round(s / FRAME), d = k * FRAME;
  return {
    ...sc,
    frames: sc.frames.slice(k).map((f) => ({ ...f, t: f.t - d })),
    phones: sc.phones.map((p) => ({ ...p, t0: p.t0 - d, t1: p.t1 - d })),
    duration: sc.duration - d,
  };
}

/** a score that begins later, at rest until then */
function delay(sc: Score, s: number): Score {
  const k = Math.round(s / FRAME), d = k * FRAME, first: ScoreFrame = sc.frames[0];
  const lead: ScoreFrame[] = [];
  for (let i = 0; i < k; i++) lead.push({ ...first, t: i * FRAME });
  return {
    ...sc,
    frames: [...lead, ...sc.frames.map((f) => ({ ...f, t: f.t + d }))],
    phones: sc.phones.map((p) => ({ ...p, t0: p.t0 + d, t1: p.t1 + d })),
    duration: sc.duration + d,
  };
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

/**
 * Cross-synthesis by linear prediction: the fine structure of one clip (its
 * residual: the pulses of the folds, their irregularity, the noise of the
 * breath and of the consonants) through the spectral envelope of another
 * (its formants and the tilt of its spectrum), on the same timing. Every
 * 5 ms a predictor (order 4 + fs/1 kHz) is fitted on 25 ms of each,
 * pre-emphasized; the first is inverse filtered with its own, the result
 * brought to the level of the second's own residual and filtered by the
 * second's. A clip crossed with itself comes back as it was. With the two
 * sayings lined up in time and pitch (copy synthesis), it tells whether
 * what sounds mechanical in one of them is in its source or in its mouth.
 * With `where`, the second's envelope only at the times it says (s), the
 * first clip as it is elsewhere (at the crossing's level, with 20 ms fades
 * between the two): which stretches of a saying carry it.
 */
export function crossSynth(source: Clip, mouth: Clip, where?: (t: number) => boolean): Float32Array {
  const fs = source.fs, n = Math.min(source.samples.length, mouth.samples.length);
  const order = Math.round(4 + fs / 1000), hop = Math.round(0.005 * fs), win = Math.round(0.025 * fs);
  const pre = (x: Float32Array) => { const y = new Float64Array(n); for (let i = 0; i < n; i++) y[i] = x[i] - 0.97 * (i ? x[i - 1] : 0); return y; };
  const xs = pre(source.samples), xm = pre(mouth.samples);
  const w = hann(win);
  /** the predictor and residual energy per sample of the frame centred at c */
  const fit = (x: Float64Array, c: number) => {
    const f = new Float64Array(win);
    let ws = 0;
    for (let i = 0; i < win; i++) { const k = c - (win >> 1) + i; f[i] = k >= 0 && k < n ? x[k] * w[i] : 0; ws += w[i] * w[i]; }
    const r = autocorr(f, order);
    r[0] *= 1 + 1e-6;
    const { a, err } = levinson(r, order);
    return { a, e: err / ws };
  };
  const y = new Float64Array(n), e = new Float64Array(n);
  let gWas = NaN;
  for (let b = 0; b * hop < n; b++) {
    const c = b * hop + (hop >> 1);
    const s = fit(xs, c), m = fit(xm, c);
    // the source's own residual, at the level of the mouth's
    // (gliding from the block before, so that it does not click)
    const g = Math.min(30, Math.sqrt(m.e / Math.max(s.e, 1e-20))), g0 = Number.isNaN(gWas) ? g : gWas;
    gWas = g;
    for (let i = b * hop; i < Math.min(n, (b + 1) * hop); i++) {
      let v = xs[i];
      for (let k = 1; k <= order; k++) v += s.a[k] * (i - k >= 0 ? xs[i - k] : 0);
      e[i] = (g0 + ((g - g0) * (i - b * hop)) / hop) * v;
      let u = e[i];
      for (let k = 1; k <= order; k++) u -= m.a[k] * (i - k >= 0 ? y[i - k] : 0);
      y[i] = u;
    }
  }
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) { prev = y[i] + 0.97 * prev; out[i] = prev; }
  if (!where) return out;
  // the mouth's envelope only where asked: the first clip as it is elsewhere,
  // brought to the crossing's level, faded in and out over 20 ms (switching
  // the predictor itself from one frame to the next rings, up to 20 dB)
  const fade = Math.round(0.01 * fs), wt = new Float64Array(n), sm = new Float64Array(n);
  for (let i = 0; i < n; i++) wt[i] = where((Math.floor(i / hop) * hop + (hop >> 1)) / fs) ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    let acc = 0;
    for (let i = 0; i < n + (fade >> 1); i++) {
      if (i < n) acc += wt[i];
      if (i - fade >= 0) acc -= wt[i - fade];
      const j = i - (fade >> 1);
      if (j >= 0 && j < n) sm[j] = acc / fade;
    }
    wt.set(sm);
  }
  const k = speechRms(out, fs) / Math.max(speechRms(source.samples.subarray(0, n), fs), 1e-12);
  for (let i = 0; i < n; i++) out[i] = wt[i] * out[i] + (1 - wt[i]) * k * source.samples[i];
  return out;
}

/** the rms over the 10 ms frames within 35 dB of the loudest */
function speechRms(x: Float32Array, fs: number): number {
  const hop = Math.round(0.01 * fs), e: number[] = [];
  for (let s = 0; s + hop <= x.length; s += hop) { let a = 0; for (let i = s; i < s + hop; i++) a += x[i] * x[i]; e.push(a / hop); }
  const top = Math.max(0, ...e), speech = e.filter((v) => v > top * 10 ** -3.5);
  return Math.sqrt(speech.reduce((a, b) => a + b, 0) / Math.max(1, speech.length));
}
