/**
 * The voice workshop as a library: voices made of knobs, that say a text or
 * phonemes, with an emotion, sing notes, beatbox, and perform together, in
 * Node or in the browser, with no interface.
 *
 *   import { createVoice, speak, toWav } from './library';
 *   const v = createVoice('sara', { 'speaking.f0': 230 });
 *   const s = speak(v, 'Buongiorno, come stai?', { emotion: 'joy' });
 *   writeFileSync('out.wav', toWav(s));
 *
 * A voice is a VoiceDesign (design.ts): its body, its folds, its habits and
 * its way of speaking, every field a knob with a human range (`voiceKnobs`).
 * Italian and English text are read by rules (English with its dictionary
 * once `setEnglishLexicon` has it); any language as IPA between brackets,
 * [like this], or between slashes for the rules of Italian or English; the
 * other languages of languages.ts once `preparePhonemes` has found their
 * words. A voice with a learnt way of saying uses it once the model of the
 * language is set (`setDeliveryModel`, `loadDeliveryModel`).
 */
import { renderOffline } from '../dsp/engine/engine';
import type { EngineParams, Score } from '../dsp/engine/params';
import type { Phone } from '../dsp/speech/g2p';
import { textToPhones, ipaKind } from '../dsp/speech/g2p';
import { resolve, PhonemizerSources } from '../dsp/speech/phonemizer';
import { speechLanguage } from '../dsp/speech/languages';
import { encodeWav, encodeWavStereo, decodeWav } from '../dsp/util/wav';
import { Note, parseNotes } from '../dsp/music/notes';
import { singScore, sungPitch, meantNotes, SingOptions, SungSyllable, SungNote } from '../dsp/music/sing';
import { melodyOf, pitchTrack, Melody, MelodyNote, MelodyOptions } from '../dsp/music/transcribe';
import { beatHits, parseBeat, BeatTrack, BeatOptions } from '../dsp/music/beat';
import { mixTracks, MixOptions, Stereo, Track, downmix, arrange, Performance, Placed } from '../dsp/music/mix';
import { voicePrint, VoicePrint, Clip } from '../dsp/analysis/voiceprint';
import { VoiceDesign, VOICE_FIELDS, Field, cloneVoice, fieldValue, withField, sanitizeVoice } from '../dsp/voice/design';
import { BUILTIN_VOICES, builtinVoice } from '../dsp/voice/builtin';
import { Emotion, EMOTIONS, withEmotion } from '../dsp/voice/emotion';
import { utterance } from '../dsp/voice/utterance';
import { fitVoice, FitProgress, FitResult, Material, PASSAGES } from '../dsp/voice/fit';
import { learntFor } from '../dsp/voice/interpret';

export type { VoiceDesign, Field, Phone, Emotion, VoicePrint, Clip, FitProgress, FitResult };
export type { Note, SingOptions, SungSyllable, SungNote, BeatTrack, BeatOptions, MixOptions, Stereo, Track };
export { sungPitch, melodyOf, pitchTrack };
export type { Melody, MelodyNote, MelodyOptions };
export { parseNotes, noteNumber, noteName, midiHz, transpose } from '../dsp/music/notes';
export { BEATBOX_KIT, DRUM_FAMILIES, drumSound, parsePattern, parseBeat, drumHit } from '../dsp/music/beat';
export type { DrumSound, DrumPart, DrumFamily, DrumHit, DrumHitOptions } from '../dsp/music/beat';
export { BEAT_PATTERNS } from '../dsp/music/patterns';
export { imitate } from '../dsp/music/imitate';
export type { Imitation, ImitateOptions } from '../dsp/music/imitate';
export type { BeatPattern } from '../dsp/music/patterns';
export { mixTracks as mix, downmix, arrange };
export type { Performance, Placed };
export { EMOTIONS, withEmotion, withField, sanitizeVoice, decodeWav };
export { voiceToJson, voiceFromJson, voiceToLink, voiceFromLink } from '../dsp/voice/codec';
export { setDeliveryModel, loadDeliveryModel, deliveryModel } from '../dsp/voice/interpret';
export type { DeliveryModel } from '../dsp/speech/deliveryNet';
export { setEnglishLexicon, loadEnglishLexicon } from '../dsp/speech/english';
export { SPEECH_LANGUAGES } from '../dsp/speech/languages';

// ------------------------------------------------------------- voices

/** The voices that come with the simulator: id, name and what they are. */
export const voiceList = (): { id: string; name: string; hint: string }[] => BUILTIN_VOICES.map((v) => ({ id: v.id, name: v.name, hint: v.hint }));

/** The knobs of a voice: path, tab, kind, range, unit, and what each one does. */
export const voiceKnobs = (): readonly Field[] => VOICE_FIELDS;

