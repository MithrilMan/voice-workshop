/**
 * Several recordings in one: each placed in time, at its own level and
 * place between the two ears, over a room (a small reverberator of eight
 * comb and four all-pass filters a side, after Schroeder 1962 and Moorer
 * 1979, with the tunings of the public-domain Freeverb).
 */
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

/** Something performed in time: mono samples and where its first beat falls, s. */
export interface Performance {
  samples: Float32Array;
  fs: number;
  beat0: number;
  duration: number;
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
