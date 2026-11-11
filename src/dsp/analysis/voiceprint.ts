/**
 * What can be measured of a voice from a recording, without knowing what it
 * says: its pitch and how far it moves, the shape of its pulses (the first
 * two harmonics, the cepstral peak), its formants and how strong the voice is
 * at them against its first harmonic, the balance of its
 * spectrum, the hiss of its consonants against its vowels, its pace and its
 * pauses. The same measures are taken on a recording and on what the
 * simulator says, so that one can be brought toward the other.
 */
import { yin } from './pitch';
import { decimate, lpcFormants } from './lpc';
import { getFFT, hann } from '../util/fft';

/** a recording, mono */
export interface Clip { samples: Float32Array; fs: number }

export interface VoicePrint {
  /** sample rate of the analysis (the lowest of the clips) */
  fs: number;
  /** seconds of sound above the silence gate */
  speech: number;
  /** share of those seconds that are voiced */
  voicedShare: number;
  /** pitch: median, 5th and 95th percentile (Hz), spread (semitones) */
  f0: number;
  f0Low: number;
  f0High: number;
  f0Sd: number;
  /** first harmonic over the second (dB), median of the voiced frames */
  h1h2: number;
  /** cepstral peak prominence (dB): how periodic the voice is, against breath and roughness */
  cpp: number;
  /** F1-F4 (Hz), medians of the loud voiced frames */
  formants: number[];
  /** the first harmonic over the strongest harmonic near F1, F2 and F3 (dB; Hanson 1997's H1-A1, H1-A2, H1-A3), medians of
   *  the same frames: the higher, the faster the harmonics of the source fall (a softer closure of the folds) */
  h1a: number[];
  /** the voiced frames' power in BANDS, dB against all of it */
  bands: number[];
  /** the unvoiced frames' power in HISS_BANDS, dB against the mean power of a voiced frame (NaN above the band of the recording) */
  hiss: number[];
  /** syllable nuclei per second of speech */
  syllables: number;
  /** mean pause inside the speech (s), 0 when there is none */
  pause: number;
  /** voiced frames that were measured */
  frames: number;
}

export const BANDS: readonly [number, number][] = [[50, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000]];
export const HISS_BANDS: readonly [number, number][] = [[2000, 4000], [4000, 8000], [8000, 10500]];

const HOP = 0.01;
const WIN = 0.04;
/** below the loudest frames of a clip by more than this, a frame is silence */
const GATE = 35;
/** a voiced frame is loud enough for its formants within this of the loudest */
const LOUD = 12;
const PAUSE_MIN = 0.12;

const db = (x: number) => 10 * Math.log10(x + 1e-30);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, (s.length - 1) * p));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

interface Frame { level: number; f0: number; speech: boolean; voiced: boolean; power: Float64Array; t: number }

