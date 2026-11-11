/**
 * Copy synthesis: the timing, the melody and the swell of a recording put
 * on a voice of the simulator that says the same text. Our saying and the
 * recording are lined up by the times of the recording's sounds, when it
 * comes with them, else by dynamic time warping of their cepstra; the score
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
  if (pitch) cleanPitch(f0, level);
  return { cep, level, f0 };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

/**
 * The pitch of a saying made fit to copy. YIN finds a period in breath, in
 * creak and in near-silence too, and a copy that follows it jumps an octave
 * or more for a few frames. So a voiced frame more than 30 dB below the
 * loudest is taken as unvoiced; a frame an octave or more off the median
 * of the voiced frames within 100 ms is taken back to it; one still more
 * than half an octave off that median, or more than an octave off the
 * median of the whole saying, is unvoiced; and so is a run of fewer than
 * three voiced frames (20 ms between two unvoiced ones). The copy glides
 * over what is dropped.
 */
function cleanPitch(f0: number[], level: number[]): void {
  const top = Math.max(...level);
  for (let i = 0; i < f0.length; i++) if (level[i] < top - 30) f0[i] = 0;
  const was = f0.slice(), voiced = was.filter((x) => x > 0);
  if (!voiced.length) return;
  const whole = median(voiced);
  for (let i = 0; i < was.length; i++) {
    if (!was[i]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - 10); j <= Math.min(was.length - 1, i + 10); j++) if (was[j]) near.push(was[j]);
    const m = median(near), v = was[i] * 2 ** Math.round(Math.log2(m / was[i]));
    f0[i] = Math.abs(Math.log2(v / m)) > 0.5 || Math.abs(Math.log2(v / whole)) > 1 ? 0 : v;
  }
  for (let i = 0; i < f0.length; ) {
    if (!f0[i]) { i++; continue; }
    let j = i;
    while (j < f0.length && f0[j]) j++;
    if (j - i < 3) f0.fill(0, i, j);
    i = j;
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

/** the longest silence of a recording between two times (s), and its middle */
function silences(rec: Analysis): (t0: number, t1: number) => { len: number; mid: number } {
  const top = Math.max(...rec.level);
  return (t0, t1) => {
    let best = 0, mid = 0, run = 0;
    for (let k = Math.max(0, Math.ceil((t0 - WIN / 2) / HOP)); k < rec.level.length && centre(k) <= t1; k++) {
      if (rec.level[k] < top - GATE) { run++; if (run * HOP > best) { best = run * HOP; mid = centre(k) - (best - HOP) / 2; } } else run = 0;
    }
    return { len: best, mid };
  };
}

/**
 * The planner's score on the lengths wanted for its sounds (one for each
 * sound it keeps) and for the pauses after them: three rounds, as some
 * parts (the breath after a stop) keep their own length. The score then
 * waits for the recording's first sound (`first`, s), or its lead in is
 * cut short.
 */
function retime(phones: Phone[], said: Phone[], kept: number[], want: number[], after: number[], plan: (phones: Phone[], timing?: Timing) => Score, plain: Score, first: number): { score: Score; phones: Phone[] } {
  const last = want.length - 1;
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
  const start = first - (sc.phones[0]?.t0 ?? 0);
  const cut = Math.min(-start, (sc.phones[0]?.t0 ?? 0) - 0.01);
  return { score: start > FRAME ? delay(sc, start) : cut > FRAME ? advance(sc, cut) : sc, phones: said };
}

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
  const silence = silences(rec);
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
  return retime(phones, said, kept, want, after, plan, plain, recTime(plain.phones[0]?.t0 ?? 0));
}

/** a sound of a recording and when it is said (s): a letter of the IPA, or a stress mark, a length mark, a space or a punctuation mark with a time of its own */
export interface Said { ipa: string; t0: number; t1: number }

interface Unit { sym: string; t0: number; t1: number; start: boolean }

const VOWELS = 'aeiouyɑɐɒæɔəɚɛɜɝɘɵɞɪʏʊʌᵻøœɶɨʉɯɤ';
/** consonants that stand for each other more easily than for the rest: stops and taps, nasals, fricatives, liquids and glides */
const KINDS = ['pbtdkgʔɾ', 'mnŋɲɱ', 'fvszʃʒθðçxhɦ', 'lrɹjwʎ'];
/** two ways of writing a sound */
const SAME: Record<string, string> = { 'ɡ': 'g', 'ɜ': 'ɝ', 'ɚ': 'ɝ', 'ɐ': 'ə', 'ᵻ': 'ɪ', 'ɫ': 'l' };
const norm = (c: string) => SAME[c] ?? c;
const STOP = /^[pbtdkgɡʔ]/;
/** the letters of a symbol, without its marks (length, stress, diacritics) */
const letters = (s: string) => [...s].filter((c) => /\p{L}/u.test(c) && !/\p{Lm}/u.test(c));

