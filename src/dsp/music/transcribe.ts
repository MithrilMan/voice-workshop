/**
 * The melody of a recording (a voice that sings, hums or whistles a tune)
 * as notes: its pitch followed every 10 ms (YIN, de Cheveigné & Kawahara
 * 2002, on the sound brought down to about 16 kHz), cut into notes where
 * the pitch moves to another step and holds it, or where the voice stops
 * or starts again on the same step (a new syllable), each note the median
 * of its steady part. The singer's own tuning (how far all their notes sit
 * from the piano's) is found and taken out before the notes are named,
 * and the times are put on a grid of the tempo (given, or found from the
 * spacing of the notes). A small version of what note trackers do (pYIN
 * and Tony: Mauch et al. 2014, 2015); a fast melisma or a wide vibrato can
 * come out as more notes or fewer.
 *
 * Also the pitch itself, frame by frame, to be sung as it is (its slides,
 * its vibrato) in place of the notes' steps.
 */
import { yin } from '../analysis/pitch';
import { Note, noteName } from './notes';

export interface MelodyNote {
  /** start and end, s from the start of the recording */
  t0: number;
  t1: number;
  /** the pitch held, as a MIDI number with its cents (the singer's tuning not taken out) */
  pitch: number;
  /** the step it is named (the singer's tuning taken out) */
  midi: number;
}

export interface Melody {
  /** the notes found, in time */
  found: MelodyNote[];
  /** the same on the grid, with rests, as notes to sing (beats at `tempo`) */
  notes: Note[];
  /** the notes as text (parseNotes reads it back) */
  text: string;
  /** the notes at their own times, not on the grid (beats at `tempo`), to be sung with `contour` */
  exact: Note[];
  /** beats per minute (given, or found) */
  tempo: number;
  /** how far the singer's notes sit from the piano's, cents (-50 .. 50) */
  tuning: number;
  /** the pitch every 10 ms, Hz (0 where there is no voice), from the first note on */
  contour: { t: number; f0: number }[];
  /** where the first note starts in the recording, s */
  start: number;
}

export interface MelodyOptions {
  /** beats per minute; by default found from the notes */
  tempo?: number;
  /** the grid, beats (0.25: sixteenth notes) */
  grid?: number;
  /** lowest and highest pitch looked for, Hz (60, 2000) */
  fmin?: number;
  fmax?: number;
  /** the shortest note, s (0.07) */
  shortest?: number;
}

const HOP = 0.01;

/** the sound brought down to about 16 kHz (a windowed-sinc low-pass, then every k-th sample) */
function decimate(x: Float32Array, fs: number): { y: Float32Array; fs: number } {
  const k = Math.max(1, Math.round(fs / 16000));
  if (k === 1) return { y: x, fs };
  const taps = 8 * k + 1, h = new Float32Array(taps), c = 0.45 / k;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const m = i - (taps - 1) / 2, w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = (m === 0 ? 2 * c : Math.sin(2 * Math.PI * c * m) / (Math.PI * m)) * w;
    sum += h[i];
  }
  const n = Math.floor(x.length / k), y = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    let v = 0;
    const at = j * k - (taps - 1) / 2;
    for (let i = 0; i < taps; i++) { const s = at + i; if (s >= 0 && s < x.length) v += x[s] * h[i]; }
    y[j] = v / sum;
  }
  return { y, fs: fs / k };
}

const median = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[b.length >> 1] : NaN; };

/** pitch (Hz, 0 unvoiced) and level (dB) every 10 ms */
export function pitchTrack(samples: Float32Array, fs0: number, fmin = 60, fmax = 2000): { f0: number[]; level: number[] } {
  const { y, fs } = decimate(samples, fs0);
  const win = Math.round(Math.max(0.03, 2.2 / fmin) * fs), hop = Math.round(HOP * fs);
  const f0: number[] = [], level: number[] = [];
  for (let s = 0; s + win <= y.length; s += hop) {
    const fr = y.subarray(s, s + win);
    let e = 0;
    for (let i = 0; i < fr.length; i++) e += fr[i] * fr[i];
    level.push(10 * Math.log10(e / fr.length + 1e-12));
    const r = yin(fr, fs, fmin, Math.min(fmax, fs / 4), 0.15);
    f0.push(r.f0 > 0 && r.confidence > 0.55 ? r.f0 : 0);
  }
  // no voice in the quiet; octave slips taken back to their neighbours; short voiced runs dropped
  const top = Math.max(...level);
  for (let i = 0; i < f0.length; i++) if (level[i] < top - 35) f0[i] = 0;
  const was = f0.slice();
  for (let i = 0; i < was.length; i++) {
    if (!was[i]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - 8); j <= Math.min(was.length - 1, i + 8); j++) if (was[j]) near.push(was[j]);
    const m = median(near), v = was[i] * 2 ** Math.round(Math.log2(m / was[i]));
    f0[i] = Math.abs(Math.log2(v / m)) > 0.5 ? 0 : v;
  }
  for (let i = 0; i < f0.length;) {
    if (!f0[i]) { i++; continue; }
    let j = i;
    while (j < f0.length && f0[j]) j++;
    if (j - i < 4) f0.fill(0, i, j);
    i = j;
  }
  return { f0, level };
}