/** the measures of one or more clips, pooled */
export function voicePrint(input: Clip[]): VoicePrint {
  // everything is measured at 24 kHz or below (as fast, and the same for every source)
  const clips = input.map((c) => { const f = Math.max(1, Math.floor(c.fs / 24000)); return f > 1 ? { samples: Float32Array.from(decimate(c.samples, f)), fs: c.fs / f } : c; });
  const fs = Math.min(...clips.map((c) => c.fs));
  const f0s: number[] = [], h12: number[] = [], cpps: number[] = [], fm: number[][] = [[], [], [], []], h1a: number[][] = [[], [], []];
  const bandV = new Float64Array(BANDS.length), bandU = new Float64Array(HISS_BANDS.length);
  let voicedPower = 0, nVoiced = 0, nUnvoiced = 0, nSpeech = 0, nuclei = 0;
  const pauses: number[] = [];
  for (const clip of clips) {
    const frames = framesOf(clip);
    const fsC = clip.fs, n = Math.round(WIN * fsC);
    let size = 1;
    while (size < n) size <<= 1;
    const binHz = fsC / size;
    const top = Math.max(...frames.map((f) => f.level));
    // the formants on a copy at about 11 kHz
    const factor = Math.max(1, Math.round(fsC / 11025));
    const low = decimate(clip.samples, factor), fsD = fsC / factor, nD = Math.round(0.025 * fsD);
    // pitch smoothed within each voiced stretch (octave slips of one or two frames)
    smoothPitch(frames);
    for (const f of frames) {
      if (f.speech) nSpeech++;
      if (!f.speech) continue;
      if (f.voiced) {
        nVoiced++;
        f0s.push(f.f0);
        let tot = 0;
        for (let k = 1; k < f.power.length; k++) tot += f.power[k];
        voicedPower += tot;
        BANDS.forEach(([a, b], j) => { bandV[j] += bandPower(f.power, binHz, a, b); });
        const peak = (c: number, r = 0.2) => { let m = 0; for (let k = Math.floor(((1 - r) * c) / binHz); k <= Math.ceil(((1 + r) * c) / binHz) && k < f.power.length; k++) m = Math.max(m, f.power[k]); return m; };
        h12.push(db(peak(f.f0)) - db(peak(2 * f.f0)));
        cpps.push(cppOf(f.power, fsC, size));
        if (f.level > top - LOUD) {
          const c = Math.round(f.t * fsD), a = Math.max(0, c - (nD >> 1));
          if (a + nD <= low.length) {
            const got = lpcFormants(low.subarray(a, a + nD), fsD, 12, 500).filter((x) => x.f > 180);
            if (got.length >= 3) {
              for (let j = 0; j < Math.min(4, got.length); j++) fm[j].push(got[j].f);
              const h1 = db(peak(f.f0, 0.1));
              [0.1, 0.08, 0.06].forEach((r, j) => { if (got[j].f < fsC / 2 - 200) h1a[j].push(h1 - db(peak(got[j].f, r))); });
            }
          }
        }
      } else {
        nUnvoiced++;
        HISS_BANDS.forEach(([a, b], j) => { bandU[j] += b <= fsC / 2 ? bandPower(f.power, binHz, a, b) : NaN; });
      }
    }
    nuclei += nucleiOf(frames, binHz);
    // pauses: silences between two stretches of speech
    const first = frames.findIndex((f) => f.speech);
    let run = 0;
    for (let i = Math.max(0, first); i < frames.length; i++) {
      if (!frames[i].speech) run++;
      else { if (run * HOP >= PAUSE_MIN) pauses.push(run * HOP); run = 0; }
    }
  }
  const allV = bandV.reduce((a, b) => a + b, 0);
  const meanV = voicedPower / Math.max(1, nVoiced);
  const med = pct(f0s, 0.5);
  const st = f0s.map((f) => 12 * Math.log2(f / med));
  const mean = st.reduce((a, b) => a + b, 0) / Math.max(1, st.length);
  return {
    fs,
    speech: nSpeech * HOP,
    voicedShare: nVoiced / Math.max(1, nSpeech),
    f0: med, f0Low: pct(f0s, 0.05), f0High: pct(f0s, 0.95),
    f0Sd: Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, st.length)),
    h1h2: pct(h12, 0.5), cpp: pct(cpps, 0.5),
    formants: fm.map((xs) => pct(xs, 0.5)),
    h1a: h1a.map((xs) => pct(xs, 0.5)),
    bands: Array.from(bandV, (e) => db(e) - db(allV)),
    hiss: Array.from(bandU, (e) => (Number.isNaN(e) || !nUnvoiced ? NaN : db(e / nUnvoiced) - db(meanV))),
    syllables: nuclei / Math.max(HOP, nSpeech * HOP),
    pause: pauses.length ? pauses.reduce((a, b) => a + b, 0) / pauses.length : 0,
    frames: nVoiced,
  };
}

function bandPower(p: Float64Array, binHz: number, a: number, b: number): number {
  let s = 0;
  for (let k = Math.max(1, Math.ceil(a / binHz)); k < p.length && k * binHz < b; k++) s += p[k];
  return s;
}

