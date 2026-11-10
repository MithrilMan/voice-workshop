/**
 * How the consonants of our copies differ from the recordings', on the
 * files scripts/copy-test.ts wrote (<row>_orig.wav, <row>_all.wav or
 * another version with --version=, and <row>_phones.json, the sounds of
 * the copy on the recording's time):
 * - the middle half of each sound of 45 ms or more: its level below the
 *   vowels of its sentence (their median) and the balance of six bands,
 *   by kind (nasal, liquid or glide, sibilant, other fricative, affricate,
 *   voiced stop, voiceless stop; a stop's middle is its closure);
 * - the spectrum of the middle half of /s z ʃ/ (power per Hz in bands from
 *   1 to 12 kHz, dB below its strongest band);
 * - the passages between a consonant and a vowel: with the cepstra
 *   (c1-c12, every 10 ms), how far along from the middle of the consonant
 *   to the middle of the vowel each frame is, the time it takes from 20 to
 *   80 % of the way and when it is half-way (ms after the edge).
 *   npx tsx scripts/consonant-report.ts .ref/copy [--version=all]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav } from '../src/dsp/util/wav';
import { analyse } from '../src/dsp/voice/copy';
import { powerSpectrum, hann } from '../src/dsp/util/fft';

const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.ref/copy';
const version = process.argv.find((a) => a.startsWith('--version='))?.slice(10) ?? 'all';
const VOWEL = /^[ˈˌ]?[aeiouyɪʊɛɔæʌɑɒəɚɝɐøœɯɤɨʉ]/;
const KINDS: [RegExp, string][] = [[/^[mnɲŋɱ]/, 'nasal'], [/^[lɫrɾɹjwʎ]/, 'liquid/glide'], [/^(t[ʃs]|d[ʒz])/, 'affricate'], [/^[szʃʒ]/, 'sibilant'], [/^[fvθðh]/, 'other fricative'], [/^[bdg]/, 'voiced stop'], [/^[ptkʔ]/, 'voiceless stop']];
const kindOf = (ipa: string) => (VOWEL.test(ipa) ? 'vowel' : KINDS.find(([r]) => r.test(ipa))?.[1] ?? 'other');
const BANDS = [[50, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 12000]];
const SIB = [1000, 1600, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12000];
const med = (xs: number[] = []) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

const acc: Record<string, number[]> = {};
const add = (k: string, v: number) => { if (Number.isFinite(v)) (acc[k] ??= []).push(v); };
const sib: Record<string, number[][]> = {};
const rows = readdirSync(dir).filter((f) => f.endsWith('_orig.wav')).map((f) => f.replace('_orig.wav', ''));
for (const name of rows) {
  const load = (v: string) => decodeWav(new Uint8Array(readFileSync(join(dir, `${name}_${v}.wav`))));
  const o = load('orig'), a = load(version), fs = o.fs;
  const phones: { ipa: string; t0: number; t1: number }[] = JSON.parse(readFileSync(join(dir, `${name}_phones.json`), 'utf-8'));
  const both = [['theirs', o.samples], ['ours', a.samples]] as const;
  const middle = (p: { t0: number; t1: number }) => { const m = Math.max(0.0125, 0.25 * (p.t1 - p.t0)); return [p.t0 + m, p.t1 - m] as const; };

  // level and band balance of the middle of each sound: 20 ms frames every 5 ms
  const n = Math.round(0.02 * fs), w = hann(n);
  let size = 1; while (size < n) size <<= 1;
  const measure = (x: Float32Array, t0: number, t1: number) => {
    const b = new Float64Array(BANDS.length); let e = 0, m = 0;
    for (let t = t0; t + 0.02 <= t1; t += 0.005) {
      const s = Math.round(t * fs); if (s + n > x.length) break;
      const seg = x.subarray(s, s + n);
      for (const v of seg) e += v * v;
      const S = powerSpectrum(seg, size, w);
      BANDS.forEach(([lo, hi], j) => { for (let q = Math.ceil(lo / (fs / size)); q * (fs / size) < hi && q < S.length; q++) b[j] += S[q]; });
      m++;
    }
    if (!m) return null;
    const tot = b.reduce((p, q) => p + q, 0);
    return { db: 10 * Math.log10(e / (m * n) + 1e-12), bands: Array.from(b, (v) => 10 * Math.log10(v / tot + 1e-12)) };
  };
  const vowels = (x: Float32Array) => med(phones.filter((p) => VOWEL.test(p.ipa)).map((p) => measure(x, ...middle(p))?.db ?? NaN));
  const vo = vowels(o.samples), va = vowels(a.samples);
  for (const p of phones) {
    if (p.ipa === '_' || p.t1 - p.t0 < 0.045) continue;
    const k = kindOf(p.ipa), ro = measure(o.samples, ...middle(p)), ra = measure(a.samples, ...middle(p));
    if (!ro || !ra) continue;
    add(`${k} below theirs`, vo - ro.db); add(`${k} below ours`, va - ra.db);
    BANDS.forEach((_, j) => add(`${k} band ${j}`, ra.bands[j] - ro.bands[j]));
  }

  // the spectrum of the sibilants
  const ns = 512, ws = hann(ns);
  for (const p of phones) {
    if (!/^[szʃ]$/.test(p.ipa) || p.t1 - p.t0 < 0.05) continue;
    const [t0, t1] = [p.t0 + 0.25 * (p.t1 - p.t0), p.t1 - 0.25 * (p.t1 - p.t0)];
    for (const [who, x] of both) {
      const b = new Float64Array(SIB.length - 1);
      for (let t = t0; t + ns / fs <= t1 + 1e-9; t += 0.005) {
        const s = Math.round(t * fs); if (s + ns > x.length) break;
        const S = powerSpectrum(x.subarray(s, s + ns), ns, ws);
        for (let j = 0; j + 1 < SIB.length; j++) for (let q = Math.ceil(SIB[j] / (fs / ns)); q * (fs / ns) < SIB[j + 1] && q < S.length; q++) b[j] += S[q] / (SIB[j + 1] - SIB[j]);
      }
      const top = Math.max(...b);
      if (top > 0) (sib[`${p.ipa} ${who}`] ??= []).push(Array.from(b, (v) => 10 * Math.log10(v / top + 1e-12)));
    }
  }

  // the passages between a consonant and a vowel
  const cep = { theirs: analyse(o).cep, ours: analyse(a).cep };
  const frame = (t: number) => Math.round((t - 0.0125) / 0.01);
  const mean = (c: Float64Array[], t0: number, t1: number) => {
    const m = new Float64Array(c[0].length); let k0 = 0;
    for (let k = Math.max(0, frame(t0)); k <= Math.min(c.length - 1, frame(t1)); k++, k0++) for (let j = 0; j < m.length; j++) m[j] += c[k][j];
    return k0 ? m.map((v) => v / k0) : null;
  };
  for (let i = 0; i + 1 < phones.length; i++) {
    const p = phones[i], q = phones[i + 1];
    if (p.ipa === '_' || q.ipa === '_' || VOWEL.test(p.ipa) === VOWEL.test(q.ipa)) continue;
    const cv = VOWEL.test(q.ipa), C = cv ? p : q, V = cv ? q : p;
    if (C.t1 - C.t0 < 0.04 || V.t1 - V.t0 < 0.06) continue;
    const kind = `${cv ? 'CV' : 'VC'} ${kindOf(C.ipa)}`, mid = (s: typeof p) => [s.t0 + 0.35 * (s.t1 - s.t0), s.t0 + 0.65 * (s.t1 - s.t0)] as const;
    for (const who of ['theirs', 'ours'] as const) {
      const c = cep[who], mc = mean(c, ...mid(C)), mv = mean(c, ...mid(V));
      if (!mc || !mv) continue;
      let span = 0; for (let j = 0; j < mc.length; j++) span += (mv[j] - mc[j]) ** 2;
      if (span < 4) continue;
      // from the sound before the edge (0) to the one after it (1), 80 ms either side
      const along: [number, number][] = [];
      for (let k = Math.max(0, frame(p.t1 - 0.08)); k <= Math.min(c.length - 1, frame(p.t1 + 0.08)); k++) {
        let d = 0; for (let j = 0; j < mc.length; j++) d += (c[k][j] - mc[j]) * (mv[j] - mc[j]);
        along.push([k * 0.01 + 0.0125 - p.t1, cv ? d / span : 1 - d / span]);
      }
      const when = (lv: number) => { for (let m = 1; m < along.length; m++) { const [t0, x0] = along[m - 1], [t1, x1] = along[m]; if (x0 < lv && x1 >= lv) return t0 + ((lv - x0) / (x1 - x0)) * (t1 - t0); } return NaN; };
      add(`${kind} ${who} takes`, 1000 * (when(0.8) - when(0.2))); add(`${kind} ${who} half`, 1000 * when(0.5));
      add(`${cv ? 'CV' : 'VC'} all ${who} takes`, 1000 * (when(0.8) - when(0.2))); add(`${cv ? 'CV' : 'VC'} all ${who} half`, 1000 * when(0.5));
    }
  }
}

console.log(`The middle of each sound (${version} against the recordings): dB below the vowels, theirs / ours; bands ${BANDS.map(([l, h]) => `${l / 1000}-${h / 1000}k`).join(' ')} ours less theirs (dB of the whole)`);
for (const k of ['nasal', 'liquid/glide', 'sibilant', 'other fricative', 'affricate', 'voiced stop', 'voiceless stop']) {
  if (!acc[`${k} below theirs`]) continue;
  console.log(`  ${k} (${acc[`${k} below theirs`].length}): ${med(acc[`${k} below theirs`]).toFixed(1)} / ${med(acc[`${k} below ours`]).toFixed(1)} dB; bands ${BANDS.map((_, j) => med(acc[`${k} band ${j}`]).toFixed(1)).join(' ')}`);
}
console.log(`Sibilants, power per Hz in ${SIB.slice(0, -1).map((e, j) => `${e / 1000}-${SIB[j + 1] / 1000}k`).join(' ')}, dB below the strongest band (median)`);
for (const [k, v] of Object.entries(sib)) console.log(`  ${k} (${v.length}): ${SIB.slice(0, -1).map((_, j) => med(v.map((r) => r[j])).toFixed(0)).join(' ')}`);
console.log('Passages, ms from 20 to 80 % of the way / ms after the edge at half-way, theirs against ours');
for (const k of [...new Set(Object.keys(acc).filter((x) => / (theirs|ours) takes$/.test(x)).map((x) => x.replace(/ (theirs|ours) takes$/, '')))].sort()) {
  console.log(`  ${k} (${acc[`${k} theirs takes`]?.length ?? 0}): ${med(acc[`${k} theirs takes`]).toFixed(0)} / ${med(acc[`${k} ours takes`]).toFixed(0)} ms; half-way ${med(acc[`${k} theirs half`]).toFixed(0)} / ${med(acc[`${k} ours half`]).toFixed(0)} ms`);
}
