import type { Phone } from './g2p';

/**
 * A delivery learnt from recordings: how a speaker times, pauses, pitches and
 * swells the sounds of a sentence, read from the sentence itself.
 *
 * A small network reads the sounds as our reader gives them (each sound, its
 * stress, the edges of its word and phrase, whether the sentence asks, where
 * it stands in it, how long our default rules make it and the pitch they give
 * it) both ways along the sentence (two layers of gated recurrent units each
 * way), and answers for every sound how long the speaker makes it, the pause
 * after it, the pitch at 20, 50 and 80 % of it in semitones from the
 * speaker's median, and the swell of the loudness. It was learnt from the
 * recorded sentences of two speakers, a woman and a man, which one to follow
 * being one of its inputs; its weights come as JSON, and the forward pass is
 * done here, in the browser as in Node.
 */
export interface DeliveryModel {
  format: 'voice-workshop.delivery';
  version: number;
  /** the languages it learnt (its sentences were said in them) */
  languages: string[];
  /** width of the recurrent layers and of the embedding of a sound */
  c: number;
  emb: number;
  flags: string[];
  speakers: string[];
  vocab: Record<string, number>;
  nreal: number;
  /** the outputs come normalised: times sd plus mu */
  mu: number[];
  sd: number[];
  /** each speaker's median pitch, semitones from 200 Hz */
  med: number[];
  /** the weights, by the names of the network that learnt them: little-endian, base64, half or single precision */
  tensors: Record<string, { shape: number[]; dtype?: 'f16' | 'f32'; data: string }>;
}

/** What the network says of each sound. */
export interface Said {
  /** length of the sound and of the pause after it, s */
  dur: number;
  pause: number;
  /** pitch at 20, 50, 80 % of the sound, semitones from the speaker's median */
  st: [number, number, number];
  /** swell of the loudness at the same points (log of the lung pressure against the rules') */
  swell: [number, number, number];
}

/** What the network reads of each sound: the phone and what our default rules make of it. */
export interface Heard {
  phone: Phone;
  /** length and pause after it by our default rules, s */
  dur: number;
  pause: number;
  /** pitch at 20, 50, 80 % by our default rules, semitones from the default voice's own */
  st: [number, number, number];
}

type Mat = { rows: number; cols: number; w: Float32Array };

