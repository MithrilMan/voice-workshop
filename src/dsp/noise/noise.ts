import { Rng } from '../util/rng';
import { FFT } from '../util/fft';

/**
 * Turbulence noise source: Gaussian white noise shaped by a first-order
 * high-pass (dipole sources radiate little at very low frequency) and a
 * low-pass whose corner follows the jet, f_c = St * v / D (Strouhal
 * scaling: faster or narrower jets make higher-pitched noise).
 * With one pole the source falls at -6 dB/octave above f_c, which the
 * +6 dB/octave of lip radiation turns into a roughly flat radiated spectrum,
 * as observed for fricatives without a front-cavity resonance such as /f/
 * (Stevens 1998); the jets of the mouth, whose corner is high, were matched
 * to measured sibilants and bursts that way.
 * With two poles it falls at -12 dB/octave, as the spectrum Stevens (1989)
 * gives for the source of turbulence noise does: flat to 1 kHz, 4 dB down at
 * 2 kHz, 14 at 5 and 26 at 10, which two poles at 2.5 kHz follow within
 * 2 dB up to 5 kHz and 3.5 dB at 10. That is for the slow, wide jet of the
 * glottis, whose corner is near 2 kHz: with one pole its breath was radiated
 * flat up to 20 kHz, a hiss as bright as a sibilant.
 */
export class TurbulenceSource {
  private rng: Rng;
  private hpA = 0;
  private lpA = 0;
  private hpX = 0;
  private hpY = 0;
  private lpY = 0;
  private lpY2 = 0;
  private fs = 0;
  private fc = 0;
  private hpF = 200;
  /** last output sample */
  value = 0;

  /** poles: how fast the source falls above its corner, 1 (-6 dB/octave) or 2 (-12) */
  constructor(seed: number, private poles: 1 | 2 = 1) { this.rng = new Rng(seed); }

  configure(fs: number, fc: number, hp = 200): void {
    const f = Math.min(Math.max(fc, 300), fs * 0.2);
    if (fs !== this.fs || hp !== this.hpF) {
      this.hpA = Math.exp((-2 * Math.PI * hp) / fs);
      this.fs = fs; this.hpF = hp; this.fc = 0;
    }
    if (Math.abs(f - this.fc) > 0.02 * this.fc) {
      this.lpA = Math.exp((-2 * Math.PI * f) / fs);
      this.fc = f;
    }
  }

  next(): number {
    const x = this.rng.gauss();
    // one-pole high-pass
    this.hpY = this.hpA * (this.hpY + x - this.hpX);
    this.hpX = x;
    // one-pole low-pass, normalised so that the passband gain is about 1
    this.lpY = this.lpA * this.lpY + (1 - this.lpA) * this.hpY;
    // compensate the low-pass loss of power for white input (keeps level ~ independent of fc)
    const gain = Math.sqrt((1 + this.lpA) / (1 - this.lpA + 1e-9)) * 0.25;
    if (this.poles === 1) return (this.value = this.lpY * gain);
    // a second pole at the corner takes away what lies above it, and leaves the level below
    this.lpY2 = this.lpA * this.lpY2 + (1 - this.lpA) * this.lpY;
    this.value = this.lpY2 * gain;
    return this.value;
  }

  /** Approximate magnitude of the source shaping at frequency f (relative). */
  shape(f: number): number {
    const hp = f / Math.hypot(f, this.hpF);
    const lp = 1 / Math.hypot(1, f / Math.max(this.fc, 1));
    return hp * (this.poles === 1 ? lp : lp * lp);
  }
}

/** Number of control points of a user-drawn noise spectrum (log-spaced). */
export const NOISE_CURVE_POINTS = 32;
export const NOISE_CURVE_FMIN = 50;
export const NOISE_CURVE_FMAX = 16000;

export function noiseCurveFreq(i: number): number {
  return NOISE_CURVE_FMIN * Math.pow(NOISE_CURVE_FMAX / NOISE_CURVE_FMIN, i / (NOISE_CURVE_POINTS - 1));
}

export type NoiseColour = 'white' | 'pink' | 'brown' | 'blue' | 'violet';