/**
 * The sounds of a recording, one for each letter: a stress mark gives its
 * time to the sound after it, a length mark or a diacritic to the one
 * before, a letter said twice in a word is one long sound, and a space or
 * a punctuation mark starts a word (its time, and any silence there, is
 * the gap between the two sounds about it).
 */
function soundsOf(said: Said[], shift: number): Unit[] {
  const out: Unit[] = [];
  let lead = NaN, start = true;
  for (const s of said) {
    if (!s.ipa || !(s.t1 >= s.t0)) continue;
    if (s.ipa === 'ˈ' || s.ipa === 'ˌ') { if (Number.isNaN(lead)) lead = s.t0; continue; }
    const l = letters(s.ipa);
    if (!l.length) {
      if (/[\p{Lm}\p{M}]/u.test(s.ipa) && out.length && !start) out[out.length - 1].t1 = s.t1 + shift;
      else { start = true; lead = NaN; }
      continue;
    }
    const t0 = (Number.isNaN(lead) ? s.t0 : lead) + shift, t1 = s.t1 + shift, last = out[out.length - 1];
    lead = NaN;
    if (last && !start && l.length === 1 && last.sym === l[0]) last.t1 = t1;
    else l.forEach((c, i) => out.push({ sym: c, t0: t0 + ((t1 - t0) * i) / l.length, t1: t0 + ((t1 - t0) * (i + 1)) / l.length, start: start && i === 0 }));
    start = false;
  }
  return out;
}

/**
 * By how much the times given for a recording's sounds run behind the
 * recording (s, to add to them, so mostly negative: a synthesizer's own
 * times trail its sound by some tens of ms): the shift within 120 ms that
 * best puts its voiceless sounds on frames without a voice, and its vowels
 * and sonorants on frames with one. The recording analysed with its pitch.
 */
/** the consonants that are voice all through */
const SONORANTS = 'mnŋɲlrɹjw';
const hasVoice = (c: string) => VOWELS.includes(c) || SONORANTS.includes(c);

export function clock(said: Said[], rec: Analysis): number {
  const units = soundsOf(said, 0), n = rec.f0.length;
  let best = 0, top = -1;
  for (let q = -24; q <= 24; q++) {
    const s = q * 0.005;
    let ok = 0, all = 0;
    for (const u of units) {
      const c = norm(u.sym), voiced = hasVoice(c);
      if (!voiced && !'ptkfsʃθ'.includes(c)) continue;
      for (let t = u.t0 + 0.005; t < u.t1 - 0.004; t += 0.005) {
        const k = Math.round((t + s - WIN / 2) / HOP);
        all++;
        if ((k >= 0 && k < n && rec.f0[k] > 0) === voiced) ok++;
      }
    }
    const score = all ? ok / all : 0;
    if (score > top + 1e-9 || (score > top - 1e-9 && Math.abs(s) < Math.abs(best))) { top = score; best = s; }
  }
  return best;
}

/**
 * Two sayings of a text, letter by letter: the pairs (one of the first,
 * one of the second, -1 for a sound the other does not say) that cost the
 * least. The same sound costs nothing, a vowel for a vowel 0.4, a
 * consonant for one of its kind 0.6, a vowel for a glide or a liquid 0.8,
 * a sound with no partner 1, and a word that starts in one and not in the
 * other 0.2 more (chosen, not measured).
 */
function match(a: { sym: string; start: boolean }[], b: { sym: string; start: boolean }[]): [number, number][] {
  const n = a.length, m = b.length, W = m + 1;
  const kind = (c: string) => { if (VOWELS.includes(c)) return 0; const k = KINDS.findIndex((x) => x.includes(c)); return k < 0 ? 9 : k + 1; };
  const open = (k: number) => k === 0 || k === 4;
  const cost = (x: { sym: string; start: boolean }, y: { sym: string; start: boolean }) => {
    const p = norm(x.sym), q = norm(y.sym), kp = kind(p), kq = kind(q);
    return (p === q ? 0 : kp === 0 && kq === 0 ? 0.4 : kp === kq ? 0.6 : open(kp) && open(kq) ? 0.8 : 2.5) + (x.start !== y.start ? 0.2 : 0);
  };
  const D = new Float64Array((n + 1) * W), how = new Uint8Array((n + 1) * W);
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (!i && !j) continue;
    let best = Infinity, h = 0;
    if (i && j) { const c = D[(i - 1) * W + j - 1] + cost(a[i - 1], b[j - 1]); if (c < best) { best = c; h = 0; } }
    if (i) { const c = D[(i - 1) * W + j] + 1; if (c < best) { best = c; h = 1; } }
    if (j) { const c = D[i * W + j - 1] + 1; if (c < best) { best = c; h = 2; } }
    D[i * W + j] = best; how[i * W + j] = h;
  }
  const ops: [number, number][] = [];
  for (let i = n, j = m; i || j;) {
    const h = how[i * W + j];
    if (h === 0) ops.push([--i, --j]); else if (h === 1) ops.push([--i, -1]); else ops.push([-1, --j]);
  }
  return ops.reverse();
}

