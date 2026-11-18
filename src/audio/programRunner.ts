/**
 * The audio-thread side of the voice: one engine, fed by the parameters of
 * the hands or by one program at a time (a sentence, a melody, a clip).
 * It runs inside the AudioWorklet and, unchanged, in Node for the tests.
 *
 * Messages in:
 *   { type: 'params', params, after, program } the parameters to sound now
 *       (`params`) and once the running program is over (`after`, the
 *       hands); `program` is the id the sender believes is running, so that
 *       parameters meant for a program that has already ended fall back to
 *       `after`
 *   { type: 'program', program } starts a program, replacing the running one
 *   { type: 'stop', id }         stops that program (ignored if it is over)
 *   { type: 'swap', id, samples } new samples for that looping program,
 *       heard from the same share of their length (crossfaded)
 *   { type: 'append', id, samples, last? } more samples for that program
 *       that streams (heard after those before; it ends after the last)
 * Messages out:
 *   { type: 'telemetry', telemetry, program, at? } about 60 per second
 *       (`at`: where a looping program is in its samples, or how much of
 *       its samples a program that streams has played, s)
 *   { type: 'stream', out, flow, noise }      blocks of STREAM samples
 *   { type: 'ended', id, reason, captured? }  once per program
 */
import { VoiceEngine, Telemetry } from '../dsp/engine/engine';
import type { EngineParams, Score } from '../dsp/engine/params';

/** A performance run by the engine; while it plays the hands only reach what it leaves free. */
export interface Program {
  id: number;
  /** parameters while the program plays */
  params: EngineParams;
  /** parameters the engine returns to when the program ends on its own */
  after: EngineParams;
  /** a score (sentence or melody): the program ends with it */
  score?: Score;
  /** samples heard instead of the engine's voice, at the engine's rate (the engine runs on, silent) */
  samples?: Float32Array;
  /** glottal flow shown with the samples */
  flow?: Float32Array;
  /** the samples go round and round, until stopped */
  loop?: boolean;
  /** the sample the samples start from (0) */
  from?: number;
  /** more samples come with 'append' messages (as they are made); it ends once the last is heard */
  stream?: boolean;
  /** a hold of `params` for this long, s */
  seconds?: number;
  /** jump the articulators to the program's posture (a short fade hides the jump) */
  snap?: boolean;
  /** send back the samples heard */
  capture?: boolean;
}

export type EndReason = 'done' | 'stopped' | 'replaced';

export type RunnerIn =
  | { type: 'params'; params: EngineParams; after: EngineParams; program: number }
  | { type: 'program'; program: Program }
  | { type: 'stop'; id: number }
  | { type: 'swap'; id: number; samples: Float32Array }
  | { type: 'append'; id: number; samples: Float32Array; last?: boolean };

export type RunnerOut =
  | { type: 'telemetry'; telemetry: Telemetry; program: number; at?: number }
  | { type: 'stream'; out: Float32Array; flow: Float32Array; noise: Float32Array }
  | { type: 'ended'; id: number; reason: EndReason; captured?: Float32Array };

export const STREAM = 1024;
const TELEMETRY_BLOCKS = 6; // 6 x 128 samples = 16 ms at 48 kHz
/** fade over a jump of the posture or a switch to samples, s */
const FADE = 0.005;
const NONE = new Float32Array(0);

export class ProgramRunner {
  readonly engine: VoiceEngine;
  private prog: Program | null = null;
  /** a program waiting for the fade-out before it starts */
  private queued: Program | null = null;
  private pos = 0;
  private length = 0;
  private captured: Float32Array | null = null;
  private gain = 1;
  private gainTarget = 1;
  private readonly gainStep: number;
  private started = false;
  private blocks = 0;
  /** the samples a loop played before a swap, heard fading out from where they were */
  private old: { samples: Float32Array; pos: number; left: number } | null = null;
  private readonly fadeLength: number;
  /** what a program that streams has still to play, piece by piece (`at` in the first), how much of it it has played, and whether the last has come */
  private streams = new Map<number, { q: Float32Array[]; at: number; played: number; last: boolean }>();