/** A knob of a voice, by its path ('speaking.f0', 'body.anatomy.scale', ...). */
export function knob(voice: Readonly<VoiceDesign>, path: string): number | boolean | string {
  const f = VOICE_FIELDS.find((x) => x.path === path);
  if (!f) throw new Error(`no knob ${path}`);
  return fieldValue(voice as VoiceDesign, f);
}

/**
 * A voice: a built-in one by its id, a voice of your own (a VoiceDesign or its
 * JSON, checked and kept in range), or the default, with knobs set on it by
 * path. Every knob is kept within its human range.
 */
export function createVoice(from?: string | Readonly<VoiceDesign> | object, knobs: Record<string, number | boolean | string> = {}): VoiceDesign {
  let d: VoiceDesign;
  if (from === undefined) d = cloneVoice();
  else if (typeof from === 'string') {
    const b = builtinVoice(from);
    if (!b) throw new Error(`no built-in voice ${from}: ${BUILTIN_VOICES.map((v) => v.id).join(', ')}`);
    d = cloneVoice(b.design);
  } else {
    const s = sanitizeVoice(from);
    if (!s) throw new Error('not a voice');
    d = s;
  }
  for (const [path, v] of Object.entries(knobs)) {
    if (!VOICE_FIELDS.some((f) => f.path === path)) throw new Error(`no knob ${path}`);
    d = withField(d, path, v);
  }
  return d;
}

// ------------------------------------------------------------- saying

export interface SpeakOptions {
  /** language of the text (a code of languages.ts); by default the voice's own, else Italian */
  lang?: string;
  /** an emotion on the voice, and how strong: 0 none, 1 as in the table, 2 stronger */
  emotion?: Emotion;
  strength?: number;
  /** sample rate, Hz (48000) */
  fs?: number;
  /** a living speaker: each seed a slightly different saying (none: the rules alone, the same every time) */
  seed?: number;
  /** silence kept after the last sound, s (0.25) */
  tail?: number;
  /** the loudest sample brought to this level, dBFS (none: as the engine makes it) */
  peak?: number;
}

export interface Speech {
  samples: Float32Array;
  fs: number;
  /** the sounds said, with their times, s; '_' is a pause */
  phones: { ipa: string; t0: number; t1: number }[];
  duration: number;
  /** whether its timing and melody came from a learnt delivery, or from the rules */
  delivery: 'learnt' | 'rules';
}

/**
 * A score played by the engine, from lungs at rest (as the score starts: a
 * render that started from the voice's own pressure would blow a puff and
 * a hum before the first sound, and again after the score ends), its
 * loudest sample brought to `peak` dBFS if asked.
 */
function render(params: EngineParams, score: Score, fs: number, tail: number, peak?: number): Float32Array {
  const atRest = { ...params, source: { ...params.source, ps: 0 } };
  const { out } = renderOffline(atRest, score.duration + tail, fs, score);
  if (peak !== undefined) {
    let mx = 0;
    for (const v of out) mx = Math.max(mx, Math.abs(v));
    if (mx > 0) { const g = 10 ** (peak / 20) / mx; for (let i = 0; i < out.length; i++) out[i] *= g; }
  }
  return out;
}

/** what a text is made of, in a language */
function phonesOf(input: string | Phone[], lang: string): Phone[] {
  if (Array.isArray(input)) return input;
  const ph = textToPhones(input, lang);
  if (!ph.length) {
    const other = speechLanguage(lang) && !ipaKind(input);
    throw new Error(other ? `no words of "${input}" known in ${lang} yet: call preparePhonemes first` : `nothing to say in "${input}"`);
  }
  return ph;
}

/**
 * A voice says a text (or phonemes: [IPA] as written, /IPA/ by the rules of
 * the language, or phones), with an emotion if asked. Everything is computed
 * here, sample by sample, by the physical model: about real time or faster.
 */
export function speak(voice: Readonly<VoiceDesign>, input: string | Phone[], opts: SpeakOptions = {}): Speech {
  const lang = opts.lang ?? (voice.language || 'it');
  const fs = opts.fs ?? 48000;
  const d = opts.emotion && opts.emotion !== 'neutral' ? withEmotion(voice, opts.emotion, opts.strength ?? 1) : voice;
  const u = utterance(d, phonesOf(input, lang), lang, opts.seed === undefined ? {} : { seed: opts.seed });
  const out = render(u.params, u.score, fs, opts.tail ?? 0.25, opts.peak);
  return {
    samples: out, fs, duration: out.length / fs,
    phones: u.score.phones.map((p) => ({ ipa: p.ipa, t0: p.t0, t1: p.t1 })),
    delivery: learntFor(d.speaking.delivery, lang) ? 'learnt' : 'rules',
  };
}