/** When a stop is let go between two times of a recording: the steepest rise of
 *  its level after the quietest frame of the closure, if it rises by 6 dB (else NaN). */
function burst(rec: Analysis, t0: number, t1: number): number {
  const k0 = Math.max(1, Math.round((t0 - WIN / 2) / HOP)), k1 = Math.min(rec.level.length - 2, Math.round((t1 - WIN / 2) / HOP));
  let q = k0;
  for (let k = k0; k <= k1; k++) if (rec.level[k] < rec.level[q]) q = k;
  let best = -1, rise = 6;
  for (let k = q; k <= k1; k++) {
    const r = rec.level[k + 1] - rec.level[k - 1];
    if (r > rise) { rise = r; best = k; }
  }
  return best < 0 ? NaN : centre(best);
}

/**
 * The same from a recording that comes with the times of its sounds (a
 * synthesizer that reports them, a labelled corpus): no two signals to
 * line up, which slips where the two say a sound differently. Its sounds
 * are put on the recording's clock (`clock`) and matched with ours letter
 * by letter (`match`). Each sound of ours takes the time of its partners
 * and of the sounds about them that we do not say (no shorter than 40 %
 * of ours nor than 20 ms, no longer than six times; what one cannot take
 * passes to the next), each pause the gap between the two sounds about
 * it. A gap where the recording is silent for 150 ms becomes a pause, if
 * our text has none there, and so does such a silence inside the time of
 * the last sound of a word (times that leave no gaps between the sounds
 * fold the pauses into them), unless it is the closure of a voiceless stop; a pause of ours where the recording runs on
 * (a gap under 150 ms, not 30 of them silent) is not made. The time of
 * any other gap goes to the stop next to it, if the recording is silent
 * for half of it (a closure), else half to each of the two sounds. Where
 * the recording says a stop and we a tap for the same /t d/, or the other
 * way, ours says what it says; the phones said come back with the score.
 * The last label runs on through the silence after it: the last sound ends
 * where the speech does, a voice where it stops, a stop where it is let go.
 * `trail` is how long our own sounds come after the times we plan them at
 * (`clock` of our saying against its own plan): ours are planned that much
 * earlier, so that the two are heard together.
 */
