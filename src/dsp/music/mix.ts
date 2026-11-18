/**
 * Several recordings in one: each placed in time, at its own level and
 * place between the two ears, over a room (a small reverberator of eight
 * comb and four all-pass filters a side, after Schroeder 1962 and Moorer
 * 1979, with the tunings of the public-domain Freeverb).
 */
import type { Motion } from './beat';

export interface Track {
  samples: ArrayLike<number>;
  fs: number;
  /** where it starts, s (0) */
  at?: number;
  /** level, dB (0) */
  gain?: number;
  /** -1 left .. 0 centre .. 1 right (0) */
  pan?: number;
}

export interface MixOptions {
  /** how much of the room is heard, 0 none .. 1 a lot (0.18) */
  room?: number;
  /** how large the room is, 0 small .. 1 a hall (0.6) */
  size?: number;
  /** the loudest sample brought to this level, dBFS (-1; null: as it comes) */
  peak?: number | null;
  /** silence kept after the last sound, s (the room's tail: 1.2) */
  tail?: number;
}

export interface Stereo { left: Float32Array; right: Float32Array; fs: number; duration: number }

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const SPREAD = 23;

/** a stereo reverberator (Freeverb's structure and tunings, at 44.1 kHz, scaled to the rate) */
function reverberate(inL: Float32Array, inR: Float32Array, fs: number, size: number): [Float32Array, Float32Array] {
  const k = fs / 44100, n = inL.length;
  const feedback = 0.7 + 0.28 * Math.max(0, Math.min(1, size)), damp = 0.25;
  const side = (input: Float32Array, spread: number) => {
    const out = new Float32Array(n);
    for (const len0 of COMBS) {
      const len = Math.max(1, Math.round((len0 + spread) * k)), buf = new Float32Array(len);
      let p = 0, store = 0;
      for (let i = 0; i < n; i++) {
        const y = buf[p];
        store = y * (1 - damp) + store * damp;
        buf[p] = input[i] * 0.015 + store * feedback;
        out[i] += y;
        if (++p === len) p = 0;
      }
    }
    for (const len0 of ALLPASS) {
      const len = Math.max(1, Math.round((len0 + spread) * k)), buf = new Float32Array(len);
      let p = 0;
      for (let i = 0; i < n; i++) {
        const b = buf[p], x = out[i];
        out[i] = b - x;
        buf[p] = x + b * 0.5;
        if (++p === len) p = 0;
      }
    }
    return out;
  };
  return [side(inL, 0), side(inR, SPREAD)];
}

/** The reverberator of `reverberate`, sample by sample: what it gives in a row is what it gives on the whole. */
class Room {
  private readonly sides: { combs: { buf: Float32Array; p: number; store: number }[]; aps: { buf: Float32Array; p: number }[] }[];
  private readonly feedback: number;
  constructor(fs: number, size: number) {
    const k = fs / 44100;
    this.feedback = 0.7 + 0.28 * Math.max(0, Math.min(1, size));
    this.sides = [0, SPREAD].map((spread) => ({
      combs: COMBS.map((len0) => ({ buf: new Float32Array(Math.max(1, Math.round((len0 + spread) * k))), p: 0, store: 0 })),
      aps: ALLPASS.map((len0) => ({ buf: new Float32Array(Math.max(1, Math.round((len0 + spread) * k))), p: 0 })),
    }));
  }
  /** one sample in on each side, the room's on each side out */
  step(l: number, r: number, out: [number, number]): void {
    const damp = 0.25;
    for (let s = 0; s < 2; s++) {
      const side = this.sides[s], input = s === 0 ? l : r;
      let o = 0;
      for (const c of side.combs) {
        const y = c.buf[c.p];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.p] = input * 0.015 + c.store * this.feedback;
        o += y;
        if (++c.p === c.buf.length) c.p = 0;
      }
      for (const a of side.aps) {
        const b = a.buf[a.p], x = o;
        o = b - x;
        a.buf[a.p] = x + b * 0.5;
        if (++a.p === a.buf.length) a.p = 0;
      }
      out[s] = o;
    }
  }
}

/**
 * Tracks mixed as they come, in pieces, over a room, both ears as one:
 * the samples `mixTracks` and `downmix` give, but for the level, set at the
 * start (`gain`, linear) instead of brought to a peak at the end. A track's
 * place (`at`, s) may come after it starts to come; the mix goes only as
 * far as every track still coming has come (a track placed later than that
 * does not hold it), and ends with the room's tail.
 */
