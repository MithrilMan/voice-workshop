/**
 * Beatbox: the drums made by the mouth of a voice. Every sound of the kit
 * is a sound of speech, as real-time MRI of beatboxers shows (Proctor et
 * al. 2013; de Torcy et al. 2014; Paroni et al. 2021): the kick drum a
 * bilabial ejective (the lips shut, the closed larynx rises like a piston
 * and the lips burst), the snare a [p] let go into lip-and-teeth hiss, the
 * hi-hat a [t] let go into an [s], the rimshot a velar ejective, clicks of
 * the tongue, a hum or a lip trill for the bass; and the inward sounds,
 * made while the lungs draw the air in (k↓, the inward K snare), with which
 * a beatboxer breathes without stopping. Here each one is said by the
 * voice's own mouth, so a larger head makes a deeper kit.
 *
 * Each sound is said once (a few times, a little different each time),
 * and the instant it strikes (its burst, or its onset) is found and set on
 * its step, so that every hit lands on the beat whatever its closure.
 * One mouth makes one sound at a time: by default each hit cuts the one
 * before it, as in a beatboxer's mouth (a hum through the nose goes on
 * under the clicks of the tongue); `layered` lets every hit ring out, as
 * a drum machine would.
 */
import { renderOffline } from '../engine/engine';
import { textToPhones } from '../speech/g2p';
import { VoiceDesign, cloneVoice, withField } from '../voice/design';
import { utterance } from '../voice/utterance';
import { noteNumber, midiHz } from './notes';
import type { Track } from './mix';

export type DrumFamily = 'kick' | 'snare' | 'hat' | 'cymbal' | 'perc' | 'bass' | 'fx';

export interface DrumSound {
  id: string;
  /** how it is written in a beat (see parseBeat) */
  code: string;
  name: string;
  family: DrumFamily;
  /** what the mouth says (IPA) */
  ipa: string;
  /** other ways of making it (IPA) */
  alternatives: string[];
  /** the pitch of a voiced sound, Hz, and the pitch it glides to by its end */
  f0?: number;
  f0End?: number;
  /** its last sound held this many times its spoken length (a crash, a long roll) */
  hold?: number;
  /** its level in the kit, dB against a kick (0) */
  level: number;
  /** the air drawn in by the lungs */
  inward?: boolean;
  /** made with the voice through the nose: goes on under the clicks of the tongue */
  hum?: boolean;
  /** fields of the voice changed for this sound alone (a path of VOICE_FIELDS: value), as an imitation finds them */
  knobs?: Record<string, number>;
  hint: string;
}

export const DRUM_FAMILIES: readonly { id: DrumFamily; name: string }[] = [
  { id: 'kick', name: 'Kicks' }, { id: 'snare', name: 'Snares' }, { id: 'hat', name: 'Hi-hats' }, { id: 'cymbal', name: 'Cymbals' },
  { id: 'perc', name: 'Rims and clicks' }, { id: 'bass', name: 'Basses' }, { id: 'fx', name: 'Effects' },
];