  constructor(readonly fs: number, private readonly post: (m: RunnerOut, transfer?: Transferable[]) => void) {
    this.engine = new VoiceEngine(fs);
    this.gainStep = 1 / Math.max(1, FADE * fs);
    this.fadeLength = Math.max(1, Math.round(FADE * fs));
    this.newStreams();
  }

  /** id of the program playing (0 = the hands) */
  get playing(): number { return this.prog?.id ?? 0; }

  private newStreams(): void {
    this.engine.streams = { out: new Float32Array(STREAM), flow: new Float32Array(STREAM), noise: new Float32Array(STREAM) };
    this.engine.streamPos = 0;
  }

  handle(m: RunnerIn): void {
    switch (m.type) {
      case 'params': {
        const p = this.prog ?? this.queued;
        if (p) {
          p.after = m.after;
          if (m.program === p.id) {
            p.params = m.params;
            if (p === this.prog) this.engine.setParams(m.params);
          }
        } else this.engine.setParams(m.after);
        if (!this.started) { this.engine.snapArticulators(); this.started = true; }
        break;
      }
      case 'program': {
        const p = m.program;
        if (this.prog) this.end('replaced');
        if (this.queued) { this.post({ type: 'ended', id: this.queued.id, reason: 'replaced' }); this.streams.delete(this.queued.id); this.queued = null; }
        if (p.stream) this.streams.set(p.id, { q: p.samples?.length ? [p.samples] : [], at: 0, played: 0, last: false });
        if ((p.snap || p.samples || p.stream) && this.started && this.gain > 0) {
          this.queued = p;
          this.gainTarget = 0;
        } else this.begin(p);
        break;
      }
      case 'stop':
        if (this.prog?.id === m.id) this.end('stopped');
        else if (this.queued?.id === m.id) {
          this.post({ type: 'ended', id: m.id, reason: 'stopped' });
          this.streams.delete(m.id);
          this.queued = null;
          this.gainTarget = 1;
        }
        break;
      case 'append': {
        const s = this.streams.get(m.id);
        if (!s) break;
        if (m.samples.length) s.q.push(m.samples);
        if (m.last) s.last = true;
        break;
      }
      case 'swap': {
        const p = this.prog?.id === m.id ? this.prog : this.queued?.id === m.id ? this.queued : null;
        if (!p?.loop || !p.samples || !m.samples.length) break;
        if (p === this.prog) {
          // the new samples from the same share of their length; the old ones fade out from where they were
          const s = p.samples, at = this.pos % s.length;
          this.old = { samples: s, pos: at, left: this.fadeLength };
          this.pos = Math.min(m.samples.length - 1, Math.round((at / s.length) * m.samples.length));
        }
        p.samples = m.samples;
        p.flow = undefined;
        break;
      }
    }
  }

  private begin(p: Program): void {
    this.prog = p;
    this.old = null;
    this.pos = p.samples && p.from ? Math.max(0, Math.min(p.samples.length - 1, Math.round(p.from))) : 0;
    this.engine.setParams(p.params);
    if (p.snap || !this.started) { this.engine.snapArticulators(); this.started = true; }
    if (p.score) this.engine.playScore(p.score);
    this.length = p.loop || p.stream ? 0 : p.samples ? p.samples.length : p.seconds ? Math.round(p.seconds * this.fs) : 0;
    const cap = this.length || (p.score ? Math.ceil((p.score.duration + 0.5) * this.fs) : 0);
    this.captured = p.capture && cap > 0 ? new Float32Array(cap) : null;
    this.gainTarget = 1;
  }

  private end(reason: EndReason): void {
    const p = this.prog;
    if (!p) return;
    this.streams.delete(p.id);
    if (p.score && this.engine.isPlaying) this.engine.stopScore();
    this.engine.setParams(p.after);
    this.prog = null;
    this.old = null;
    const cap = this.captured;
    this.captured = null;
    if (cap) {
      const c = cap.slice(0, Math.min(cap.length, this.pos));
      this.post({ type: 'ended', id: p.id, reason, captured: c }, [c.buffer]);
    } else this.post({ type: 'ended', id: p.id, reason });
  }