/** the notes held in a pitch track: steps the voice holds, cut where it moves or starts again */
function notesOf(f0: number[], level: number[], shortest: number): MelodyNote[] {
  const st = f0.map((f) => (f > 0 ? 69 + 12 * Math.log2(f / 440) : NaN));
  // a light median over 50 ms
  const sm = st.map((v, i) => {
    if (Number.isNaN(v)) return NaN;
    const w: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(st.length - 1, i + 2); j++) if (!Number.isNaN(st[j])) w.push(st[j]);
    return median(w);
  });
  const out: MelodyNote[] = [];
  const minFrames = Math.max(3, Math.round(shortest / HOP));
  const close = (a: number, b: number, vals: number[]) => {
    if (b - a < minFrames) return;
    // the steady part: the first fifth (the scoop into the note) and the last tenth left out
    const from = a + Math.floor(0.2 * (b - a)), to = b - Math.floor(0.1 * (b - a));
    const p = median(vals.slice(from - a, to - a).filter((v) => !Number.isNaN(v)));
    // the note starts where its vowel does: the steepest rise of the level near its start (a voiced consonant
    // before it is sung on its pitch, and quieter), when the level rises by 5 dB or more there
    let on = a, rise = 5;
    const lim = Math.min(b - minFrames, a + Math.min(20, Math.floor(0.4 * (b - a))));
    for (let i = Math.max(a + 1, 3); i <= lim; i++) {
      const r = level[i] - Math.min(level[i - 1], level[i - 2], level[i - 3]);
      if (r > rise) { rise = r; on = i; }
    }
    out.push({ t0: on * HOP, t1: b * HOP, pitch: p, midi: Math.round(p) });
  };
  let a = -1, off = 0, vals: number[] = [];
  for (let i = 0; i <= sm.length; i++) {
    const v = i < sm.length ? sm[i] : NaN;
    if (Number.isNaN(v)) { if (a >= 0) close(a, i, vals); a = -1; vals = []; continue; }
    // a new syllable on the same step: the level dips 6 dB or more and comes back
    const dip = i > 3 && level[i] - Math.min(level[i - 1], level[i - 2], level[i - 3]) > 6 && i - a > minFrames;
    if (a < 0) { a = i; off = 0; vals = [v]; continue; }
    // away from the note as held so far (its median: a vibrato swings about it and stays)
    const held = median(vals.slice(Math.min(vals.length - 1, Math.floor(0.2 * vals.length))));
    if (Math.abs(v - held) > 0.6) off++; else off = 0;
    // a new step: held for 40 ms away from where the note was
    if (off >= 4 || dip) {
      const cut = dip ? i : i - off + 1;
      close(a, cut, vals.slice(0, cut - a));
      a = cut; off = 0; vals = sm.slice(cut, i + 1);
      continue;
    }
    vals.push(v);
  }
  return out;
}

/** the singer's tuning: the circular mean of how far each note sits from its step, weighted by length (cents) */
function tuningOf(notes: MelodyNote[]): number {
  let c = 0, s = 0;
  for (const n of notes) {
    const w = n.t1 - n.t0, a = 2 * Math.PI * (n.pitch - Math.round(n.pitch));
    c += w * Math.cos(a); s += w * Math.sin(a);
  }
  return notes.length ? (100 * Math.atan2(s, c)) / (2 * Math.PI) : 0;
}

/**
 * Notes that are not notes taken out: a short one on the way from a note to
 * the next (the pitch gliding through a step between them, scooping into the
 * next or falling off the last) goes to the nearer of the two in time.
 */
function tidy(notes: MelodyNote[]): MelodyNote[] {
  const out = notes.map((n) => ({ ...n }));
  for (let k = 0; k < out.length; k++) {
    const n = out[k], next = out[k + 1], prev = out[k - 1];
    if (n.t1 - n.t0 > 0.13) continue;
    const gapNext = next ? next.t0 - n.t1 : Infinity, gapPrev = prev ? n.t0 - prev.t1 : Infinity;
    if (Math.min(gapNext, gapPrev) > 0.07) continue;
    const between = prev && next && (n.pitch - prev.pitch) * (next.pitch - n.pitch) > 0;
    const nearNext = next && Math.abs(next.pitch - n.pitch) < 2.5 && gapNext <= 0.07;
    const nearPrev = prev && Math.abs(prev.pitch - n.pitch) < 2.5 && gapPrev <= 0.07;
    if (!between && !nearNext && !nearPrev) continue;
    const toNext = next && (between ? gapNext <= gapPrev : nearNext && (!nearPrev || gapNext <= gapPrev));
    if (toNext) next!.t0 = n.t0; else prev!.t1 = n.t1;
    out.splice(k, 1);
    k = Math.max(-1, k - 2);
  }
  return out;
}