export const BEATBOX_KIT: readonly DrumSound[] = [
  // kicks
  { id: 'kick', code: 'b', name: 'Kick', family: 'kick', ipa: 'pʼ', alternatives: ['p', 'ʘ', 'bʼ'], level: 0, hint: 'a bilabial ejective: lips shut, the closed larynx pushes up and the lips burst' },
  { id: 'kick808', code: 'b8', name: '808 kick', family: 'kick', ipa: 'bmː', alternatives: ['pʼmː', 'mː'], f0: 75, f0End: 42, level: 0, hint: 'a kick that rings on as a hum falling in pitch, like the drum machine' },
  { id: 'throatkick', code: 'bk', name: 'Throat kick', family: 'kick', ipa: 'ʔʌ̆', alternatives: ['ʔə̆', 'ʔɯ̆'], f0: 70, level: -1, hint: 'the folds shut, then let go into a short, low vowel' },
  { id: 'popkick', code: 'bp', name: 'Pop kick', family: 'kick', ipa: 'ɓ', alternatives: ['ɓʼ', 'ʘ'], f0: 80, level: -1, hint: 'a bilabial implosive: the larynx drops behind the shut lips, and the lips pop' },
  { id: 'inkick', code: '^b', name: 'Inward kick', family: 'kick', ipa: 'p↓', alternatives: ['ʘ', 'ɓ'], level: -2, inward: true, hint: 'the lips burst while the lungs draw the air in' },
  // snares
  { id: 'snare', code: 'pf', name: 'PF snare', family: 'snare', ipa: 'pf', alternatives: ['pfʼ', 'pɸ', 'kʼ'], level: -1, hint: 'a [p] let go into the hiss of lip and teeth' },
  { id: 'psh', code: 'psh', name: 'Psh snare', family: 'snare', ipa: 'pʃ', alternatives: ['pʃʼ', 'pɕ'], level: -2, hint: 'a [p] let go into a [ʃ]' },
  { id: 'ksh', code: 'ksh', name: 'Ksh snare', family: 'snare', ipa: 'kʃ', alternatives: ['kʃʼ', 'kɕ'], level: -2, hint: 'a [k] let go into a [ʃ]' },
  { id: 'tch', code: 'tch', name: 'Tch snare', family: 'snare', ipa: 'tʃ', alternatives: ['tʃʼ', 'tɕ'], level: -2, hint: 'an affricate, the tongue let go into a [ʃ]' },
  { id: 'inksnare', code: '^k', name: 'Inward K snare', family: 'snare', ipa: 'k↓', alternatives: ['kʟ̝̊↓', 'kx↓'], level: -2, inward: true, hint: 'the back of the tongue let go while the lungs draw the air in: the snare a beatboxer breathes on' },
  { id: 'spit', code: 'sp', name: 'Spit snare', family: 'snare', ipa: 'pɸʼ', alternatives: ['pfʼ', 'pɸ'], level: -3, hint: 'an ejective [p] let go into the hiss of the lips alone' },
  { id: 'clap', code: 'cl', name: 'Clap', family: 'snare', ipa: 'ǁ', alternatives: ['ǃ', 'ǂ'], level: -3, hint: 'a lateral click, sharp as a clap' },
  // hi-hats
  { id: 'hat', code: 'ts', name: 'Hi-hat', family: 'hat', ipa: 'ts', alternatives: ['tʼ', 'tsʼ', 't'], level: -8, hint: 'a [t] let go into a short [s]' },
  { id: 'tick', code: 't', name: 'Tick', family: 'hat', ipa: 't', alternatives: ['tʼ', 'ʈ'], level: -9, hint: 'a [t] alone' },
  { id: 'tk', code: 'tk', name: 'Tk', family: 'hat', ipa: 'tk', alternatives: ['tx', 'kt'], level: -9, hint: 'a [t] and a [k] in one stroke' },
  { id: 'inhat', code: '^ts', name: 'Inward hi-hat', family: 'hat', ipa: 't↓s↓', alternatives: ['s↓', 'ts↓'], level: -9, inward: true, hint: 'a [ts] made while the lungs draw the air in' },
  { id: 'openhat', code: 'tss', name: 'Open hi-hat', family: 'hat', ipa: 'tsː', alternatives: ['sː', 'tʃː', 'tsːʼ'], level: -8, hint: 'a [t] let go into a long [s]' },
  { id: 'shaker', code: 'sh', name: 'Shaker', family: 'hat', ipa: 'ʃ', alternatives: ['ɕ', 's'], level: -11, hint: 'a short [ʃ]' },
  // cymbals
  { id: 'crash', code: 'cr', name: 'Crash', family: 'cymbal', ipa: 'kʃː', alternatives: ['pʃː', 'tʃː'], hold: 2.2, level: -5, hint: 'a [k] let go into a long [ʃ] that dies away' },
  { id: 'ride', code: 'rd', name: 'Ride', family: 'cymbal', ipa: 'tɕ', alternatives: ['tsʲ', 'tç'], level: -8, hint: 'a [t] let go into a palatal hiss, brighter than a hi-hat' },
  // rims and clicks
  { id: 'rim', code: 'k', name: 'Rimshot', family: 'perc', ipa: 'kʼ', alternatives: ['k', 'ǀ', 'tʼ'], level: -4, hint: 'a velar ejective' },
  { id: 'click', code: 'ck', name: 'Click', family: 'perc', ipa: 'ǃ', alternatives: ['ǁ', 'ǀ', 'ʘ'], level: -5, hint: 'a click of the tongue: the air between two closures rarefied, then let in' },
  { id: 'lippop', code: 'po', name: 'Lip pop', family: 'perc', ipa: 'ʘ', alternatives: ['ʘʷ', 'ɓ'], level: -5, hint: 'a bilabial click: the lips smacked apart' },
  { id: 'tut', code: 'tt', name: 'Tut', family: 'perc', ipa: 'ǀ', alternatives: ['ǃ', 'ǂ'], level: -6, hint: 'a dental click, the tongue sucked off the teeth' },
  { id: 'cluck', code: 'cu', name: 'Cluck', family: 'perc', ipa: 'ǂ', alternatives: ['ǃ', 'ǁ'], level: -5, hint: 'a palatal click, the blade of the tongue sucked off the roof of the mouth' },
  { id: 'drop', code: 'dr', name: 'Water drop', family: 'perc', ipa: 'ǃʷ', alternatives: ['ǃ', 'ʘ'], level: -5, hint: 'a click made with rounded lips, hollow like a drop' },
  { id: 'humclick', code: 'nk', name: 'Hummed click', family: 'perc', ipa: 'ᵑǃ', alternatives: ['ᵑǁ', 'ᵑǀ'], f0: 90, level: -4, hint: 'a click with a hum through the nose under it' },
  // basses
  { id: 'bass', code: 'm', name: 'Hum bass', family: 'bass', ipa: 'mː', alternatives: ['ʙ', 'nː', 'ʙː'], f0: 62, level: -2, hum: true, hint: 'a low hum through the nose' },
  { id: 'lipbass', code: 'bb', name: 'Lip bass', family: 'bass', ipa: 'ʙː', alternatives: ['ʙ', 'mʙ'], f0: 65, level: -3, hint: 'the lips trilled by a low voice' },
  { id: 'throatbass', code: 'uh', name: 'Throat bass', family: 'bass', ipa: 'ə̰ː', alternatives: ['ɯ̰ː', 'ʌ̰ː'], f0: 55, level: -4, hint: 'a creaky, low vowel deep in the throat' },
  { id: 'sub', code: 'mm', name: 'Sub drop', family: 'bass', ipa: 'mː', alternatives: ['ŋː', 'nː'], f0: 70, f0End: 38, hold: 1.8, level: -2, hum: true, hint: 'a hum through the nose falling to the bottom of the voice' },
  { id: 'inbass', code: '^bb', name: 'Inward lip bass', family: 'bass', ipa: 'ʙ̥↓', alternatives: ['ʙ̥', 'ʙ̥ː'], level: -4, inward: true, hint: 'the lips trilled by the air drawn in' },
  // effects
  { id: 'liproll', code: 'lr', name: 'Lip roll', family: 'fx', ipa: 'ʙ̥ː', alternatives: ['ʙ̥', 'ʙ̥↓'], hold: 1.5, level: -6, hint: 'the lips trilled by the breath, without voice' },
  { id: 'tongueroll', code: 'rr', name: 'Tongue roll', family: 'fx', ipa: 'r̥ː', alternatives: ['rː', 'r̝̊ː'], hold: 1.5, level: -8, hint: 'the tip of the tongue trilled, without voice' },
  { id: 'scratch', code: 'sc', name: 'Scratch', family: 'fx', ipa: 'ɰɯ', alternatives: ['wɯ', 'ɰi'], f0: 260, f0End: 620, level: -6, hint: 'a vowel swept up in pitch, like a record pulled under the needle' },
  { id: 'laser', code: 'lz', name: 'Laser', family: 'fx', ipa: 'pʲiː', alternatives: ['tʲiː', 'pʲɨː'], f0: 1100, f0End: 260, level: -8, hint: 'a high vowel falling fast in pitch' },
  { id: 'zip', code: 'zp', name: 'Zip', family: 'fx', ipa: 't↓s↓ts', alternatives: ['s↓s', 'ts↓ts'], level: -9, hint: 'an [ts] drawn in and blown out at once' },
];