/** One turn of a dialogue: who says what. */
export interface Turn { voice: Readonly<VoiceDesign>; text: string | Phone[]; emotion?: Emotion; strength?: number; lang?: string }

/** Several voices taking turns, one after another, with a silence between them (`gap`, s), in one recording. */
export function dialogue(turns: Turn[], opts: Omit<SpeakOptions, 'emotion' | 'strength' | 'lang'> & { gap?: number } = {}): Speech {
  const fs = opts.fs ?? 48000, gap = Math.round((opts.gap ?? 0.35) * fs);
  const said = turns.map((t, i) => speak(t.voice, t.text, { ...opts, fs, lang: t.lang, emotion: t.emotion, strength: t.strength, peak: undefined, seed: opts.seed === undefined ? undefined : opts.seed + i }));
  const n = said.reduce((a, s) => a + s.samples.length, 0) + gap * Math.max(0, said.length - 1);
  const out = new Float32Array(n), phones: Speech['phones'] = [];
  let at = 0;
  said.forEach((s) => {
    out.set(s.samples, at);
    for (const p of s.phones) phones.push({ ipa: p.ipa, t0: p.t0 + at / fs, t1: p.t1 + at / fs });
    at += s.samples.length + gap;
  });
  if (opts.peak !== undefined) {
    let mx = 0;
    for (const v of out) mx = Math.max(mx, Math.abs(v));
    if (mx > 0) { const g = 10 ** (opts.peak / 20) / mx; for (let i = 0; i < out.length; i++) out[i] *= g; }
  }
  return { samples: out, fs, phones, duration: n / fs, delivery: said.every((s) => s.delivery === 'learnt') ? 'learnt' : 'rules' };
}

/** A 16-bit WAV file of what was said (mono), or of a mix (stereo). */
export const toWav = (s: { samples: ArrayLike<number>; fs: number } | Stereo): Uint8Array =>
  'left' in s ? encodeWavStereo(s.left, s.right, s.fs) : encodeWav(s.samples, s.fs);

// ------------------------------------------------------------- singing and beatbox

/**
 * A song for one voice: its notes (text as in parseNotes, or Note objects)
 * and its words (text in a language, [IPA], or phones; none: the vowel of
 * `vowel` on every note), with how it is sung (SingOptions).
 */
export interface Song extends SingOptions {
  notes: string | Note[];
  lyrics?: string | Phone[];
  lang?: string;
  /** the singer's ear: a first take is measured and the notes sung again in tune (true; false: one take, twice as fast) */
  tune?: boolean;
}

export interface Sung extends Performance {
  /** each syllable: its vowel, when it is sung (from its beat to the end of its notes), its notes */
  syllables: SungSyllable[];
  /** each note: its span, its pitch, the span of its vowel */
  notes: SungNote[];
  /** what did not fit (more notes than syllables, or the other way round) */
  warnings: string[];
}

/** A voice sings a song (see `Song`), with an emotion if asked. */
export function sing(voice: Readonly<VoiceDesign>, song: Song, opts: Omit<SpeakOptions, 'lang'> = {}): Sung {
  const lang = song.lang ?? (voice.language || 'it');
  const fs = opts.fs ?? 48000;
  const d = opts.emotion && opts.emotion !== 'neutral' ? withEmotion(voice, opts.emotion, opts.strength ?? 1) : voice;
  const notes = typeof song.notes === 'string' ? parseNotes(song.notes) : song.notes;
  const words = song.lyrics === undefined || (typeof song.lyrics === 'string' && !song.lyrics.trim()) ? [] : phonesOf(typeof song.lyrics === 'string' ? song.lyrics.replace(/(\p{L})-(?=\p{L})/gu, '$1') : song.lyrics, lang);
  const how = { ...song, seed: song.seed ?? opts.seed };
  let s = singScore(d, notes, words, lang, how);
  let out = render(s.params, s.score, fs, opts.tail ?? 0.4);
  // the singer's ear: a first take, each note measured, the notes off by more than a few cents sung again corrected
  if (song.tune !== false) {
    const off = sungPitch(out, fs, song.contour?.length ? meantNotes(s.notes, song.contour, s.beat0, song.transpose ?? 0) : s.notes);
    const fix = off.map((c) => (Number.isFinite(c) && Math.abs(c) > 6 ? Math.max(-1.5, Math.min(1.5, -c / 100)) : 0));
    if (fix.some((x) => x !== 0)) {
      s = singScore(d, notes, words, lang, { ...how, fix });
      out = render(s.params, s.score, fs, opts.tail ?? 0.4);
    }
  }
  if (opts.peak !== undefined) {
    let mx = 0;
    for (const v of out) mx = Math.max(mx, Math.abs(v));
    if (mx > 0) { const g = 10 ** (opts.peak / 20) / mx; for (let i = 0; i < out.length; i++) out[i] *= g; }
  }
  return { samples: out, fs, beat0: s.beat0, duration: out.length / fs, syllables: s.syllables, notes: s.notes, warnings: s.warnings };
}