export class MixStream {
  private readonly parts: { at: number | null; gl: number; gr: number; buf: Float32Array; got: number; ended: boolean }[];
  private pos = 0;
  private readonly room: Room | null;
  private readonly wet: number;
  private readonly tail: number;
  private readonly gain: number;
  private readonly two: [number, number] = [0, 0];

  constructor(tracks: readonly { at?: number; gain?: number; pan?: number }[], readonly fs: number, o: Omit<MixOptions, 'peak'> & { gain?: number } = {}) {
    this.parts = tracks.map((t) => {
      const g = 10 ** ((t.gain ?? 0) / 20), pan = Math.max(-1, Math.min(1, t.pan ?? 0));
      const a = ((pan + 1) * Math.PI) / 4;
      return { at: t.at ?? null, gl: g * Math.cos(a) * Math.SQRT2, gr: g * Math.sin(a) * Math.SQRT2, buf: new Float32Array(fs), got: 0, ended: false };
    });
    this.wet = Math.max(0, Math.min(1, o.room ?? 0.18));
    this.room = this.wet > 0 ? new Room(fs, o.size ?? 0.6) : null;
    this.tail = Math.round(Math.max(0, o.tail ?? 1.2) * fs);
    this.gain = o.gain ?? 1;
  }

  /** where track k starts, s */
  place(k: number, at: number): void { this.parts[k].at = at; }

  /** the next samples of track k */
  feed(k: number, samples: Float32Array): void {
    const p = this.parts[k];
    if (p.got + samples.length > p.buf.length) {
      const b = new Float32Array(Math.max(2 * p.buf.length, p.got + samples.length));
      b.set(p.buf.subarray(0, p.got));
      p.buf = b;
    }
    p.buf.set(samples, p.got);
    p.got += samples.length;
  }

  /** track k has come whole (a track that never comes is ended too) */
  end(k: number): void { this.parts[k].ended = true; if (this.parts[k].at === null) this.parts[k].at = 0; }

  /** how far the mix can go now, samples (all of it, with the room's tail, once every track has ended) */
  private ready(): number {
    let r = Infinity, last = 0;
    for (const p of this.parts) {
      const s0 = p.at === null ? 0 : Math.max(0, Math.round(p.at * this.fs));
      if (p.ended) last = Math.max(last, (p.at === null ? 0 : Math.round(p.at * this.fs)) + p.got);
      else r = Math.min(r, p.at === null ? this.pos : s0 + p.got);
    }
    return r === Infinity ? last + this.tail : r;
  }

  /** whether all of it is out */
  get done(): boolean { return this.parts.every((p) => p.ended) && this.pos >= this.ready(); }

  /** samples mixed so far, s */
  get time(): number { return this.pos / this.fs; }

  /** the samples that can be mixed now (none, while a track is behind) */
  take(): Float32Array {
    const to = this.ready(), n = Math.max(0, to - this.pos), out = new Float32Array(n);
    const dry = 1 - 0.5 * this.wet, w = this.wet * 3, two = this.two;
    for (let i = 0; i < n; i++) {
      const at = this.pos + i;
      let l = 0, r = 0;
      for (const p of this.parts) {
        if (p.at === null) continue;
        const j = at - Math.max(0, Math.round(p.at * this.fs));
        if (j >= 0 && j < p.got) { const v = p.buf[j]; l += v * p.gl; r += v * p.gr; }
      }
      if (this.room) {
        this.room.step(l, r, two);
        l = l * dry + two[0] * w; r = r * dry + two[1] * w;
      }
      out[i] = 0.5 * (l + r) * this.gain;
    }
    this.pos = to > this.pos ? to : this.pos;
    return out;
  }
}