/** a sound of the kit (or of `own`, sounds of one's own, first) by its id or its code */
export const drumSound = (key: string, own: readonly DrumSound[] = []): DrumSound | undefined =>
  own.find((k) => k.id === key || k.code === key) ?? BEATBOX_KIT.find((k) => k.id === key) ?? BEATBOX_KIT.find((k) => k.code === key);

export interface DrumHit {
  samples: Float32Array;
  fs: number;
  /** where it strikes, s from its start */
  hit: number;
}

/** the level of each millisecond, dB */
export function envelope(x: ArrayLike<number>, fs: number): number[] {
  const W = Math.max(1, Math.round(fs / 1000)), out: number[] = [];
  for (let i = 0; i + W <= x.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += x[j] * x[j]; out.push(10 * Math.log10(s / W + 1e-20)); }
  return out;
}

/**
 * Where a sound strikes and where it has died away, ms (its level every
 * millisecond given): from the first moment within 12 dB of its loudest
 * to the last within `below` dB of it; what comes before a silence of 60
 * ms or more ahead of the loudest moment (a mouth closing with a tick
 * before it lets go) is not the sound.
 */
export function strikeOf(env: readonly number[], from = 0, below = 50): { hit: number; end: number } {
  let top = -Infinity, peak = from;
  for (let k = from; k < env.length; k++) if (env[k] > top) { top = env[k]; peak = k; }
  let start = from, quiet = 0;
  for (let k = peak; k >= from; k--) {
    if (env[k] < top - 40) { if (++quiet >= 60) { start = k + quiet; break; } } else quiet = 0;
  }
  let hit = start;
  while (hit < peak && env[hit] < top - 12) hit++;
  let end = env.length - 1;
  while (end > hit && env[end] < top - below) end--;
  return { hit, end };
}