/**
 * A voice beatboxes a beat written as text (see parseBeat: "b . ts . pf . ts
 * ^k") or as tracks, each a sound of its mouth (a sound of BEATBOX_KIT, or
 * any IPA) on a pattern of steps (x a hit, X an accent, o a soft one, .
 * nothing), all in one recording, dry. One mouth makes one sound at a time
 * unless `layered`.
 */
export function beatbox(voice: Readonly<VoiceDesign>, beat: string | readonly BeatTrack[], opts: BeatOptions = {}): Performance {
  const fs = opts.fs ?? 48000, pre = 0.1;
  const tracks = typeof beat === 'string' ? parseBeat(beat, opts.sounds) : beat;
  const { hits, length } = beatHits(voice, tracks, { ...opts, fs });
  if (!hits.length) throw new Error('no hit in the pattern');
  // the whole pattern lasts its steps, even when its last ones are empty
  const mono = mixTracks([...hits.map((h) => ({ ...h, at: (h.at ?? 0) + pre })), { samples: new Float32Array(1), fs, at: pre + length }], { room: 0, peak: null, tail: 0.3 });
  const samples = downmix(mono);
  return { samples, fs, beat0: pre, duration: samples.length / fs };
}

/** A part of an ensemble: a voice that sings a song, or beatboxes. */
export interface Part {
  voice: Readonly<VoiceDesign>;
  song?: Song;
  /** a beat as text (see parseBeat) or as tracks */
  beat?: string | BeatTrack[];
  startBeat?: number;
  gain?: number;
  pan?: number;
}

/** Several voices at once, at one tempo (sung, beatboxed, then arranged): see `arrange`. */
export function ensemble(parts: readonly Part[], opts: MixOptions & { tempo?: number; fs?: number; seed?: number; repeat?: number; swing?: number; humanize?: number } = {}): Stereo {
  const tempo = opts.tempo ?? 100, fs = opts.fs ?? 48000;
  return arrange(parts.map((p, i) => ({
    performance: p.song
      ? sing(p.voice, { ...p.song, tempo }, { fs, seed: opts.seed === undefined ? undefined : opts.seed + i })
      : beatbox(p.voice, p.beat ?? [], { tempo, fs, repeat: opts.repeat, swing: opts.swing, humanize: opts.humanize, seed: opts.seed }),
    startBeat: p.startBeat, gain: p.gain, pan: p.pan,
  })), { ...opts, tempo });
}

/**
 * Finds the words of a text in a language other than Italian and English
 * (its open pronunciation dictionary, then a small neural model for the
 * words it lacks): `sources` says where to get them (in the browser, see
 * ui/voice/phonemizerWeb.ts). Then `speak` reads it.
 */
export const preparePhonemes = (text: string, lang: string, sources: PhonemizerSources): Promise<void> => resolve(text, lang, sources);

// ------------------------------------------------------------- listening

/**
 * What a voice is like, measured over its recordings (one or more sentences):
 * its pitch and range, formants, the balance of its spectrum and of its
 * folds, the hiss of its consonants, its pace and pauses.
 */
export const analyse = (clips: Clip[]): VoicePrint => voicePrint(clips);

export interface FromRecordingsOptions {
  /** the language of the recordings */
  lang: string;
  /** what each recording says (better), or nothing: the voice then says a passage of its own */
  texts?: string[];
  /** the voice to start from (otherwise a man, a woman or a child by the pitch) */
  start?: VoiceDesign;
  /** 1 the full search, less a quicker one (0.3 .. 1) */
  effort?: number;
  onProgress?: (p: FitProgress) => void;
  stop?: () => boolean;
}

/**
 * A voice of the simulator brought toward recorded ones by measurement
 * (analysis by synthesis: fit.ts): a voice of the same kind, not a copy.
 * Slow: hundreds of sentences are said and measured.
 */
export function voiceFromRecordings(clips: Clip[], opts: FromRecordingsOptions): FitResult {
  const sameText = !!opts.texts?.length;
  if (sameText && opts.texts!.length !== clips.length) throw new Error('one text for each recording');
  const material: Material[] = sameText
    ? opts.texts!.map((t) => ({ phones: phonesOf(t, opts.lang), lang: opts.lang }))
    : (() => {
      const passage = PASSAGES[opts.lang];
      if (!passage) throw new Error(`no passage of its own in ${opts.lang}: give the texts of the recordings`);
      return [{ phones: phonesOf(passage, opts.lang), lang: opts.lang }];
    })();
  return fitVoice(voicePrint(clips), material, { sameText, start: opts.start, effort: opts.effort, onProgress: opts.onProgress, stop: opts.stop });
}
