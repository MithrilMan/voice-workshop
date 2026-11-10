/**
 * How the spectral envelope of our copies differs from the recordings',
 * over the voiced frames where both are loud (within 15 dB of their
 * loudest): the formants F1-F3 (ours over theirs) and their bandwidths
 * (LPC of order 12 at about 11 kHz), the balance of five bands (ours less
 * theirs, dB) and how fast the envelope moves (the distance of the
 * cepstra c1-c12 from one 10 ms frame to the next). Reads the files
 * scripts/copy-test.ts wrote: <row>_orig.wav and <row>_all.wav.
 *   npx tsx scripts/envelope-report.ts .ref/copy
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav } from '../src/dsp/util/wav';
import { analyse } from '../src/dsp/voice/copy';
import { decimate, lpcFormants } from '../src/dsp/analysis/lpc';
import { yin } from '../src/dsp/analysis/pitch';
import { powerSpectrum, hann } from '../src/dsp/util/fft';

const dir = process.argv[2] ?? '.ref/copy';
const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const BANDS = [[50, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000]];

const rows = readdirSync(dir).filter((f) => f.endsWith('_orig.wav')).map((f) => f.replace('_orig.wav', ''));
const acc: Record<string, number[]> = {};
const add = (k: string, v: number) => { (acc[k] ??= []).push(v); };
for (const name of rows) {
  const load = (v: string) => decodeWav(new Uint8Array(readFileSync(join(dir, `${name}_${v}.wav`))));
  const o = load('orig'), a = load('all');
  const fs = o.fs, n = Math.round(0.04 * fs), hop = Math.round(0.01 * fs);
  const fac = Math.round(fs / 11025), oD = decimate(o.samples, fac), aD = decimate(a.samples, fac), fsD = fs / fac, nD = Math.round(0.025 * fsD);
  let size = 1; while (size < n) size <<= 1;
  const w = hann(n);
  const lv = (x: Float32Array, s: number) => { let e = 0; for (let i = s; i < s + n; i++) e += x[i] ** 2; return 10 * Math.log10(e / n + 1e-12); };
  const len = Math.min(o.samples.length, a.samples.length) - n;
  let to = -1e9, ta = -1e9;
  for (let s = 0; s < len; s += hop) { to = Math.max(to, lv(o.samples, s)); ta = Math.max(ta, lv(a.samples, s)); }
  const ca = analyse({ samples: a.samples, fs }), co = analyse({ samples: o.samples, fs });
  for (let s = 0, k = 0; s < len; s += hop, k++) {
    const fo = o.samples.subarray(s, s + n), fa = a.samples.subarray(s, s + n);
    const po = yin(fo, fs, 60, 500, 0.15), pa = yin(fa, fs, 60, 500, 0.15);
    if (!(po.f0 > 0 && po.confidence > 0.6 && pa.f0 > 0 && pa.confidence > 0.6)) continue;
    if (lv(o.samples, s) < to - 15 || lv(a.samples, s) < ta - 15) continue;
    const c = Math.round((s + n / 2) / fac), b = c - (nD >> 1);
    if (b < 0 || b + nD > oD.length || b + nD > aD.length) continue;
    const Fo = lpcFormants(oD.subarray(b, b + nD), fsD, 12, 700).filter((x) => x.f > 180);
    const Fa = lpcFormants(aD.subarray(b, b + nD), fsD, 12, 700).filter((x) => x.f > 180);
    if (Fo.length >= 3 && Fa.length >= 3) for (let j = 0; j < 3; j++) {
      add(`F${j + 1} ratio`, Fa[j].f / Fo[j].f);
      add(`B${j + 1} theirs`, Fo[j].bw); add(`B${j + 1} ours`, Fa[j].bw);
    }
    const So = powerSpectrum(fo, size, w), Sa = powerSpectrum(fa, size, w);
    const band = (S: Float64Array, lo: number, hi: number) => { let e = 0; for (let q = Math.ceil(lo / (fs / size)); q * (fs / size) < hi && q < S.length; q++) e += S[q]; return e; };
    const tot = (S: Float64Array) => band(S, 50, 8000);
    BANDS.forEach(([lo, hi]) => add(`band ${lo}-${hi} ours-theirs`, 10 * Math.log10(band(Sa, lo, hi) / tot(Sa)) - 10 * Math.log10(band(So, lo, hi) / tot(So))));
    // how fast the envelope moves
    if (k > 0 && k < ca.cep.length && k < co.cep.length) {
      let dA = 0, dO = 0;
      for (let q = 0; q < ca.cep[k].length; q++) { dA += (ca.cep[k][q] - ca.cep[k - 1][q]) ** 2; dO += (co.cep[k][q] - co.cep[k - 1][q]) ** 2; }
      add('flux ours', Math.sqrt(dA)); add('flux theirs', Math.sqrt(dO));
    }
  }
}
console.log(Object.entries(acc).map(([k, v]) => `${k}: ${med(v).toFixed(k.includes('ratio') ? 3 : 1)}`).join(' | ') + ` (${acc['flux ours']?.length ?? 0} frames)`);
// where the envelope moves less: its steady stretches (the quarter that moves least), its middle, its quickest changes
const pc = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
console.log(`flux at 25, 50, 90 %: ours ${[0.25, 0.5, 0.9].map((p) => pc(acc['flux ours'], p).toFixed(1)).join(', ')}; theirs ${[0.25, 0.5, 0.9].map((p) => pc(acc['flux theirs'], p).toFixed(1)).join(', ')}`);