/** the loudest 20 ms of a sound, dB (rms) */
function loudest(x: Float32Array, fs: number): number {
  const w = Math.max(1, Math.round(0.02 * fs)), hop = Math.max(1, w >> 2);
  let best = 0;
  for (let i = 0; i + w <= x.length; i += hop) { let e = 0; for (let k = i; k < i + w; k++) e += x[k] * x[k]; best = Math.max(best, e / w); }
  return 10 * Math.log10(best + 1e-20);
}

/** the level of a kick in a kit, dBFS over its loudest 20 ms: the other sounds are set against it */
export const KIT_LEVEL = -20;

export interface DrumHitOptions {
  seed?: number;
  /** the pitch of a voiced sound, Hz, and the one it glides to by its end */
  f0?: number;
  f0End?: number;
  /** its last sound held this many times its length */
  hold?: number;
  /** its loudest 20 ms brought to this level, dBFS (left as said when not given) */
  level?: number;
  /** fields of the voice changed for this sound alone */
  knobs?: Record<string, number>;
}

/**
 * A sound of the kit (IPA) said by a voice, cut to itself: from just before
 * the instant it strikes (the first millisecond within 12 dB of its loudest)
 * to where it has died away (50 dB below), with short fades.
 */
export function drumHit(d: Readonly<VoiceDesign>, ipa: string, fs = 48000, o: DrumHitOptions = {}): DrumHit {
  let v = cloneVoice(d as VoiceDesign);
  for (const [path, value] of Object.entries(o.knobs ?? {})) v = withField(v, path, value);
  if (o.f0) { v.speaking.f0 = o.f0; v.speaking.accent = 0; }
  const phones = textToPhones(`[${ipa}]`, 'it');
  if (!phones.length) throw new Error(`not a sound: [${ipa}]`);
  const hold = o.hold && o.hold > 0 ? o.hold : 1;
  const u = utterance(v, phones, v.language || 'it', {
    ...(o.seed === undefined ? {} : { seed: o.seed }),
    ...(hold !== 1 ? { timing: { stretch: phones.map((_, i) => (i === phones.length - 1 ? hold : 1)), pauses: [] } } : {}),
  });
  let score = u.score;
  if (o.f0 && o.f0End && o.f0End !== o.f0) {
    // the pitch glides (evenly in octaves) from the first sound to the end of the last
    const t0 = score.phones[0]?.t0 ?? 0, t1 = score.phones[score.phones.length - 1]?.t1 ?? score.duration;
    const r = o.f0End / o.f0;
    score = { ...score, f0Tau: 0.004, frames: score.frames.map((f) => ({ ...f, f0: o.f0! * r ** Math.max(0, Math.min(1, (f.t - t0) / Math.max(0.01, t1 - t0))) })) };
  }
  const params = { ...u.params, source: { ...u.params.source, ps: 0 } };
  const { out } = renderOffline(params, score.duration + 0.2, fs, score);
  const env = envelope(out, fs);
  const { hit, end } = strikeOf(env, Math.max(0, Math.floor((score.phones[0]?.t0 ?? 0) * 1000) - 5));
  const ms = fs / 1000, pre = 12;
  const a = Math.max(0, Math.round((hit - pre) * ms)), b = Math.min(out.length, Math.round((end + 10) * ms));
  const s = out.slice(a, b);
  const fin = Math.min(s.length, Math.round(3 * ms)), fout = Math.min(s.length, Math.round(10 * ms));
  for (let i = 0; i < fin; i++) s[i] *= i / fin;
  for (let i = 0; i < fout; i++) s[s.length - 1 - i] *= i / fout;
  if (o.level !== undefined) {
    const g = 10 ** ((o.level - loudest(s, fs)) / 20);
    if (Number.isFinite(g)) for (let i = 0; i < s.length; i++) s[i] *= g;
  }
  return { samples: s, fs, hit: (hit * ms - a) / fs };
}