/**
 * A tempo from the spacing of the notes: the commonest interval between
 * starts, taken as a beat or half a beat (70-150 bpm), then the tempo near
 * it on whose grid of eighth notes the starts fall closest.
 */
function tempoOf(notes: MelodyNote[]): number {
  if (notes.length < 3) return 100;
  const ioi = notes.slice(1).map((n, i) => n.t0 - notes[i].t0).filter((d) => d > 0.08);
  // a histogram of the intervals (20 ms bins, each spreading to its neighbours) and its peak
  const bins = new Map<number, number>();
  for (const d of ioi) for (const k of [-1, 0, 1]) { const b = Math.round(d / 0.02) + k; bins.set(b, (bins.get(b) ?? 0) + (k === 0 ? 2 : 1)); }
  let best = 0, at = 0;
  for (const [b, v] of bins) if (v > best || (v === best && b < at)) { best = v; at = b; }
  let bpm = 60 / (at * 0.02);
  while (bpm < 70) bpm *= 2;
  while (bpm > 150) bpm /= 2;
  const t0 = notes[0].t0;
  const miss = (T: number) => notes.reduce((a, n) => { const b = ((n.t0 - t0) * T) / 60 / 0.5; return a + (b - Math.round(b)) ** 2; }, 0);
  let tempo = bpm, least = Infinity;
  for (let T = bpm * 0.88; T <= bpm * 1.12; T += 0.25) { const m = miss(T); if (m < least - 1e-9) { least = m; tempo = T; } }
  return Math.round(tempo);
}

/** Finds the melody of a recording (see above). */
export function melodyOf(samples: Float32Array, fs: number, o: MelodyOptions = {}): Melody {
  const { f0, level } = pitchTrack(samples, fs, o.fmin ?? 60, o.fmax ?? 2000);
  const raw = tidy(notesOf(f0, level, o.shortest ?? 0.07));
  if (!raw.length) throw new Error('no melody found: sing, hum or whistle a little louder and steadier');
  const tuning = tuningOf(raw);
  const found = raw.map((n) => ({ ...n, midi: Math.round(n.pitch - tuning / 100) }));
  const tempo = Math.round(o.tempo ?? tempoOf(found));
  const spb = 60 / tempo, grid = o.grid ?? 0.25;
  const start = found[0].t0;
  // starts on the grid; each note at least one step long, and up to the next note's start when only a consonant
  // (a short silence) lies between them, else its own length on the grid (without the fall of the voice at its end)
  const q = (t: number) => Math.round((t - start) / spb / grid) * grid;
  const notes: Note[] = [];
  let at = 0;
  found.forEach((n, i) => {
    const b0 = Math.max(at, q(n.t0));
    if (b0 > at + 1e-9) notes.push({ midi: null, beats: +(b0 - at).toFixed(4) });
    const after = found[i + 1];
    const next = after ? q(after.t0) : Infinity;
    const legato = after && after.t0 - n.t1 < Math.max(0.16, 0.6 * grid * spb);
    const b1 = legato ? next : Math.min(next, b0 + Math.max(grid, Math.round((n.t1 - n.t0 - 0.06) / spb / grid) * grid));
    notes.push({ midi: n.midi, beats: +(Math.max(grid, b1 - b0)).toFixed(4) });
    at = b0 + Math.max(grid, b1 - b0);
  });
  const text = notes.map((n) => `${n.midi === null ? 'r' : noteName(n.midi)}${n.beats === 1 ? '' : `:${+n.beats.toFixed(3)}`}`).join(' ');
  const contour: { t: number; f0: number }[] = [];
  for (let k = Math.round(start / HOP); k < f0.length; k++) contour.push({ t: +(k * HOP - start).toFixed(3), f0: f0[k] });
  // at their own times: each note up to the next one's start (a gap of a tenth of a second or more is a rest)
  const exact: Note[] = [];
  found.forEach((n, i) => {
    const next = found[i + 1];
    const end = next && next.t0 - n.t1 < 0.1 ? next.t0 : n.t1;
    exact.push({ midi: n.midi, beats: +(((end - n.t0) * tempo) / 60).toFixed(4) });
    if (next && next.t0 > end + 1e-6) exact.push({ midi: null, beats: +(((next.t0 - end) * tempo) / 60).toFixed(4) });
  });
  return { found, notes, text, exact, tempo, tuning: Math.round(tuning), contour, start };
}