export function copyTimingSaid(phones: Phone[], plan: (phones: Phone[], timing?: Timing) => Score, rec: Analysis, said: Said[], trail = 0): { score: Score; phones: Phone[] } {
  const theirs = soundsOf(said, clock(said, rec));
  // the label of the last sound runs on through the silence after it: the sound
  // ends where the speech does, a voice where it stops (the recording may trail
  // off in a breath), and a last stop where the recording lets it go
  const lastOne = theirs[theirs.length - 1];
  if (lastOne) {
    const frame = (t: number) => Math.max(0, Math.min(rec.level.length - 1, Math.round((t - WIN / 2) / HOP)));
    let t1 = Math.min(lastOne.t1, centre(extent(rec.level)[1]) + HOP / 2);
    if (hasVoice(norm(lastOne.sym))) {
      let k = frame(t1);
      while (k > frame(lastOne.t0) && !(rec.f0[k] > 0)) k--;
      if (k > frame(lastOne.t0)) t1 = Math.min(t1, centre(k) + 0.03);
    } else if (STOP.test(norm(lastOne.sym))) {
      const go = burst(rec, lastOne.t0, t1);
      if (go > lastOne.t0 + 0.02) t1 = Math.min(t1, go + 0.015);
    }
    lastOne.t1 = Math.max(lastOne.t0 + 0.02, t1);
  }
  const kept = phones.map((p, i) => (phonemeFor(p.ipa) ? i : -1)).filter((i) => i >= 0), K = kept.length;
  const ours = phones.map((p) => ({ ...p }));
  const mine: { sym: string; k: number; start: boolean }[] = [];
  kept.forEach((i, k) => {
    const l = letters(phones[i].ipa), before = k > 0 ? phones[kept[k - 1]] : undefined;
    (l.length ? l : [phones[i].ipa]).forEach((c, q) => mine.push({ sym: c, k, start: q === 0 && (!before || !!phones[i].wordStart || !!before.wordEnd || !!before.pause) }));
  });
  // their time for each sound of ours, and for the gap after it
  const len = new Array<number>(K).fill(0), gap = new Array<number>(K).fill(0), span: [number, number][] = [], at: [number, number][] = [];
  let cur = -1, pending = 0;
  for (const [a, b] of match(theirs, mine)) {
    if (a < 0) { cur = mine[b].k; len[cur] += pending; pending = 0; continue; }
    const u = theirs[a], g = a > 0 ? u.t0 - theirs[a - 1].t1 : 0, k = b >= 0 ? mine[b].k : -1;
    if (g > 1e-6 && cur >= 0) {
      if (k === cur) len[cur] += g;
      else { gap[cur] += g; span[cur] = [span[cur]?.[0] ?? theirs[a - 1].t1, u.t0]; }
    }
    if (k >= 0) {
      len[k] += u.t1 - u.t0 + pending; pending = 0; cur = k;
      at[k] = [at[k]?.[0] ?? u.t0, u.t1];
      const p = ours[kept[k]];
      if (p.ipa === 'ɾ' && (u.sym === 't' || u.sym === 'd')) ours[kept[k]] = { ...p, ipa: u.sym };
      else if ((p.ipa === 't' || p.ipa === 'd') && u.sym === 'ɾ') ours[kept[k]] = { ...p, ipa: 'ɾ' };
    } else if (cur < 0 || g > 1e-6 || (a + 1 < theirs.length && norm(theirs[a + 1].sym) === norm(u.sym))) pending += u.t1 - u.t0;
    // a sound we do not say: with the word after it if it starts one (or is said again there), else with the sound before
    else len[cur] += u.t1 - u.t0;
  }
  if (cur >= 0) len[cur] += pending;
  const plain = plan(ours);
  const own = plain.phones.filter((p) => p.ipa !== '_').map((p) => p.t1 - p.t0);
  if (own.length !== K || !theirs.length) return { score: plain, phones: ours };
  const silence = silences(rec);
  // times that leave no gaps fold a pause into the sound before it: a sound at the
  // end of a word ends where the recording falls silent for as long as a pause
  // (not a voiceless stop, whose closure is a silence of its own)
  for (let k = 0; k < K - 1; k++) {
    const p = ours[kept[k]], a = at[k];
    if (!a || !(p.wordEnd || ours[kept[k + 1]].wordStart) || /^[ptkʔ]/.test(p.ipa)) continue;
    const q = silence(a[0], a[1]), from = q.mid - q.len / 2;
    if (q.len < PAUSE_MIN || from < a[0] + 0.02) continue;
    const cut = Math.min(len[k] - 0.02, a[1] - from);
    if (!(cut > 0)) continue;
    len[k] -= cut; gap[k] += cut; span[k] = [from, span[k]?.[1] ?? a[1]];
  }
  for (let k = 0; k < K - 1; k++) {
    const p = ours[kept[k]], quiet = gap[k] > 0 ? silence(span[k][0], span[k][1]).len : 0;
    if (p.pause && gap[k] < PAUSE_MIN && quiet < 0.03) { const q = { ...p }; delete q.pause; ours[kept[k]] = q; }
    else if (!p.pause && quiet >= PAUSE_MIN) ours[kept[k]] = { ...p, pause: 'short', wordEnd: true };
    if (ours[kept[k]].pause || !(gap[k] > 0)) continue;
    const stop = (j: number) => STOP.test(ours[kept[j]].ipa);
    if (quiet >= 0.5 * gap[k] && stop(k + 1)) len[k + 1] += gap[k];
    else if (quiet >= 0.5 * gap[k] && stop(k)) len[k] += gap[k];
    else { len[k] += 0.5 * gap[k]; len[k + 1] += 0.5 * gap[k]; }
  }
  const want: number[] = [], after: number[] = [];
  let debt = 0;
  for (let k = 0; k < K; k++) {
    want[k] = Math.min(6 * own[k], Math.max(0.4 * own[k], 0.02, len[k] + debt));
    debt += len[k] - want[k];
    if (ours[kept[k]].pause && k < K - 1) { after[k] = Math.max(0.01, gap[k] + debt); debt = 0; }
  }
  return retime(phones, ours, kept, want, after, plan, plain, theirs[0].t0 - trail);
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