export interface BeatTrack {
  /** the sound: a sound of the kit (its id or code) or any IPA */
  sound: string;
  /** its steps: x a hit, X (or >) an accent, o a soft one, . (or -) nothing; | and spaces for the eye */
  pattern: string;
  /** level, dB (0) */
  gain?: number;
  /** the pitch of a voiced sound (a hum), Hz; a note name (C2) also works */
  f0?: number | string;
}

export interface BeatOptions {
  /** beats per minute (100) */
  tempo?: number;
  /** steps in a beat (4: sixteenth notes) */
  stepsPerBeat?: number;
  /** how many times the pattern is played (1) */
  repeat?: number;
  /** the second step of each pair played late by this share of half a step, 0 .. 0.6 (0) */
  swing?: number;
  /** a human's unevenness, 0 .. 1 (0): hits a few milliseconds early or late, a little louder or softer */
  humanize?: number;
  /** every hit rings out (a drum machine) instead of one mouth making one sound at a time (false) */
  layered?: boolean;
  /** sounds of one's own (an imitation of a recording: see imitate), written by their codes like the kit's */
  sounds?: DrumSound[];
  fs?: number;
  seed?: number;
}

/** the steps of a pattern: 0 nothing, else the hit's level factor */
export function parsePattern(p: string): number[] {
  const out: number[] = [];
  for (const c of p) {
    if (c === '|' || c === ' ' || c === '\n' || c === '\t') continue;
    out.push(c === 'X' || c === '>' ? 1.5 : c === 'x' ? 1 : c === 'o' ? 0.45 : 0);
  }
  return out;
}

