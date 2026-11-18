/**
 * Songs on the page: the parts are made in workers, a few at a time, then
 * put together over a room, played through the voice, and saved as WAV.
 */
import { MixStream } from '../../dsp/music/mix';
import { arrange, downmix, type Performance, type Placed, type Stereo, type MixOptions } from '../../dsp/music/mix';
import { encodeWavStereo } from '../../dsp/util/wav';
import type { MusicRequest, MusicReply, LoopRequest, LoopReply, StreamRequest, StreamReply } from './music.worker';
import type { BeatTrack, Motion } from '../../dsp/music/beat';
import type { BeatLoopOptions } from '../../library';
import type { Melody } from '../../dsp/music/transcribe';
import type { Imitation } from '../../dsp/music/imitate';
import type { VoiceDesign } from '../../dsp/voice/design';
import { voice } from './voice';

export type { MusicRequest };

export interface PartOutcome { performance: Performance | null; warnings: string[]; error?: string; notes?: MusicReply['notes']; syllables?: MusicReply['syllables'] }

/** how many parts are made at once */
const POOL = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));

/**
 * Makes the parts, each in a worker (several at once); `onPart` hears of each
 * one as it is ready. stop() ends them all; the parts not made are null.
 */
export function makeParts(reqs: readonly MusicRequest[], onPart?: (i: number, o: PartOutcome) => void): { done: Promise<PartOutcome[]>; stop: () => void } {
  const out: PartOutcome[] = reqs.map(() => ({ performance: null, warnings: [] }));
  const live = new Set<Worker>();
  let next = 0, left = reqs.length, stopped = false;
  let finish: (o: PartOutcome[]) => void = () => {};
  const done = new Promise<PartOutcome[]>((res) => { finish = res; });
  const end = (i: number, o: PartOutcome) => {
    out[i] = o;
    onPart?.(i, o);
    if (--left === 0) finish(out);
  };
  const start = () => {
    if (stopped || next >= reqs.length) return;
    const i = next++;
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    live.add(w);
    const close = () => { w.terminate(); live.delete(w); start(); };
    w.onmessage = (e: MessageEvent<MusicReply>) => {
      const m = e.data;
      close();
      if (m.ok && m.samples) end(i, { performance: { samples: m.samples, fs: m.fs!, beat0: m.beat0!, duration: m.samples.length / m.fs! }, warnings: m.warnings ?? [], notes: m.notes, syllables: m.syllables });
      else end(i, { performance: null, warnings: [], error: m.reason ?? 'failed' });
    };
    w.onerror = (e) => { close(); end(i, { performance: null, warnings: [], error: e.message || 'failed' }); };
    w.postMessage(reqs[i]);
  };
  if (!reqs.length) finish(out);
  for (let k = 0; k < POOL; k++) start();
  return {
    done,
    stop: () => {
      stopped = true;
      for (const w of live) w.terminate();
      live.clear();
      finish(out);
    },
  };
}

/** the rate the parts are made at: the voice's own, so that they play as they are */
export const musicRate = (): number => voice.sampleRate;

export function arrangeParts(parts: readonly Placed[], opts: MixOptions & { tempo?: number }): Stereo {
  return arrange(parts, opts);
}

/** Plays a mix (both sides as one: the voice has one channel). */
export function playMix(s: Stereo, label: string): Promise<unknown> {
  return voice.playSamples(downmix(s), label);
}

export function stopPlaying(): void { voice.stop(); }

/** wakes the sound on a click, before the parts are made (a browser lets it start only on a gesture) */
export function wakeSound(): void { void voice.ensureAudio(); }

/** The melody of a recording (see melodyOf), found in a worker. */
export function findMelody(r: { samples: Float32Array; fs: number }): Promise<Melody> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MusicReply>) => { w.terminate(); if (e.data.ok && e.data.melody) res(e.data.melody); else rej(new Error(e.data.reason ?? 'failed')); };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'failed')); };
    w.postMessage({ kind: 'melody', samples: r.samples, fs: r.fs });
  });
}

