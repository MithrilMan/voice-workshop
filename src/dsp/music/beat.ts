/**
 * Beatbox: the drums made by the mouth of a voice. Every sound of the kit
 * is a sound of speech, as real-time MRI of beatboxers shows (Proctor et
 * al. 2013): the kick drum a bilabial ejective (the lips shut, the closed
 * larynx rises like a piston and the lips burst), the snare a [p] let go
 * into lip-and-teeth hiss, the hi-hat a [t] let go into an [s], the rimshot
 * a velar ejective, clicks of the tongue, a hum or a lip trill for the bass.
 * Here each one is said by the voice's own mouth, so a larger head makes a
 * deeper kit.
 *
 * Each sound is said once (a few times, a little different each time),
 * and the instant it strikes (its burst, or its onset) is found and set on
 * its step, so that every hit lands on the beat whatever its closure.
 */
import { renderOffline } from '../engine/engine';
import { textToPhones } from '../speech/g2p';
import { VoiceDesign, cloneVoice } from '../voice/design';
import { utterance } from '../voice/utterance';
import type { Track } from './mix';

export interface DrumSound {
  id: string;
  name: string;
  /** what the mouth says (IPA) */
  ipa: string;
  /** other ways of making it (IPA) */
  alternatives: string[];
  /** the pitch of a voiced sound (a hum), Hz */
  f0?: number;
  hint: string;
}

export const BEATBOX_KIT: readonly DrumSound[] = [
  { id: 'kick', name: 'Kick', ipa: 'pʼ', alternatives: ['p', 'ʘ', 'bʼ'], hint: 'a bilabial ejective: lips shut, the closed larynx pushes up and the lips burst' },
  { id: 'snare', name: 'Snare', ipa: 'pf', alternatives: ['pfʼ', 'pʃ', 'kʼ', 'tʃ'], hint: 'a [p] let go into the hiss of lip and teeth' },
  { id: 'hat', name: 'Hi-hat', ipa: 'ts', alternatives: ['tʼ', 'tsʼ', 't'], hint: 'a [t] let go into a short [s]' },
  { id: 'openhat', name: 'Open hi-hat', ipa: 'tsː', alternatives: ['sː', 'tʃː', 'tsːʼ'], hint: 'a [t] let go into a long [s]' },
  { id: 'rim', name: 'Rimshot', ipa: 'kʼ', alternatives: ['k', 'ǀ', 'tʼ'], hint: 'a velar ejective' },
  { id: 'click', name: 'Click', ipa: 'ǃ', alternatives: ['ǁ', 'ǀ', 'ʘ'], hint: 'a click of the tongue: the air between two closures rarefied, then let in' },
  { id: 'bass', name: 'Hum bass', ipa: 'mː', alternatives: ['ʙ', 'nː', 'ʙː'], f0: 62, hint: 'a low hum through the nose (or a lip trill)' },
];

export interface DrumHit {
  samples: Float32Array;
  fs: number;
  /** where it strikes, s from its start */
  hit: number;
}

/** the level of each millisecond, dB */
function envelope(x: Float32Array, fs: number): number[] {
  const W = Math.max(1, Math.round(fs / 1000)), out: number[] = [];
  for (let i = 0; i + W <= x.length; i += W) { let s = 0; for (let j = i; j < i + W; j++) s += x[j] * x[j]; out.push(10 * Math.log10(s / W + 1e-20)); }
  return out;
}

/**
 * A sound of the kit (IPA) said by a voice, cut to itself: from just before
 * the instant it strikes (the first millisecond within 12 dB of its loudest)
 * to where it has died away (50 dB below), with short fades.
 */
export function drumHit(d: Readonly<VoiceDesign>, ipa: string, fs = 48000, o: { seed?: number; f0?: number } = {}): DrumHit {
  const v = cloneVoice(d as VoiceDesign);
  if (o.f0) { v.speaking.f0 = o.f0; v.speaking.accent = 0; }
  const phones = textToPhones(`[${ipa}]`, 'it');
  if (!phones.length) throw new Error(`not a sound: [${ipa}]`);
  const u = utterance(v, phones, v.language || 'it', o.seed === undefined ? {} : { seed: o.seed });
  const params = { ...u.params, source: { ...u.params.source, ps: 0 } };
  const { out } = renderOffline(params, u.score.duration + 0.2, fs, u.score);
  const env = envelope(out, fs);
  const from = Math.max(0, Math.floor((u.score.phones[0]?.t0 ?? 0) * 1000) - 5);
  let top = -200;
  for (let k = from; k < env.length; k++) top = Math.max(top, env[k]);
  let hit = from;
  while (hit < env.length - 1 && env[hit] < top - 12) hit++;
  let end = env.length - 1;
  while (end > hit && env[end] < top - 50) end--;
  const ms = fs / 1000, pre = 12;
  const a = Math.max(0, Math.round((hit - pre) * ms)), b = Math.min(out.length, Math.round((end + 10) * ms));
  const s = out.slice(a, b);
  const fin = Math.min(s.length, Math.round(3 * ms)), fout = Math.min(s.length, Math.round(10 * ms));
  for (let i = 0; i < fin; i++) s[i] *= i / fin;
  for (let i = 0; i < fout; i++) s[s.length - 1 - i] *= i / fout;
  return { samples: s, fs, hit: (hit * ms - a) / fs };
}

export interface BeatTrack {
  /** the sound (IPA) */
  sound: string;
  /** its steps: x a hit, X (or >) an accent, o a soft one, . (or -) nothing; | and spaces for the eye */
  pattern: string;
  /** level, dB (0) */
  gain?: number;
  /** the pitch of a voiced sound (a hum), Hz */
  f0?: number;
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
 * Every hit of a beat as a track placed in time (s from the first step, a
 * hit set early by the time its sound takes to strike), ready to mix.
 * Each sound is said three times (three seeds) and the hits take turns.
 */
export function beatHits(d: Readonly<VoiceDesign>, tracks: readonly BeatTrack[], o: BeatOptions = {}): { hits: Track[]; length: number } {
  const fs = o.fs ?? 48000, spb = 60 / Math.max(20, Math.min(400, o.tempo ?? 100)), per = Math.max(1, Math.round(o.stepsPerBeat ?? 4));
  const step = spb / per, swing = Math.max(0, Math.min(0.6, o.swing ?? 0)), rep = Math.max(1, Math.round(o.repeat ?? 1));
  const seed = o.seed ?? 1;
  const hits: Track[] = [];
  let steps = 0;
  const cache = new Map<string, DrumHit[]>();
  for (const t of tracks) {
    const pat = parsePattern(t.pattern);
    steps = Math.max(steps, pat.length);
    if (!pat.some((v) => v > 0)) continue;
    const key = `${t.sound}|${t.f0 ?? ''}`;
    if (!cache.has(key)) cache.set(key, [0, 1, 2].map((k) => drumHit(d, t.sound, fs, { seed: seed + 17 * k, f0: t.f0 })));
    const takes = cache.get(key)!;
    let n = 0;
    for (let r = 0; r < rep; r++) {
      pat.forEach((v, i) => {
        if (v <= 0) return;
        const s = r * pat.length + i;
        const t0 = s * step + (s % 2 === 1 ? swing * 0.5 * step : 0);
        const take = takes[n++ % takes.length];
        hits.push({ samples: take.samples, fs, at: t0 - take.hit, gain: (t.gain ?? 0) + 20 * Math.log10(v) });
      });
    }
  }
  return { hits, length: steps * rep * step };
}