function framesOf(clip: Clip): Frame[] {
  const { samples: x, fs } = clip;
  const n = Math.round(WIN * fs), hop = Math.round(HOP * fs);
  let size = 1;
  while (size < n) size <<= 1;
  const w = hann(n), fft = getFFT(size);
  const re = new Float64Array(size), im = new Float64Array(size);
  const out: Frame[] = [];
  let wsum = 0;
  for (let i = 0; i < n; i++) wsum += w[i] * w[i];
  for (let s = 0; s + n <= x.length; s += hop) {
    const frame = x.subarray(s, s + n);
    let e = 0;
    re.fill(0); im.fill(0);
    for (let i = 0; i < n; i++) { e += frame[i] * frame[i]; re[i] = frame[i] * w[i]; }
    fft.transform(re, im);
    const power = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) power[k] = (re[k] * re[k] + im[k] * im[k]) / wsum;
    const p = yin(frame, fs, 60, 500, 0.15);
    out.push({ level: db(e / n), f0: p.f0, speech: false, voiced: p.f0 > 0 && p.confidence > 0.6, power, t: (s + n / 2) / fs });
  }
  const top = pct(out.map((f) => f.level), 0.98);
  for (const f of out) {
    f.speech = f.level > top - GATE;
    f.voiced = f.voiced && f.speech && f.level > top - GATE + 5;
  }
  return out;
}

/** a voiced frame whose pitch is an octave off its neighbours' median is taken back to it */
function smoothPitch(frames: Frame[]): void {
  const f0 = frames.map((f) => (f.voiced ? f.f0 : 0));
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].voiced) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - 3); j <= Math.min(frames.length - 1, i + 3); j++) if (f0[j] > 0) near.push(f0[j]);
    const m = pct(near, 0.5), r = f0[i] / m;
    if (r > 1.7) frames[i].f0 = f0[i] / Math.round(r);
    else if (r < 0.6) frames[i].f0 = f0[i] * Math.round(1 / r);
  }
}

/** cepstral peak prominence of one frame's power spectrum (Hillenbrand et al. 1994, in outline) */
function cppOf(power: Float64Array, fs: number, size: number): number {
  const fft = getFFT(size);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let k = 0; k <= size / 2; k++) { re[k] = db(power[k]); if (k > 0 && k < size / 2) re[size - k] = re[k]; }
  fft.inverse(re, im);
  const q0 = Math.floor(fs / 500), q1 = Math.min(size / 2 - 1, Math.ceil(fs / 60));
  // the regression line of the cepstrum over 1-20 ms
  const a0 = Math.max(1, Math.round(0.001 * fs)), a1 = Math.min(size / 2 - 1, Math.round(0.02 * fs));
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let q = a0; q <= a1; q++) { sx += q; sy += re[q]; sxx += q * q; sxy += q * re[q]; m++; }
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx), icpt = (sy - slope * sx) / m;
  let best = -Infinity, at = q0;
  for (let q = q0; q <= q1; q++) if (re[q] > best) { best = re[q]; at = q; }
  return best - (slope * at + icpt);
}

/** syllable nuclei: peaks of the voiced energy between 300 and 2500 Hz, at least 60 ms apart */
function nucleiOf(frames: Frame[], binHz: number): number {
  const e = frames.map((f) => (f.voiced ? db(bandPower(f.power, binHz, 300, 2500)) : -300));
  const sm = e.map((_, i) => { let s = 0, c = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < e.length) { s += e[j]; c++; } return s / c; });
  const top = Math.max(...sm);
  let count = 0;
  for (let i = 0; i < sm.length; i++) {
    if (sm[i] < top - 25 || !frames[i].voiced) continue;
    let peak = true, lowL = sm[i], lowR = sm[i];
    for (let j = Math.max(0, i - 6); j <= Math.min(sm.length - 1, i + 6); j++) if (sm[j] > sm[i] || (sm[j] === sm[i] && j < i)) { peak = false; break; }
    if (!peak) continue;
    for (let j = i - 1; j >= Math.max(0, i - 25); j--) lowL = Math.min(lowL, sm[j]);
    for (let j = i + 1; j <= Math.min(sm.length - 1, i + 25); j++) lowR = Math.min(lowR, sm[j]);
    if (sm[i] - Math.max(lowL, lowR) > 3) count++;
  }
  return count;
}