/** Mixes tracks into one stereo recording, over a room. All tracks must share a sample rate. */
export function mixTracks(tracks: readonly Track[], o: MixOptions = {}): Stereo {
  if (!tracks.length) throw new Error('nothing to mix');
  const fs = tracks[0].fs;
  if (tracks.some((t) => t.fs !== fs)) throw new Error('tracks at different sample rates');
  const tail = Math.round(Math.max(0, o.tail ?? 1.2) * fs);
  const n = tracks.reduce((a, t) => Math.max(a, Math.round((t.at ?? 0) * fs) + t.samples.length), 0) + tail;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const t of tracks) {
    const g = 10 ** ((t.gain ?? 0) / 20), pan = Math.max(-1, Math.min(1, t.pan ?? 0));
    // equal-power panning
    const a = ((pan + 1) * Math.PI) / 4, gl = g * Math.cos(a) * Math.SQRT2, gr = g * Math.sin(a) * Math.SQRT2;
    const s0 = Math.max(0, Math.round((t.at ?? 0) * fs));
    for (let i = 0; i < t.samples.length && s0 + i < n; i++) { const v = t.samples[i]; L[s0 + i] += v * gl; R[s0 + i] += v * gr; }
  }
  const wet = Math.max(0, Math.min(1, o.room ?? 0.18));
  if (wet > 0) {
    const [rl, rr] = reverberate(L, R, fs, o.size ?? 0.6);
    const w = wet * 3, dry = 1 - 0.5 * wet;
    for (let i = 0; i < n; i++) { L[i] = L[i] * dry + rl[i] * w; R[i] = R[i] * dry + rr[i] * w; }
  }
  const peak = o.peak === undefined ? -1 : o.peak;
  if (peak !== null) {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(L[i]), Math.abs(R[i]));
    if (mx > 0) { const g = 10 ** (peak / 20) / mx; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  }
  return { left: L, right: R, fs, duration: n / fs };
}

/**
 * Tracks mixed into one round of a loop, `length` s long, in the middle of
 * the two ears (mono), over a room: what rings past the end is heard at the
 * start, and the room is the one it has after going round once (its tail
 * of the last round under the first sounds), so that the samples played
 * round and round sound as the same tracks mixed one after another.
 */
export function loopMix(tracks: readonly Track[], length: number, o: MixOptions = {}): Float32Array {
  if (!tracks.length) throw new Error('nothing to mix');
  const fs = tracks[0].fs;
  if (tracks.some((t) => t.fs !== fs)) throw new Error('tracks at different sample rates');
  const n = Math.max(1, Math.round(length * fs));
  const dry = new Float32Array(n);
  for (const t of tracks) {
    const g = 10 ** ((t.gain ?? 0) / 20);
    const s0 = Math.round((t.at ?? 0) * fs);
    for (let i = 0; i < t.samples.length; i++) {
      const j = (((s0 + i) % n) + n) % n;
      dry[j] += t.samples[i] * g;
    }
  }
  let out = dry;
  const wet = Math.max(0, Math.min(1, o.room ?? 0.18));
  if (wet > 0) {
    // twice round: the second has the room as it is going round
    const two = new Float32Array(2 * n);
    two.set(dry); two.set(dry, n);
    const [rl, rr] = reverberate(two, two, fs, o.size ?? 0.6);
    const w = wet * 3, d = 1 - 0.5 * wet;
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dry[i] * d + 0.5 * (rl[n + i] + rr[n + i]) * w;
  }
  const peak = o.peak === undefined ? -1 : o.peak;
  if (peak !== null) {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
    if (mx > 0) { const g = 10 ** (peak / 20) / mx; for (let i = 0; i < n; i++) out[i] *= g; }
  }
  return out;
}

/** Something performed in time: mono samples and where its first beat falls, s. */
export interface Performance {
  samples: Float32Array;
  fs: number;
  beat0: number;
  duration: number;
  /** the mouth that made it, from its first sample (when it was kept: a song sung piece by piece) */
  motion?: Motion;
}

/** A performance in an ensemble: when it comes in (beats from the start) and where it stands. */
export interface Placed { performance: Performance; startBeat?: number; gain?: number; pan?: number }

/**
 * Performances heard together, their beats in time (all at `tempo`, each
 * coming in at its `startBeat`), over a room: a choir, a canon, a band of
 * mouths. Returns a stereo recording.
 */
export function arrange(parts: readonly Placed[], opts: MixOptions & { tempo?: number } = {}): Stereo {
  const spb = 60 / (opts.tempo ?? 100), pre = 0.5;
  return mixTracks(parts.map((p) => ({
    samples: p.performance.samples, fs: p.performance.fs, gain: p.gain, pan: p.pan,
    at: pre + (p.startBeat ?? 0) * spb - p.performance.beat0,
  })), opts);
}

/** both sides as one (for a mono player) */
export function downmix(s: Stereo): Float32Array {
  const out = new Float32Array(s.left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (s.left[i] + s.right[i]);
  return out;
}