/**
 * The sound of a voice's mouth nearest a recording (see imitate), found in
 * a worker; `onProgress` hears how far the search is. stop() ends it.
 */
export function imitateSound(voice: VoiceDesign, r: { samples: Float32Array; fs: number }, onProgress: (done: number, total: number, best: string) => void): { done: Promise<Imitation>; stop: () => void } {
  const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
  let fail: (e: Error) => void = () => {};
  const done = new Promise<Imitation>((res, rej) => {
    fail = rej;
    w.onmessage = (e: MessageEvent<MusicReply>) => {
      const m = e.data;
      if (m.ok && m.progress) { onProgress(m.progress.done, m.progress.total, m.progress.best); return; }
      w.terminate();
      if (m.ok && m.imitation) res(m.imitation); else rej(new Error(m.reason ?? 'failed'));
    };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'failed')); };
  });
  w.postMessage({ kind: 'imitate', voice, samples: r.samples, fs: r.fs });
  return { done, stop: () => { w.terminate(); fail(new Error('stopped')); } };
}

// ------------------------------------------------------------- parts heard as they are made

/** A part to hear: one to make (`req`) or one made before (`made`), where it comes in and how it stands. */
export interface LivePart { req?: MusicRequest; made?: Performance; startBeat?: number; gain?: number; pan?: number }

/** What a part came to: as makeParts says it, and what it says before it is made (its notes and syllables). */
export interface LiveRun {
  /** every part as it ended, and the whole mix (brought to its peak, as arrange makes it) once all are made */
  done: Promise<{ parts: PartOutcome[]; mix: Stereo | null }>;
  stop: () => void;
}

/** how much is made ahead before the sound starts, s */
const AHEAD = 0.6;

/**
 * Parts made and heard at once: each made in its own worker, in pieces (a
 * song sung piece by piece, see singing), mixed as they come over the room
 * (MixStream: the mix arrange makes, both ears as one) and played as soon
 * as enough is made ahead that the rest will come in time. The level is
 * set from what is made before the start, with room to spare (a later
 * peak meets the limiter); the mix kept for Again and the WAV is the one
 * arrange makes, brought to its peak. `onInfo` hears each part's notes and
 * syllables before it is made, `onPart` each part made, `onStart` the
 * moment the sound starts.
 */