/** a half-precision number from its 16 bits */
function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function decode(t: { shape: number[]; dtype?: 'f16' | 'f32'; data: string }): Mat {
  const bin = atob(t.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let w: Float32Array;
  if (t.dtype === 'f16') {
    w = new Float32Array(bytes.length / 2);
    for (let i = 0; i < w.length; i++) w[i] = half(bytes[2 * i] | (bytes[2 * i + 1] << 8));
  } else w = new Float32Array(bytes.buffer);
  return { rows: t.shape[0], cols: t.shape.length > 1 ? t.shape[1] : 1, w };
}

/** y = W x + b */
function affine(m: Mat, b: Mat | null, x: Float32Array, out = new Float32Array(m.rows)): Float32Array {
  const { rows, cols, w } = m;
  for (let r = 0; r < rows; r++) {
    let s = b ? b.w[r] : 0;
    const o = r * cols;
    for (let c = 0; c < cols; c++) s += w[o + c] * x[c];
    out[r] = s;
  }
  return out;
}

/** erf, to 1.5e-7 (Abramowitz & Stegun 7.1.26) */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const gelu = (x: number) => 0.5 * x * (1 + erf(x / Math.SQRT2));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export class DeliveryNet {
  readonly model: DeliveryModel;
  private t: Record<string, Mat> = {};

  constructor(model: DeliveryModel) {
    if (model.format !== 'voice-workshop.delivery') throw new Error('not a delivery model');
    this.model = model;
    for (const [k, v] of Object.entries(model.tensors)) this.t[k] = decode(v);
  }

  /** the inputs of one sound, as the network learnt them */
  private real(h: Heard[], j: number, speaker: number): Float32Array {
    const K = h.length, p = h[j].phone as unknown as Record<string, unknown>;
    const v = [
      ...this.model.flags.map((f) => (p[f] ? 1 : 0)),
      p.pause === 'short' ? 1 : 0, p.pause === 'long' ? 1 : 0,
      j === K - 1 ? 1 : 0, j / K, (K - 1 - j) / K,
      Math.log(Math.max(1e-3, h[j].dur) / 0.08), h[j].pause / 0.2,
      ...h[j].st.map((x) => x / 12),
      ...this.model.speakers.map((_, i) => (i === speaker ? 1 : 0)),
    ];
    if (v.length !== this.model.nreal) throw new Error(`delivery model: ${v.length} inputs, it wants ${this.model.nreal}`);
    return Float32Array.from(v);
  }

  /** one direction of one recurrent layer over the whole sentence */
  private gru(xs: Float32Array[], layer: number, reverse: boolean): Float32Array[] {
    const sfx = `_l${layer}${reverse ? '_reverse' : ''}`;
    const wi = this.t[`rnn.weight_ih${sfx}`], wh = this.t[`rnn.weight_hh${sfx}`], bi = this.t[`rnn.bias_ih${sfx}`], bh = this.t[`rnn.bias_hh${sfx}`];
    const H = this.model.c;
    let h = new Float32Array(H);
    const out: Float32Array[] = new Array(xs.length);
    const gi = new Float32Array(3 * H), gh = new Float32Array(3 * H);
    for (let n = 0; n < xs.length; n++) {
      const i = reverse ? xs.length - 1 - n : n;
      affine(wi, bi, xs[i], gi);
      affine(wh, bh, h, gh);
      const next = new Float32Array(H);
      for (let k = 0; k < H; k++) {
        const r = sigmoid(gi[k] + gh[k]);
        const z = sigmoid(gi[H + k] + gh[H + k]);
        const c = Math.tanh(gi[2 * H + k] + r * gh[2 * H + k]);
        next[k] = (1 - z) * c + z * h[k];
      }
      h = next;
      out[i] = h;
    }
    return out;
  }

  /** How the speaker (by name, or its index) says the sounds of a sentence. */
  say(heard: Heard[], speaker: string | number = 0): Said[] {
    if (!heard.length) return [];
    const m = this.model;
    const sp = typeof speaker === 'number' ? speaker : Math.max(0, m.speakers.indexOf(speaker));
    const E = this.t['emb.weight'];
    // a sound never heard in learning is read as the unknown one (1)
    let xs = heard.map((h, j) => {
      const id = m.vocab[h.phone.ipa] ?? 1;
      const x = new Float32Array(m.emb + m.nreal);
      x.set(E.w.subarray(id * m.emb, (id + 1) * m.emb));
      x.set(this.real(heard, j, sp), m.emb);
      return affine(this.t['inp.weight'], this.t['inp.bias'], x).map(gelu);
    });
    for (let layer = 0; layer < 2; layer++) {
      const f = this.gru(xs, layer, false), b = this.gru(xs, layer, true);
      xs = f.map((a, i) => { const x = new Float32Array(2 * m.c); x.set(a); x.set(b[i], m.c); return x; });
    }
    return xs.map((x) => {
      const hid = affine(this.t['out.0.weight'], this.t['out.0.bias'], x).map(gelu);
      const y = Array.from(affine(this.t['out.2.weight'], this.t['out.2.bias'], hid), (v, k) => v * m.sd[k] + m.mu[k]);
      return {
        dur: 0.08 * Math.exp(y[0]),
        pause: Math.max(0, 0.05 * Math.expm1(y[1])),
        st: [12 * y[2], 12 * y[3], 12 * y[4]],
        swell: [y[5], y[6], y[7]],
      };
    });
  }
}