/**
 * A beat written as text, one step after another, as tracks:
 *
 *     b . ts . pf . ts . | b b ts . pf . ts ^k
 *
 * Each word is a step: a sound of the kit by its code (b kick, pf snare, ts
 * hi-hat, ^k inward K snare… see BEATBOX_KIT) or any sound in [IPA]; `.` or
 * `-` nothing; `+` joins sounds struck together (b+ts); a trailing `!` makes
 * it an accent, a trailing `?` a soft one; `:C2` (or `:65`, Hz) gives a
 * voiced sound its pitch (m:C2). `|` and new lines are for the eye; lines
 * that each start with `>` are layers played together. Sounds of one's own
 * (`own`) are written by their codes too.
 */
export function parseBeat(text: string, own: readonly DrumSound[] = []): BeatTrack[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const layered = lines.some((l) => l.startsWith('>'));
  if (layered && !lines.every((l) => l.startsWith('>'))) throw new Error('when one line starts with ">", every line is a layer and starts with it');
  const layers = layered ? lines.map((l) => l.slice(1)) : [lines.join(' ')];
  const tracks = new Map<string, { sound: string; f0?: number | string; steps: string[] }>();
  let length = 0;
  const parsed = layers.map((l) => l.split(/[\s|]+/).filter(Boolean));
  for (const words of parsed) length = Math.max(length, words.length);
  parsed.forEach((words) => words.forEach((w, i) => {
    if (w === '.' || w === '-' || w === '_') return;
    for (let part of w.split('+')) {
      let mark = 'x';
      if (part.endsWith('!')) { mark = 'X'; part = part.slice(0, -1); } else if (part.endsWith('?')) { mark = 'o'; part = part.slice(0, -1); }
      let f0: number | string | undefined;
      const colon = part.lastIndexOf(':');
      if (colon > 0 && !part.startsWith('[')) { const p = part.slice(colon + 1); f0 = /^\d+(\.\d+)?$/.test(p) ? +p : p; part = part.slice(0, colon); }
      else if (part.startsWith('[') && part.includes(']:')) { const k = part.indexOf(']:'); const p = part.slice(k + 2); f0 = /^\d+(\.\d+)?$/.test(p) ? +p : p; part = part.slice(0, k + 1); }
      const sound = part.startsWith('[') && part.endsWith(']') ? part.slice(1, -1) : part;
      if (!sound) continue;
      if (!part.startsWith('[') && !drumSound(sound, own)) throw new Error(`not a sound of the kit: "${sound}" (write any other sound in [IPA])`);
      if (typeof f0 === 'string') hzOf(f0);
      const key = `${sound}|${f0 ?? ''}`;
      if (!tracks.has(key)) tracks.set(key, { sound, f0, steps: [] });
      tracks.get(key)!.steps[i] = mark;
    }
  }));
  return [...tracks.values()].map((t) => ({ sound: t.sound, ...(t.f0 !== undefined ? { f0: t.f0 } : {}), pattern: Array.from({ length }, (_, i) => t.steps[i] ?? '.').join('') }));
}

/** a pitch in Hz, or a note's name (C2) as Hz */
function hzOf(f0: number | string): number {
  if (typeof f0 === 'number') return f0;
  const m = noteNumber(f0);
  if (m === null) throw new Error(`not a note: "${f0}"`);
  return midiHz(m);
}