export function performLive(parts: readonly LivePart[], o: { tempo: number; room: number; size?: number; label: string; onInfo?: (i: number, info: Extract<StreamReply, { type: 'info' }>) => void; onPart?: (i: number, out: PartOutcome) => void; onStart?: () => void }): LiveRun {
  const fs = musicRate(), spb = 60 / o.tempo, pre = 0.5;
  const mixer = new MixStream(parts.map((p) => ({ gain: p.gain, pan: p.pan })), fs, { room: o.room, size: o.size });
  const outs: PartOutcome[] = parts.map(() => ({ performance: null, warnings: [] }));
  const ends = parts.map(() => NaN);
  const workers = new Set<Worker>();
  // of each part made in a worker: when it was asked for, where it starts in the mix, how much of it is made, whether it is over
  const asked = parts.map(() => 0), s0 = parts.map(() => 0), got = parts.map(() => 0), over = parts.map(() => false);
  // and when its first piece came, and how long that was
  const firstAt = parts.map(() => 0), firstGot = parts.map(() => 0);
  let started = false, stopped = false, gain = 1;
  const waiting: Float32Array[] = [];
  let finish: (r: { parts: PartOutcome[]; mix: Stereo | null }) => void = () => {};
  const done = new Promise<{ parts: PartOutcome[]; mix: Stereo | null }>((res) => { finish = res; });
  const total = () => Math.max(...ends) + 1.2;
  const buffered = () => waiting.reduce((s, x) => s + x.length, 0) / fs;
  const close = () => {
    if (stopped) return;
    stopped = true;
    for (const w of workers) w.terminate();
    workers.clear();
    const placed: Placed[] = [];
    outs.forEach((out, i) => { if (out.performance) placed.push({ performance: out.performance, startBeat: parts[i].startBeat, gain: parts[i].gain, pan: parts[i].pan }); });
    finish({ parts: outs, mix: placed.length ? arrangeParts(placed, { tempo: o.tempo, room: o.room, size: o.size }) : null });
  };
  const pump = () => {
    if (stopped) return;
    const piece = mixer.take(), last = mixer.done;
    if (!started) {
      if (piece.length) waiting.push(piece);
      // all parts placed, and each part still coming, at the pace it has kept since its first piece, made to its end before the sound gets there;
      // a part not yet begun as if it began after as long again as it has waited, at the pace of the slowest
      const known = ends.every((x) => !Number.isNaN(x));
      if (!last && (!known || buffered() < AHEAD)) return;
      const now = performance.now();
      const pace = parts.map((_, i) => { const t = (now - firstAt[i]) / 1000; return firstAt[i] && t > 0.3 ? (got[i] - firstGot[i]) / fs / t : 0; });
      const slowest = Math.min(...pace.filter((p, i) => !over[i] && p > 0));
      let late = 0;
      parts.forEach((_, i) => {
        if (over[i]) return;
        const left = Math.max(0, ends[i] - s0[i] - got[i] / fs);
        const p = pace[i] || (firstAt[i] ? 0 : slowest), wait = pace[i] ? 0 : (now - asked[i]) / 1000;
        late = Math.max(late, p > 0 && Number.isFinite(p) ? wait + 1.1 * (left / p) + 0.4 - ends[i] : Infinity);
      });
      if (!last && late > 0) return;
      // and half a second of sound past the silence before it, to set the level from
      let peak = 0, loud = -1, k0 = 0;
      for (const x of waiting) for (const v of x) peak = Math.max(peak, Math.abs(v));
      for (const x of waiting) { const j = loud < 0 ? x.findIndex((v) => Math.abs(v) > 0.1 * peak) : -1; if (loud < 0 && j >= 0) loud = k0 + j; k0 += x.length; }
      const heard = loud < 0 ? 0 : buffered() - loud / fs;
      if (!last && heard < 0.5) return;
      // the level, from what is made so far, with room to spare
      gain = peak > 0 ? 10 ** (-1 / 20) / (1.4 * peak) : 1;
      const first = new Float32Array(waiting.reduce((s, x) => s + x.length, 0));
      let k = 0;
      for (const x of waiting) { first.set(x, k); k += x.length; }
      for (let i = 0; i < first.length; i++) first[i] *= gain;
      waiting.length = 0;
      started = true;
      o.onStart?.();
      void voice.playStream(first, o.label, known ? total() : first.length / fs).then((r) => { if (r === 'stopped' && !mixer.done) close(); });
      if (last) { voice.appendStream(new Float32Array(0), true); close(); }
      return;
    }
    if (!piece.length && !last) return;
    for (let i = 0; i < piece.length; i++) piece[i] *= gain;
    if (!voice.appendStream(piece, last) && !last) { close(); return; }
    if (last) close();
  };
  parts.forEach((p, i) => {
    const at = (beat0: number) => pre + (p.startBeat ?? 0) * spb - beat0;
    if (p.made) {
      mixer.place(i, at(p.made.beat0)); mixer.feed(i, p.made.samples); mixer.end(i);
      ends[i] = at(p.made.beat0) + p.made.duration;
      over[i] = true;
      outs[i] = { performance: p.made, warnings: [] };
      return;
    }
    if (!p.req) { mixer.end(i); ends[i] = 0; over[i] = true; return; }
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    workers.add(w);
    const pieces: Float32Array[] = [];
    let info: Extract<StreamReply, { type: 'info' }> | null = null;
    const ended = (out: PartOutcome) => {
      w.terminate(); workers.delete(w);
      over[i] = true;
      mixer.end(i);
      if (Number.isNaN(ends[i])) ends[i] = 0;
      outs[i] = out;
      o.onPart?.(i, out);
      pump();
    };
    w.onmessage = (e: MessageEvent<StreamReply>) => {
      const m = e.data;
      if (m.type === 'info') {
        info = m;
        s0[i] = at(m.beat0);
        mixer.place(i, s0[i]);
        ends[i] = s0[i] + m.duration;
        o.onInfo?.(i, m);
      } else if (m.type === 'piece') {
        if (!firstAt[i]) { firstAt[i] = performance.now(); firstGot[i] = m.samples.length; }
        got[i] += m.samples.length;
        pieces.push(m.samples);
        mixer.feed(i, m.samples);
      } else if (m.type === 'end') {
        const n = pieces.reduce((s, x) => s + x.length, 0), samples = new Float32Array(n);
        let k = 0;
        for (const x of pieces) { samples.set(x, k); k += x.length; }
        ended({ performance: { samples, fs: info?.fs ?? fs, beat0: info?.beat0 ?? 0, duration: n / fs }, warnings: info?.warnings ?? [], notes: info?.notes, syllables: info?.syllables });
        return;
      } else {
        ended({ performance: null, warnings: [], error: m.reason });
        return;
      }
      pump();
    };
    w.onerror = (e) => ended({ performance: null, warnings: [], error: e.message || 'failed' });
    asked[i] = performance.now();
    w.postMessage({ kind: 'stream', part: p.req } satisfies StreamRequest);
  });
  pump();
  return { done, stop: () => { if (started) voice.stop(); close(); } };
}