  /** Renders one block (mono) and posts the analysis streams and the telemetry. */
  process(out: Float32Array): void {
    const n = out.length;
    const st = this.engine.streams!;
    const k0 = this.engine.streamPos;
    this.engine.process(out, n);
    const written = this.engine.streamPos - k0;
    const p = this.prog;
    if (p?.samples || p?.stream) {
      const g = Math.pow(10, this.engine.params.volume / 20);
      const s = p.samples ?? NONE, fl = p.flow;
      if (p.loop) {
        for (let i = 0; i < n; i++) out[i] = s[(this.pos + i) % s.length] * g;
        const o = this.old;
        if (o) {
          // a swap: the new samples come in as the old ones go out
          for (let i = 0; i < n && o.left > 0; i++, o.left--) {
            const u = o.left / this.fadeLength;
            out[i] = out[i] * (1 - u) + o.samples[(o.pos + i) % o.samples.length] * g * u;
          }
          o.pos = (o.pos + n) % o.samples.length;
          if (o.left <= 0) this.old = null;
        }
      } else if (p.stream) {
        // the pieces as they have come; silence while the next one is late
        const q = this.streams.get(p.id);
        for (let i = 0; i < n; i++) {
          while (q && q.q.length && q.at >= q.q[0].length) { q.q.shift(); q.at = 0; }
          if (q && q.q.length) { out[i] = q.q[0][q.at++] * g; q.played++; } else out[i] = 0;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const j = this.pos + i;
          out[i] = j < s.length ? s[j] * g : 0;
        }
      }
      for (let i = 0; i < written; i++) {
        const j = p.loop ? (this.pos + i) % s.length : this.pos + i;
        st.out[k0 + i] = out[i];
        st.flow[k0 + i] = fl && j < fl.length ? fl[j] : 0;
        st.noise[k0 + i] = 0;
      }
    }
    // fades: out before a jump, back in after it
    if (this.gain !== 1 || this.gainTarget !== 1) {
      for (let i = 0; i < n; i++) {
        if (this.gain < this.gainTarget) this.gain = Math.min(this.gainTarget, this.gain + this.gainStep);
        else if (this.gain > this.gainTarget) this.gain = Math.max(this.gainTarget, this.gain - this.gainStep);
        out[i] *= this.gain;
        if (i < written) st.out[k0 + i] = out[i];
      }
    }
    if (p) {
      const cap = this.captured;
      if (cap) for (let i = 0; i < n && this.pos + i < cap.length; i++) cap[this.pos + i] = out[i];
      this.pos += n;
      if (p.loop && p.samples) this.pos %= p.samples.length;
      const sq = p.stream ? this.streams.get(p.id) : undefined;
      const over = p.score ? !this.engine.isPlaying
        : p.stream ? !sq || (sq.last && sq.q.every((c, k) => (k === 0 ? sq.at >= c.length : !c.length)))
        : this.length > 0 && this.pos >= this.length;
      if (over) this.end('done');
    }
    if (this.queued && this.gain === 0) {
      const q = this.queued;
      this.queued = null;
      this.begin(q);
    }
    if (this.engine.streamPos >= STREAM) {
      this.post({ type: 'stream', out: st.out, flow: st.flow, noise: st.noise }, [st.out.buffer, st.flow.buffer, st.noise.buffer]);
      this.newStreams();
    }
    if (++this.blocks >= TELEMETRY_BLOCKS) {
      this.blocks = 0;
      const lp = this.prog;
      this.post({ type: 'telemetry', telemetry: this.engine.telemetry(), program: this.playing, ...(lp?.loop ? { at: this.pos / this.fs } : lp?.stream ? { at: (this.streams.get(lp.id)?.played ?? 0) / this.fs } : {}) });
    }
  }
}
