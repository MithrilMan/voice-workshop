/**
 * How the consonants of our copies differ from the recordings', on the
 * files scripts/copy-test.ts wrote (<row>_orig.wav, <row>_all.wav or
 * another version with --version=, and <row>_phones.json, the sounds of
 * the copy on the recording's time):
 * - the middle half of each sound of 45 ms or more: its level below the
 *   vowels of its sentence (their median) and the balance of six bands,
 *   by kind (nasal, liquid or glide, sibilant, other fricative, affricate,
 *   voiced stop, voiceless stop; a stop's middle is its closure), how deep
 *   a stop's closure goes (its quietest 20 ms, whatever the alignment) and
 *   the floor before the speech;
 * - the spectrum of the middle half of /s z ʃ/ (power per Hz in bands from
 *   1 to 12 kHz, dB below its strongest band);
 * - the passages between a consonant and a vowel: with the cepstra
 *   (c1-c12, every 10 ms), how far along from the middle of the consonant
 *   to the middle of the vowel each frame is, the time it takes from 20 to
 *   80 % of the way and when it is half-way (ms after the edge);
 * - the hiss: the band from 3 to 12 kHz, ours less theirs, every 5 ms, by
 *   where it is (the middle or the edge of a vowel or a consonant, a pause)
 *   and the sounds and passages where ours is most often 6 dB louder.
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
  const power = (x: Float32Array, t0: number, t1: number) => { let e = 0, m = 0; for (let i = Math.max(0, Math.round(t0 * fs)); i < Math.round(t1 * fs) && i < x.length; i++) { e += x[i] * x[i]; m++; } return 10 * Math.log10(e / Math.max(1, m) + 1e-20); };
  const vowels = (x: Float32Array) => med(phones.filter((p) => VOWEL.test(p.ipa)).map((p) => measure(x, ...middle(p))?.db ?? NaN));
  const vo = vowels(o.samples), va = vowels(a.samples);
  for (const p of phones) {
    if (p.ipa === '_' || p.t1 - p.t0 < 0.045) continue;
    const k = kindOf(p.ipa), ro = measure(o.samples, ...middle(p)), ra = measure(a.samples, ...middle(p));
    if (!ro || !ra) continue;
    add(`${k} below theirs`, vo - ro.db); add(`${k} below ours`, va - ra.db);
    BANDS.forEach((_, j) => add(`${k} band ${j}`, ra.bands[j] - ro.bands[j]));
    // how deep a stop's closure goes, whatever the alignment: its quietest 20 ms, from 30 ms before it to 30 ms after
    if (/stop$/.test(k)) for (const [who, x, v] of [['theirs', o.samples, vo], ['ours', a.samples, va]] as const) {
      let lo = Infinity;
      for (let t = p.t0 - 0.03; t + 0.02 <= p.t1 + 0.03; t += 0.0025) lo = Math.min(lo, power(x, t, t + 0.02));
      add(`${k} quietest ${who}`, v - lo);
    }
  }
  // before the first sound (more than 80 ms of it), the floor
  for (const [who, x, v] of [['theirs', o.samples, vo], ['ours', a.samples, va]] as const) {
    if (phones[0].t0 > 0.08) add(`floor ${who}`, v - power(x, 0.01, phones[0].t0 - 0.05));
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

  // the hiss: the band from 3 to 12 kHz, ours less theirs (both files are at the same loudness),
  // every 5 ms where either is within 45 dB of its loudest, by where it is
  {
    const nh = 512, wh = hann(nh), step = Math.round(0.005 * fs);
    const high = (x: Float32Array, s: number) => { const S = powerSpectrum(x.subarray(s, s + nh), nh, wh); let e = 0, t = 0; for (let q = 1; q < S.length; q++) { const f = (q * fs) / nh; if (f >= 3000 && f < 12000) e += S[q]; if (f >= 50 && f < 12000) t += S[q]; } return [10 * Math.log10(e + 1e-20), 10 * Math.log10(t + 1e-20)]; };
    const fr: { t: number; d: number; to: number; ta: number }[] = [];
    let topO = -Infinity, topA = -Infinity;
    for (let s = 0; s + nh <= Math.min(o.samples.length, a.samples.length); s += step) {
      const [ho, to] = high(o.samples, s), [ha, ta] = high(a.samples, s);
      fr.push({ t: (s + nh / 2) / fs, d: ha - ho, to, ta }); topO = Math.max(topO, to); topA = Math.max(topA, ta);
    }
    const lang = name.startsWith('i') ? 'it' : 'en';
    for (const f of fr) {
      if (f.to < topO - 45 && f.ta < topA - 45) continue;
      const i = phones.findIndex((p) => f.t >= p.t0 && f.t < p.t1);
      if (i < 0) continue;
      const p = phones[i], edge = Math.min(f.t - p.t0, p.t1 - f.t) < 0.025;
      add(`hiss ${p.ipa === '_' ? 'pause' : `${VOWEL.test(p.ipa) ? 'vowel' : 'consonant'} ${edge ? 'edge' : 'middle'}`}`, f.d);
      const where = !edge ? (VOWEL.test(p.ipa) ? `V ${p.ipa}` : p.ipa) : (f.t - p.t0 < p.t1 - f.t ? `${phones[i - 1]?.ipa ?? '#'}>${p.ipa}` : `${p.ipa}>${phones[i + 1]?.ipa ?? '#'}`).replace(/[aeiouyɪʊɛɔæʌɑɒəɚɝ]+/g, 'V');
      add(`hiss at ${lang} ${where}`, f.d);
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
for (const k of ['voiced stop', 'voiceless stop']) if (acc[`${k} quietest theirs`]) console.log(`  ${k}, its quietest 20 ms: ${med(acc[`${k} quietest theirs`]).toFixed(0)} / ${med(acc[`${k} quietest ours`]).toFixed(0)} dB below the vowels`);
if (acc['floor theirs']) console.log(`  before the speech: ${med(acc['floor theirs']).toFixed(0)} / ${med(acc['floor ours']).toFixed(0)} dB below the vowels`);
console.log(`Sibilants, power per Hz in ${SIB.slice(0, -1).map((e, j) => `${e / 1000}-${SIB[j + 1] / 1000}k`).join(' ')}, dB below the strongest band (median)`);
for (const [k, v] of Object.entries(sib)) console.log(`  ${k} (${v.length}): ${SIB.slice(0, -1).map((_, j) => med(v.map((r) => r[j])).toFixed(0)).join(' ')}`);
console.log('Passages, ms from 20 to 80 % of the way / ms after the edge at half-way, theirs against ours');
for (const k of [...new Set(Object.keys(acc).filter((x) => / (theirs|ours) takes$/.test(x)).map((x) => x.replace(/ (theirs|ours) takes$/, '')))].sort()) {
  console.log(`  ${k} (${acc[`${k} theirs takes`]?.length ?? 0}): ${med(acc[`${k} theirs takes`]).toFixed(0)} / ${med(acc[`${k} ours takes`]).toFixed(0)} ms; half-way ${med(acc[`${k} theirs half`]).toFixed(0)} / ${med(acc[`${k} ours half`]).toFixed(0)} ms`);
}
console.log('The hiss, 3-12 kHz, ours less theirs (dB, median; share of the 5 ms frames more than 6 dB louder)');
for (const k of ['vowel middle', 'vowel edge', 'consonant middle', 'consonant edge', 'pause']) {
  const v = acc[`hiss ${k}`];
  if (v) console.log(`  ${k} (${v.length}): ${med(v).toFixed(1)}; ${((100 * v.filter((x) => x > 6).length) / v.length).toFixed(0)} %`);
}
const loudest = Object.entries(acc).filter(([k]) => k.startsWith('hiss at ')).map(([k, v]) => ({ k: k.slice(8), n: v.filter((x) => x > 6).length, all: v.length, m: med(v) })).sort((x, y) => y.n - x.n).slice(0, 12);
console.log(`  most often louder: ${loudest.map((x) => `${x.k} ${x.n}/${x.all} (${x.m.toFixed(0)})`).join(', ')}`);