// ------------------------------------------------------------- a beat played live

/** A beat made as a loop: one round of its samples, how many times round the pattern it holds, the steps of the pattern, the posture of each of its mouths through the round and the mouth of each track. */
export interface MadeLoop { samples: Float32Array; passes: number; steps: number; mouths: Motion[]; trackMouths: number[] }

/** the worker that makes loops lives on, keeping the sounds already said: a changed beat is made again at once */
let loopWorker: Worker | null = null;
let loopId = 0;
const loopWaiting = new Map<number, (r: LoopReply) => void>();

/** A beat (as in the beatbox bench) made as a loop for playing live (see beatLoop), in the worker that keeps its sounds. */
export function makeLoop(v: VoiceDesign, tracks: BeatTrack[], opts: BeatLoopOptions): Promise<MadeLoop> {
  if (!loopWorker) {
    const w = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<LoopReply>) => { const f = loopWaiting.get(e.data.id); loopWaiting.delete(e.data.id); f?.(e.data); };
    w.onerror = (e) => {
      for (const f of loopWaiting.values()) f({ id: 0, ok: false, reason: e.message || 'failed' });
      loopWaiting.clear();
      w.terminate();
      if (loopWorker === w) loopWorker = null;
    };
    loopWorker = w;
  }
  const id = ++loopId, w = loopWorker;
  return new Promise((res, rej) => {
    loopWaiting.set(id, (r) => (r.ok && r.samples ? res({ samples: r.samples, passes: r.passes ?? 1, steps: r.steps ?? 16, mouths: r.mouths ?? [], trackMouths: r.trackMouths ?? [] }) : rej(new Error(r.reason ?? 'failed'))));
    w.postMessage({ kind: 'loop', id, voice: v, tracks, opts } satisfies LoopRequest);
  });
}

/** Plays a loop round and round until stopped (see VoiceController.playLoop). */
export const playLoop = (samples: Float32Array, label: string, from = 0, mouths: Motion[] = []): Promise<unknown> => voice.playLoop(samples, label, from, mouths);
/** New samples for the loop playing, heard from the same point of it; false if none plays. */
export const swapLoop = (samples: Float32Array, mouths?: Motion[]): boolean => voice.swapLoop(samples, mouths);
/** Where the loop playing is, s into one round, as heard now. */
export const loopPlace = (): { at: number; length: number } | null => voice.loopPlace();

export { recordMicrophone, decodeRecording, playRecording, type Recording } from './fitter';

/** Saves a mix as a stereo WAV file. */
export function saveWav(s: Stereo, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([encodeWavStereo(s.left, s.right, s.fs).buffer as ArrayBuffer], { type: 'audio/wav' }));
  a.download = `${name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'song'}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