/** a seeded random number generator, uniform 0..1 */
function rng(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Every hit of a beat as a track placed in time (s from the first step, a
 * hit set early by the time its sound takes to strike), ready to mix.
 * Each sound is said three times (three seeds) and the hits take turns;
 * the sounds of the kit are set to their levels in it. With one mouth (the
 * default), each hit is cut where the next one strikes, except a hum under
 * a click.
 */
export function beatHits(d: Readonly<VoiceDesign>, tracks: readonly BeatTrack[], o: BeatOptions = {}): { hits: Track[]; length: number } {
  const fs = o.fs ?? 48000, spb = 60 / Math.max(20, Math.min(400, o.tempo ?? 100)), per = Math.max(1, Math.round(o.stepsPerBeat ?? 4));
  const step = spb / per, swing = Math.max(0, Math.min(0.6, o.swing ?? 0)), rep = Math.max(1, Math.round(o.repeat ?? 1));
  const human = Math.max(0, Math.min(1, o.humanize ?? 0));
  const seed = o.seed ?? 1, rand = rng(seed * 7919 + 13);
  const gauss = () => { let a = 0; for (let k = 0; k < 4; k++) a += rand(); return (a - 2) * Math.sqrt(3); };
  const placed: { track: Track; samples: Float32Array; at: number; hum: boolean; click: boolean }[] = [];
  let steps = 0;
  const cache = new Map<string, DrumHit[]>();
  for (const t of tracks) {
    const pat = parsePattern(t.pattern);
    steps = Math.max(steps, pat.length);
    if (!pat.some((v) => v > 0)) continue;
    const kit = drumSound(t.sound, o.sounds);
    const ipa = kit ? kit.ipa : t.sound;
    const f0 = t.f0 === undefined ? kit?.f0 : hzOf(t.f0);
    // a pitch given to a gliding sound moves its glide with it
    const f0End = kit?.f0End && kit.f0 && f0 ? kit.f0End * (f0 / kit.f0) : undefined;
    const key = `${ipa}|${f0 ?? ''}|${f0End ?? ''}|${kit?.hold ?? ''}|${JSON.stringify(kit?.knobs ?? {})}`;
    if (!cache.has(key)) cache.set(key, [0, 1, 2].map((k) => drumHit(d, ipa, fs, { seed: seed + 17 * k, f0, f0End, hold: kit?.hold, knobs: kit?.knobs, level: KIT_LEVEL + (kit?.level ?? -4) })));
    const takes = cache.get(key)!;
    const hum = !!kit?.hum || /^[mnŋɲɱ]ː?$/.test(ipa), click = /[ʘǀǃǂǁ]/.test(ipa);
    let n = 0;
    for (let r = 0; r < rep; r++) {
      pat.forEach((v, i) => {
        if (v <= 0) return;
        const s = r * pat.length + i;
        const late = human > 0 ? Math.max(-0.02, Math.min(0.02, 0.008 * human * gauss())) : 0;
        const t0 = s * step + (s % 2 === 1 ? swing * 0.5 * step : 0) + late;
        const take = takes[n++ % takes.length];
        const gain = (t.gain ?? 0) + 20 * Math.log10(v) + (human > 0 ? 1.5 * human * gauss() : 0);
        placed.push({ track: { samples: take.samples, fs, at: t0 - take.hit, gain }, samples: take.samples, at: t0, hum, click });
      });
    }
  }
  placed.sort((a, b) => a.at - b.at);
  if (!o.layered) {
    // one mouth: a sound ends where the next one strikes (faded over 8 ms), a hum goes on under the clicks
    const fade = Math.round(0.008 * fs);
    placed.forEach((p, k) => {
      const next = placed.slice(k + 1).find((q) => q.at > p.at + 1e-4 && !(p.hum && q.click) && !(q.hum && p.click));
      if (!next) return;
      const keep = Math.round((next.at - (p.track.at ?? 0)) * fs);
      if (keep >= p.samples.length) return;
      const s = p.samples.slice(0, Math.max(0, keep));
      for (let i = 0; i < Math.min(fade, s.length); i++) s[s.length - 1 - i] *= i / fade;
      p.track = { ...p.track, samples: s };
    });
  }
  return { hits: placed.map((p) => p.track), length: steps * rep * step };
}