/** dB curve of a coloured noise (power spectral density slope), 0 dB at 1 kHz. */
export function colourCurve(c: NoiseColour, tiltDbPerOct = 0): Float32Array {
  const slope = { white: 0, pink: -3, brown: -6, blue: 3, violet: 6 }[c] + tiltDbPerOct;
  const out = new Float32Array(NOISE_CURVE_POINTS);
  for (let i = 0; i < NOISE_CURVE_POINTS; i++) out[i] = slope * Math.log2(noiseCurveFreq(i) / 1000);
  return out;
}

/** Interpolates a dB curve (log frequency) at f. */
export function curveAt(curve: ArrayLike<number>, f: number): number {
  const n = curve.length;
  const x = (Math.log(Math.max(f, 1) / NOISE_CURVE_FMIN) / Math.log(NOISE_CURVE_FMAX / NOISE_CURVE_FMIN)) * (n - 1);
  if (x <= 0) return curve[0];
  if (x >= n - 1) return curve[n - 1];
  const i = Math.floor(x), t = x - i;
  return curve[i] * (1 - t) + curve[i + 1] * t;
}

/**
 * Noise with an arbitrary (user-drawn) power spectrum, synthesised by
 * weighted overlap-add of random-phase frames (sqrt-Hann windows at 50 %
 * overlap keep the variance stationary). The spectrum is given as a dB curve
 * on log-spaced frequencies plus a band (low and high cut).
 */
export class ShapedNoise {
  private readonly m: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly win: Float64Array;
  private readonly mag: Float64Array;
  private bufA: Float64Array;
  private bufB: Float64Array;
  private pos = 0;
  private rng = new Rng(777);
  private fs = 0;
  private curve: Float32Array = colourCurve('white');
  private lowCut = 20;
  private highCut = 20000;
  private dirty = true;

  constructor(m = 1024) {
    this.m = m;
    this.fft = new FFT(m);
    this.re = new Float64Array(m);
    this.im = new Float64Array(m);
    this.win = new Float64Array(m);
    for (let i = 0; i < m; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / m));
    this.mag = new Float64Array(m / 2 + 1);
    this.bufA = new Float64Array(m);
    this.bufB = new Float64Array(m);
  }

  setSpectrum(curve: ArrayLike<number>, lowCut: number, highCut: number): void {
    this.curve = Float32Array.from(curve);
    this.lowCut = lowCut;
    this.highCut = highCut;
    this.dirty = true;
  }

  private updateMag(fs: number): void {
    this.fs = fs;
    const m = this.m;
    let pw = 0;
    for (let k = 0; k <= m / 2; k++) {
      const f = (k * fs) / m;
      let g = Math.pow(10, curveAt(this.curve, f) / 20);
      // smooth band edges (4th-order-like roll-off)
      if (f < this.lowCut) g *= Math.pow(f / this.lowCut, 4);
      if (f > this.highCut) g *= Math.pow(this.highCut / f, 4);
      if (k === 0) g = 0;
      this.mag[k] = g;
      pw += g * g;
    }
    // normalise to unit variance
    const norm = 1 / Math.sqrt(Math.max(pw, 1e-12) / (m / 2));
    for (let k = 0; k <= m / 2; k++) this.mag[k] *= norm;
    this.dirty = false;
  }

  private newFrame(out: Float64Array): void {
    const m = this.m;
    const re = this.re, im = this.im;
    re[0] = 0; im[0] = 0;
    for (let k = 1; k < m / 2; k++) {
      const a = this.mag[k];
      re[k] = a * this.rng.gauss();
      im[k] = a * this.rng.gauss();
      re[m - k] = re[k];
      im[m - k] = -im[k];
    }
    re[m / 2] = this.mag[m / 2] * this.rng.gauss(); im[m / 2] = 0;
    this.fft.inverse(re, im);
    const s = Math.sqrt(m / 2);
    for (let i = 0; i < m; i++) out[i] = re[i] * this.win[i] * s;
  }

  next(fs: number): number {
    if (this.dirty || fs !== this.fs) this.updateMag(fs);
    const h = this.m / 2;
    if (this.pos >= h) {
      // shift: bufA <- second half of B + first half of new frame
      const t = this.bufA; this.bufA = this.bufB; this.bufB = t;
      this.newFrame(this.bufB);
      this.pos = 0;
    }
    const v = this.bufA[this.pos + h] + this.bufB[this.pos];
    this.pos++;
    return v;
  }
}
