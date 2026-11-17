import { store, ViewTab, ControlTab } from './store';
import { VOICE_PRESETS } from './presets';
import { voice, mriTube } from './voice/voice';
import type { EngineParams } from '../dsp/engine/params';
import { textToPhones } from '../dsp/speech/g2p';
import { buildScore } from '../dsp/speech/sequencer';
import { DEFAULT_SOURCE, DEFAULT_NOISE } from '../dsp/engine/params';
import { DEFAULT_ANATOMY } from '../dsp/tract/types';
import { transferMagnitudes, AcousticOptions } from '../dsp/tract/acoustics';
import { portArea, noseOf } from '../dsp/tract/nasal';
import { MRI_VOWELS } from '../dsp/data/mri';
import { isVowel } from '../dsp/speech/phonemes';
import { solveLF, rdToTiming, lfDerivative } from '../dsp/glottis/lf';
import type { NaturalnessOptions } from '../dsp/speech/sequencer';
export interface TourAction { label: string; run: () => void }
/** The quick controls a Learn step can show under the stage. */
export type QuickId = 'vowels' | 'consonants' | 'fricatives' | 'nasals' | 'pitch' | 'voices' | 'say' | 'mri' | 'nose';
/** A hint the Learn mode draws on the head: the handle to drag, and what to do with it. */
export interface HeadGuide { handle: 'tongue' | 'tip' | 'jaw' | 'lips' | 'velum'; text: string }

/**
 * One step of a lesson: one idea in a sentence or two, one view beside the
 * head, the sounds to try (the first is the main one), what to look at, and
 * the explanation on demand. Opening a step is silent: the head takes the
 * step's starting shape and nothing sounds until the reader asks.
 */
export interface Step {
  /** the idea, in a sentence or two */
  text: string;
  /** the view beside the head */
  view: ViewTab;
  /** the starting point, set silently when the step opens (posture, voice, view options) */
  setup?: () => void;
  /** the sounds to try, in order */
  try?: TourAction[];
  /** the hand to use: an arrow on the head */
  guide?: HeadGuide;
  /** what to watch or listen for, written on the view */
  look?: string;
  /** a strip of controls, when the step is about choosing */
  quick?: QuickId;
  /** the explanation behind it, on demand */
  why?: string;
  /** the live numbers behind it (with the Numbers switch on) */
  numbers?: () => string;
  /** a tool opened on the stage, beside the view; for the A/B tool, the experiment it starts on */
  tool?: { tab: ControlTab; ab?: string };
}
export interface Lesson { title: string; steps: Step[] }

/*
 * Every action of the tour is an explicit choice of the reader, so it takes
 * over whatever was playing (a sentence, a melody, a tube) before it acts.
 */
const set = (mut: (p: EngineParams) => void) => voice.edit(mut, { takeOver: true });
/** A step that follows by itself after a moment (cancelled by the next action). */
let pending: (() => void) | null = null;
const later = (ms: number, fn: () => void) => {
  const id = setTimeout(() => { pending = null; fn(); }, ms);
  pending = () => clearTimeout(id);
};
const clean = () => set((p) => {
  p.source = { ...DEFAULT_SOURCE };
  p.noise = { ...DEFAULT_NOISE, user: { ...p.noise.user, on: false } };
  p.anatomy = { ...DEFAULT_ANATOMY };
  p.voicing = true; p.bypassTract = false; p.tubeMode = false; p.abduction = 0;
});
/** Shapes the head as a phoneme without a sound (where a step starts). */
const pose = (v: string, f0?: number) => voice.holdPhoneme(v, { f0, blow: false });
/** Says a phoneme for a breath. */
const vowel = (v: string, f0?: number) => voice.holdPhoneme(v, { f0 });
const phoneme = (v: string) => voice.holdPhoneme(v);
/** Gives the head as it is a breath of voice. */
const blow = () => set((p) => { p.phonate = true; });
const preset = (id: string) => VOICE_PRESETS.find((x) => x.id === id)!;
/** Speaks a text; resolves 'done' when it has been heard to the end. */
const say = async (text: string, lang: 'it' | 'en') => {
  if (lang === 'en') await store.ensureLexicon();
  const p = voice.manual;
  return voice.speak(buildScore(textToPhones(text, lang), { lang, f0: p.source.f0, ps: Math.max(7, p.source.ps) }), text);
};
/** Speaks an English example of the lesson. */
const sayL = (text: string) => say(text, 'en');
/** Speaks two examples one after the other (the second only if the first was heard to the end). */
const sayTwo = async (a: () => Promise<'done' | 'stopped'>, b: () => Promise<'done' | 'stopped'>) => { if ((await a()) === 'done') await b(); };
/** Glides the pitch (a demonstration): the pitch slider follows and stays at the end value. */
const glide = (from: number, to: number, seconds: number) =>
  void voice.glide(from, to, seconds, `from ${Math.round(from)} to ${Math.round(to)} Hz`);

/** A number, with a true minus sign. */
const dec = (x: number, digits: number) => x.toFixed(digits).replace('-', '−');
const cm = (p: number) => dec(p / 980.665, 1);
/** The first three formants of the current shape (head or tube). */
const formantNumbers = (): string => {
  const f = store.derived().formants.slice(0, 3).map((x) => Math.round(x.f));
  return f.map((v, i) => `F${i + 1} ${v}`).join(' · ') + ' Hz';
};
/** The pitch and where its first harmonics fall. */
const harmonicNumbers = (): string => {
  const f0 = store.telemetry?.f0 ?? 0;
  if (f0 <= 0) return 'play a sound';
  const h = [1, 2, 3, 4].map((k) => Math.round(k * f0)).join(', ');
  const below = Math.floor(1000 / f0);
  return `F0 ${Math.round(f0)} Hz · harmonics at ${h}… Hz · ${below} below 1 kHz`;
};
/** Mouth and lung pressure, pitch and nasal airflow, from the running engine. */
const airNumbers = (): string => {
  const t = voice.live();
  if (!t) return 'play a sound';
  const f0 = t.f0 > 0 ? `${Math.round(t.f0)} Hz` : 'none (folds still)';
  return `mouth pressure ${cm(t.po)} cmH₂O, lungs ${cm(t.ps)} · nasal airflow ${Math.round(t.uNose)} cm³/s · F0 ${f0}`;
};
/** Loads one of the vowels measured by MRI as the tube, and blows through it. */
const mri = (ipa: string) => {
  const v = MRI_VOWELS.find((m) => m.ipa === ipa);
  if (v) voice.loadTube(v.areas, v.areas.length * v.dx, mriTube(ipa), { takeOver: true });
};
/** Peaks and valleys of the current filter below 3 kHz, nose included. */
let extremaCache: { key: unknown; value: string } | null = null;
const peakNumbers = (): string => {
  const d = store.derived(), p = voice.sounding();
  if (extremaCache?.key === d) return extremaCache.value;
  const fr: number[] = [];
  for (let f = 100; f <= 3000; f += 10) fr.push(f);
  const port = portArea(voice.sounding().articulators.velum, p.anatomy.nasalLeak, p.anatomy.scale);
  const mag = transferMagnitudes(d.af, fr, { port, scale: p.anatomy.scale, nose: noseOf(p.anatomy) });
  const poles: number[] = [], zeros: number[] = [];
  for (let i = 1; i < fr.length - 1; i++) {
    if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1]) poles.push(fr[i]);
    if (mag[i] < mag[i - 1] && mag[i] <= mag[i + 1]) zeros.push(fr[i]);
  }
  const value = `peaks ${poles.join(' · ')} Hz; valleys ${zeros.join(' · ') || 'none'} Hz`;
  extremaCache = { key: d, value };
  return value;
};
/** Where a side branch swallows the sound: the deepest dip of the filter with the branch relative to without it. */
let valleyCache: { key: unknown; value: { f: number; db: number } } | null = null;
const branchValley = (without: AcousticOptions, lo: number, hi: number): { f: number; db: number } => {
  const d = store.derived(), p = voice.sounding();
  const key = [d, JSON.stringify(without)].join();
  if (valleyCache?.key === key) return valleyCache.value;
  const fr: number[] = [];
  for (let f = lo; f <= hi; f += 10) fr.push(f);
  const port = portArea(voice.sounding().articulators.velum, p.anatomy.nasalLeak, p.anatomy.scale);
  const o: AcousticOptions = { port, scale: p.anatomy.scale, nose: noseOf(p.anatomy) };
  const a = transferMagnitudes(d.af, fr, o), b = transferMagnitudes(d.af, fr, { ...o, ...without });
  let value = { f: 0, db: 0 };
  for (let i = 0; i < fr.length; i++) {
    const db = 20 * Math.log10(a[i] / b[i]);
    if (db < value.db) value = { f: fr[i], db };
  }
  valleyCache = { key, value };
  return value;
};
/** Formants of a lateral and the valley of the cavity behind its tip. */
const lateralNumbers = (): string => {
  const f = formantNumbers(), sl = store.derived().af.supralingual;
  if (!sl || sl.at < 0) return `${f} · no closed cavity behind the tip`;
  const z = branchValley({ supralingual: false }, 2000, 5000);
  return `${f} · valley of the cavity behind the tip ${z.f} Hz (${dec(z.db, 0)} dB)`;
};
/** Air left in the piriform fossae and the valley they make. */
const piriformNumbers = (): string => {
  const pf = store.derived().geom.piriform;
  const z = branchValley({ piriform: false }, 3000, 9000);
  const air = `air in each fossa ${dec(pf.length, 1)} of ${dec(pf.full, 1)} cm`;
  if (z.db > -1) return `${air} · no valley`;
  return `${air} · their valley ${z.f} Hz (${dec(z.db, 0)} dB)`;
};
/** H1-H2 of the source pulse at the current Rd: the buzz before the filter. */
const sourceNumbers = (): string => {
  const s = voice.sounding().source;
  const sh = solveLF(rdToTiming(s.rd));
  const n = 256;
  const h = (k: number) => {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const v = lfDerivative(sh, i / n); re += v * Math.cos((2 * Math.PI * k * i) / n); im -= v * Math.sin((2 * Math.PI * k * i) / n); }
    return Math.hypot(re, im);
  };
  const d = 20 * Math.log10(h(1) / h(2));
  return `Rd ${dec(s.rd, 1)}, chink ${dec(s.chink, 2)} cm² · in the buzz alone the first harmonic exceeds the second (H1-H2) by ${dec(d, 1)} dB: about −2 pressed, 4 modal, 18 breathy`;
};
const NO_NATURAL: NaturalnessOptions = { timing: false, intonation: false, micro: false, voiceQuality: false, coarticulation: false };
/** Speaks an English example with some ingredients switched off. */
const sayWithout = async (text: string, off: Partial<NaturalnessOptions>) => {
  const lang = 'en';
  if (lang === 'en') await store.ensureLexicon();
  const p = voice.manual;
  return voice.speak(buildScore(textToPhones(text, lang), { lang, f0: p.source.f0, ps: Math.max(7, p.source.ps), natural: { ...off } }), text);
};
/** Duration of the first vowel of a word, in ms, as the sequencer plans it. */
const vowelMs = (word: string, lang: 'it' | 'en'): number => {
  const sc = buildScore(textToPhones(word, lang), { lang });
  const v = sc.phones.find((q) => isVowel(q.ipa));
  return v ? Math.round(1000 * (v.t1 - v.t0)) : 0;
};
const SENTENCE: string = 'every voice is made of air and a filter';
const spectrum = (o: { harmonics?: boolean; envelope?: boolean } = {}) => store.setUi({ showHarmonics: o.harmonics ?? true, envelope: o.envelope ?? true });

const LESSON_LIST: Lesson[] = [
  {
    title: 'A buzz and a filter',
    steps: [
      {
        text: 'Every voice is made of two ingredients: a buzz, born in the larynx, and a filter, the throat and the mouth, that colors it.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        try: [{ label: 'Hear an “ah”', run: () => vowel('a', 120) }],
        look: 'The spikes are the buzz; the hills over them are the filter.',
      },
      {
        text: 'Change only the filter: the tongue moves, the buzz stays the same.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        try: [
          { label: '“ah”', run: () => vowel('a', 120) },
          { label: '“ee”', run: () => vowel('i', 120) },
        ],
        look: 'The spikes stay where they are; the hills move.',
      },
      {
        text: 'This head is a physical model: the sound is computed from the air pressure in a tube that changes shape. Try it with your hands.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        guide: { handle: 'tongue', text: 'Drag the tongue' },
        look: 'While you drag, the voice sounds; when you stop, it rests after a breath.',
      },
    ],
  },
  {
    title: 'Waves, harmonics, spectrum',
    steps: [
      {
        text: 'Sound is tiny, fast changes in air pressure. In a vowel the same shape repeats over a hundred times a second.',
        view: 'scope', setup: () => { clean(); pose('a', 110); },
        try: [{ label: 'An “ah” at 110 Hz', run: () => vowel('a', 110) }],
        look: 'Each repeat of the shape is one beat of the vocal folds: 110 a second.',
      },
      {
        text: 'Any repeating shape is a sum of sine waves: the fundamental F0, and the harmonics at 2, 3, 4… times F0. The spectrum shows how strong each one is.',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum({ envelope: false }); },
        try: [{ label: 'An “ah” at 110 Hz', run: () => vowel('a', 110) }],
        look: 'A row of evenly spaced spikes, 110 Hz apart.',
        numbers: harmonicNumbers,
      },
      {
        text: 'Double the pitch: what happens to the spikes?',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum({ envelope: false }); },
        try: [
          { label: '110 Hz', run: () => vowel('a', 110) },
          { label: '220 Hz', run: () => vowel('a', 220) },
        ],
        look: 'Count the spikes below 1 kHz, before and after.',
        why: 'The harmonics always sit at exact multiples of the fundamental: at 110 Hz there are 9 below 1 kHz, at 220 Hz only 4 are left. Doubling the frequency is going up an octave: the spikes move twice as far apart, but you still hear an “ah”, because the filter has not changed.',
        numbers: harmonicNumbers,
      },
    ],
  },
  {
    title: 'The source: the vocal folds',
    steps: [
      {
        text: 'In the larynx sit two small folds. Lung air pushes them apart, their elasticity pulls them back: open, close, open, close.',
        view: 'glottis', setup: () => { clean(); pose('a', 110); },
        try: [{ label: 'Make the folds vibrate', run: () => vowel('a', 110) }],
        look: 'The folds in slow motion: each opening lets out a puff of air.',
      },
      {
        text: 'A fast train of puffs is the buzz. Here it is alone, without the throat and the mouth.',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum({ envelope: false }); },
        try: [
          { label: 'The buzz alone', run: () => { set((p) => { p.bypassTract = true; }); vowel('a', 110); } },
          { label: 'With the filter', run: () => { set((p) => { p.bypassTract = false; }); vowel('a', 110); } },
        ],
        look: 'Alone, the spikes fall off smoothly, with no hills: no vowel.',
      },
      {
        text: 'Stretch the folds and they vibrate faster: the pitch rises and every harmonic follows.',
        view: 'spectrum', setup: () => { clean(); pose('a', 100); spectrum(); },
        try: [{ label: 'From 100 to 220 Hz', run: () => { vowel('a', 100); glide(100, 220, 2); } }],
        look: 'The spikes fan out as the pitch rises.',
      },
      {
        text: 'Pressed or breathy voice: the same note, another color of the buzz.',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum({ envelope: false }); },
        try: [
          { label: 'Pressed', run: () => { clean(); set(preset('pressed').apply); vowel('a', 110); } },
          { label: 'Breathy', run: () => { clean(); set(preset('breathy').apply); vowel('a', 110); } },
        ],
        look: 'Compare the high harmonics, above 2 kHz.',
        why: 'In a pressed voice the folds close fast: each puff ends abruptly, and an abrupt end puts energy into the high harmonics. In a breathy voice they close gently and never fully: the first harmonic dominates, the high ones fade, and the leaking air adds a hiss.',
        numbers: sourceNumbers,
      },
      {
        text: 'When we talk the pitch never stays still: that is intonation. Played on the buzz alone you can follow the tune, but there are no words.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 110); },
        tool: { tab: 'melody' },
        look: 'Play the melody and watch the stripes rise and fall.',
      },
    ],
  },
  {
    title: 'The filter: throat, mouth and nose',
    steps: [
      {
        text: 'Above the larynx the sound passes through the throat and the mouth: a tube of air. Like any tube, it resonates.',
        view: 'tube', setup: () => { clean(); pose('ə', 110); store.setUi({ standing: 1 }); },
        try: [{ label: 'Blow through the tube', run: () => vowel('ə', 110) }],
        look: 'The waves that fit in the tube: its resonances.',
      },
      {
        text: 'The resonances are the formants: the peaks of the curve through the tips of the harmonics. F1, F2, F3.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        try: [{ label: 'An “ah”', run: () => vowel('a', 120) }],
        look: 'F1, F2 and F3 are marked on the peaks of the curve.',
        numbers: formantNumbers,
      },
      {
        text: 'The formants tell vowels apart. Open the jaw: what does F1 do?',
        view: 'chart', setup: () => { clean(); pose('ə', 120); set((p) => { p.articulators.jaw = 0.1; }); },
        guide: { handle: 'jaw', text: 'Open the jaw' },
        try: [
          { label: 'Jaw nearly closed', run: () => { pose('ə', 120); set((p) => { p.articulators.jaw = 0.1; p.phonate = true; }); } },
          { label: 'Jaw open', run: () => set((p) => { p.articulators.jaw = 0.9; p.phonate = true; }) },
        ],
        look: 'Follow the yellow dot on the map: F1 is the vertical axis.',
        why: 'Opening the jaw widens the mouth in front and narrows the throat behind: F1 goes up, here from about 420 to 620 Hz. Put simply, F1 tells how open the mouth is.',
        numbers: formantNumbers,
      },
      {
        text: 'Now the tongue, forward and back: F2 follows it.',
        view: 'chart', setup: () => { clean(); pose('i', 120); },
        guide: { handle: 'tongue', text: 'Pull the tongue back' },
        try: [
          { label: '“ee”', run: () => vowel('i', 120) },
          { label: '“oo”', run: () => vowel('u', 120) },
        ],
        look: 'The dot moves sideways: F2 is the horizontal axis.',
        why: 'F2 tells how far forward the tongue is: high in “ee”, with the tongue up against the palate, low in “oo”, with the tongue back and the lips rounded.',
        numbers: formantNumbers,
      },
      {
        text: 'Round your lips on an “ee”: the tube gets longer and its exit narrower.',
        view: 'spectrum', setup: () => { clean(); pose('i', 120); spectrum(); },
        guide: { handle: 'lips', text: 'Round the lips' },
        try: [
          { label: '“ee” with spread lips', run: () => vowel('i', 120) },
          { label: 'Lips rounded', run: () => set((p) => { p.articulators.lipRound = 1; p.articulators.lipProtrude = 1; p.articulators.lipOpen = 0.05; p.phonate = true; }) },
        ],
        look: 'F2 and F3 come down, and the sound darkens.',
        why: 'Rounded, forward lips lengthen the tube: every resonance goes down, F2 and F3 most (here F2 from 2260 to about 1950 Hz). An “ee” tongue with “oo” lips: the French “u”, the German “ü”.',
        numbers: formantNumbers,
      },
      {
        text: 'Part of the filter belongs to the person: a child has a shorter tract, so all of its formants are higher.',
        view: 'spectrum', setup: () => { clean(); pose('a'); spectrum(); },
        try: [
          { label: 'A man', run: () => { set(preset('man').apply); vowel('a'); } },
          { label: 'A child', run: () => { set(preset('child').apply); vowel('a'); } },
        ],
        look: 'The same vowel: every hill moves up.',
        numbers: formantNumbers,
      },
    ],
  },
  {
    title: 'Two independent knobs',
    steps: [
      {
        text: 'Keep the filter still and raise the pitch: the harmonics slide under the same hills.',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum(); },
        try: [{ label: 'Raise the pitch', run: () => { vowel('a', 110); glide(110, 260, 2.5); } }],
        look: 'The curve stays put; the spikes slide under it.',
      },
      {
        text: 'Keep the pitch still and change the filter: same note, another vowel.',
        view: 'spectrum', setup: () => { clean(); pose('a', 150); spectrum(); },
        try: [{ label: 'From “ah” to “ee”', run: () => { vowel('a', 150); later(900, () => phoneme('i')); } }],
        look: 'The spikes stay; the curve changes shape.',
      },
      {
        text: 'That is why you can sing higher and still sound like yourself: melody and color are two different knobs. Compare them side by side.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        tool: { tab: 'ab', ab: 'pitch' },
        look: 'Play A and B and compare their spectra.',
      },
    ],
  },
  {
    title: 'The hiss',
    steps: [
      {
        text: 'Not every sound comes from the folds. For “s” the air is squeezed through a narrow gap and hits the teeth: turbulence, a hiss.',
        view: 'spectrum', setup: () => { clean(); pose('s'); spectrum(); },
        try: [{ label: 'An “s”', run: () => phoneme('s') }],
        look: 'A broad hill above 4 kHz, and no spikes: noise has no harmonics.',
      },
      {
        text: 'Why does “sh” hiss lower than “s”?',
        view: 'spectrum', setup: () => { clean(); pose('s'); spectrum(); },
        try: [
          { label: '“s”', run: () => phoneme('s') },
          { label: '“sh” (ʃ)', run: () => phoneme('ʃ') },
          { label: '“f”', run: () => phoneme('f') },
        ],
        look: 'Where the hiss is strongest; and the tongue and the lips on the head.',
        why: 'The jet hits the incisors and the hiss takes its color from the cavity between the tongue and the lips. For “sh” the tongue sits further back and the lips round: the cavity is longer and resonates lower, near 3 kHz instead of the 4.5 kHz of “s”. “f” hisses between lip and teeth, with no cavity in front: flat and weak.',
        numbers: () => ('in this model: “s” peak 4.5 kHz, centroid 6.2 kHz; “sh” peak 3.1 kHz, centroid 4.0 kHz. Real speakers (Jongman et al. 2000): “s” centroid about 6 kHz, “sh” about 4'),
      },
      {
        text: 'Noise mixes into the voice too: in a breathy voice air leaks between the folds.',
        view: 'spectrum', setup: () => { clean(); pose('a', 110); spectrum({ envelope: false }); },
        try: [
          { label: 'Modal voice', run: () => { clean(); vowel('a', 110); } },
          { label: 'Breathy voice', run: () => { clean(); set(preset('breathy').apply); vowel('a', 110); } },
        ],
        look: 'A soft hiss fills the gaps between the harmonics.',
      },
      {
        text: 'And it is not steady: it pulses with each beat of the folds, strongest while they are open.',
        view: 'scope', setup: () => { clean(); pose('a', 110); },
        tool: { tab: 'ab', ab: 'pulse' },
        look: 'Play A and B: in the waveform the pulsed hiss comes in bursts.',
      },
    ],
  },
  {
    title: 'Consonants: closing and opening the tube',
    steps: [
      {
        text: 'Close the tube completely and the air piles up behind it; open it suddenly and it escapes in a small burst: a stop, like p, t, k.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [{ label: '“pop” and “Bob”', run: () => void sayTwo(() => sayL('pop'), () => sayL('Bob')) }],
        look: 'The burst is a thin vertical line; the gap before it is the closure.',
      },
      {
        text: 'It matters where it closes: the lips, the tip of the tongue, the back of the tongue.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [{ label: '“pa ta ka”', run: () => void sayL('pa ta ka') }],
        look: 'Each burst has its own color: where its energy falls.',
      },
      {
        text: 'Close the lips and keep voicing: where does the air go?',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        guide: { handle: 'lips', text: 'Close the lips' },
        try: [
          { label: '“ah”', run: () => vowel('a', 120) },
          { label: '“b”', run: () => phoneme('b') },
        ],
        look: 'The “buzz” meter under the head fades within a few tenths of a second.',
        why: 'With the lips shut the mouth fills up: in about two tenths of a second its pressure reaches the lung pressure, and the folds stop because no pressure difference is left to drive them. That is why a real “b” is short.',
        numbers: airNumbers,
      },
      {
        text: 'The English and the Italian “t”: it matters when the buzz comes back.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [
          { label: 'English “top”', run: () => void say('top', 'en') },
          { label: 'Italian “topo”', run: () => void say('topo', 'it') },
        ],
        look: 'After the burst: a patch of hiss before the stripes of the harmonics come back?',
        why: 'In English the folds stay apart for a moment: for 60-80 milliseconds only air comes out, then the voice returns. In Italian they come together at once and the voice returns after 10-30 milliseconds. This is the voice onset time (VOT), and on its own it can make an accent sound foreign.',
        numbers: () => ('in this model: English “t” 77 ms; Italian “p” 12, “t” 21, “k” 25 ms. Real speakers: English “t” about 70 ms (Lisker & Abramson 1964); Italian under about 30 ms, the “k” longest'),
      },
    ],
  },
  {
    title: 'The nose: a door and two passages',
    steps: [
      {
        text: 'Behind the palate sits the velum, a door to the nose. Lower it and close the lips: an “m”.',
        view: 'spectrum', setup: () => { clean(); pose('m'); spectrum(); },
        try: [{ label: 'Hum an “m”', run: () => phoneme('m') }],
        look: 'A low, muffled hum: one strong low peak, little above it.',
      },
      {
        text: 'A tube with a side branch swallows the sound at some frequencies: the valleys, the antiresonances.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        guide: { handle: 'velum', text: 'Lower the velum' },
        try: [
          { label: '“ah”', run: () => vowel('a', 120) },
          { label: 'Nasal “ah”', run: () => set((p) => { p.articulators.velum = 0.7; p.phonate = true; }) },
        ],
        look: 'With the velum down a valley opens in the curve.',
        numbers: peakNumbers,
      },
      {
        text: 'Pinch the nose while humming an “m”: the air has no way out.',
        view: 'spectrum', setup: () => { clean(); pose('m'); spectrum(); },
        try: [
          { label: 'Hum an “m”', run: () => phoneme('m') },
          { label: 'Pinch the nose', run: () => set((p) => { p.anatomy.nostrilLeft = 0; p.anatomy.nostrilRight = 0; p.phonate = true; }) },
        ],
        look: 'The “buzz” meter dies.',
        why: 'Lips closed and nose pinched: within a fraction of a second the mouth pressure reaches the lung pressure and the folds stop. Try it yourself: hum and pinch your nose. That is why with a cold “mommy” turns into something like “bobby”.',
        numbers: airNumbers,
      },
      {
        text: 'The nose has two passages, almost never equal: every few hours one side swells while the other shrinks, the nasal cycle.',
        view: 'spectrum', setup: () => { clean(); pose('m'); spectrum(); },
        try: [
          { label: 'Equal passages', run: () => { clean(); phoneme('m'); } },
          { label: 'Left side congested', run: () => set((p) => { p.anatomy.nasalCycle = -0.7; p.anatomy.nostrilLeft = 1; p.phonate = true; }) },
        ],
        look: 'With unequal passages a new peak appears near 2.2 kHz, with its valley.',
        why: 'Two paths of different width interfere: at some frequencies the waves reach the nostrils in step and add up, at others out of step and cancel. The ear barely notices, but it is one reason why every nose sounds a little different.',
        numbers: peakNumbers,
      },
      {
        text: 'In words the velum opens and closes in a moment.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [{ label: '“many men and women”', run: () => void sayL('many men and women') }],
        look: 'The nasals are the darker stretches, with a low band.',
      },
    ],
  },
  {
    title: 'Real tracts, measured',
    steps: [
      {
        text: 'How do we know a real vocal tract? With magnetic resonance imaging: slice by slice, the area of the air passage from the larynx to the lips.',
        view: 'tube', setup: () => { clean(); pose('a', 120); },
        try: [
          { label: 'The measured “ee”', run: () => mri('i') },
          { label: 'The measured “ɑ”', run: () => mri('ɑ') },
          { label: 'The measured “oo”', run: () => mri('u') },
        ],
        look: 'The profile from the throat (left) to the lips (right). These are 11 vowels of one man (Story 2008).',
        numbers: formantNumbers,
      },
      {
        text: 'The head was fitted to these shapes. The same vowel, two shapes:',
        view: 'tube', setup: () => { clean(); pose('ɑ', 120); },
        try: [
          { label: 'The measured “ɑ”', run: () => mri('ɑ') },
          { label: 'The head’s “ɑ”', run: () => { clean(); vowel('ɑ', 120); } },
        ],
        look: 'Compare the two profiles.',
        why: 'The shapes are alike but not the same: the head is a drawing with 13 controls, the scan a real person. F1 nearly agrees; F2 and F3 do not, because the head’s vowels are tuned to the averages of many men (Peterson & Barney 1952).',
        numbers: formantNumbers,
      },
      {
        text: 'The head builds every slice in three dimensions: the vault of the palate, the teeth at the sides, the groove of the tongue.',
        view: 'tract3d', setup: () => { clean(); pose('a', 120); },
        try: [{ label: 'An “ah”', run: () => vowel('a', 120) }],
        look: 'Drag to turn it, scroll to zoom.',
      },
      {
        text: 'In an “l” the tip closes only the middle: the air flows past both sides of the tongue.',
        view: 'tract3d', setup: () => { clean(); pose('l'); },
        try: [
          { label: 'An “l”', run: () => phoneme('l') },
          { label: 'An “n”', run: () => phoneme('n') },
        ],
        look: 'From the front or the top: two air channels beside the closed midline.',
        why: 'The margins of the tongue draw in and drop, and the air flows past the sides like water round a stone. Behind the contact a closed pocket is left, which swallows the sound between 3 and 4 kHz. In an “n” the sides stay sealed and the air goes up through the nose.',
        numbers: lateralNumbers,
      },
      {
        text: 'Beside the larynx hang two blind pouches, the piriform fossae: they swallow the sound near 4.5 kHz.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        try: [
          { label: 'Empty fossae', run: () => { set((p) => { p.anatomy.piriform = 1; }); vowel('a', 120); } },
          { label: 'Half full of water', run: () => set((p) => { p.anatomy.piriform = 0.5; p.phonate = true; }) },
        ],
        look: 'Switch to 0–10 kHz: the valley near 4.5 kHz jumps to near 8 kHz with water.',
        why: 'Each fossa is a little tube closed at the bottom, about 2 cm deep: it swallows the sound where a quarter of the wavelength fits inside. With water the air column is halved and the valley climbs. Dang and Honda (1997) did this for real, on real speakers.',
        numbers: piriformNumbers,
      },
    ],
  },
  {
    title: 'The spectrogram',
    steps: [
      {
        text: 'To see sound over time, cut it into short slices, take the spectrum of each and line them up: time runs to the right, frequency goes up.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [{ label: 'Speak a sentence', run: () => void sayL('a buzz, a hiss and a filter') }],
        look: 'Thin stripes: the harmonics. Bright bands: the formants. Fuzzy patches: the noise.',
      },
      {
        text: 'Long slices separate the harmonics but blur fast events; short slices catch every beat but merge the harmonics.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 40 }); },
        try: [
          { label: 'Long slices (40 ms)', run: () => { store.setUi({ specWindow: 40, mel: false }); void sayL('a hiss'); } },
          { label: 'Short slices (4 ms)', run: () => { store.setUi({ specWindow: 4, mel: false }); void sayL('a hiss'); } },
        ],
        look: 'With short slices vertical striations appear: one per beat of the folds.',
      },
      {
        text: 'The mel spectrogram bends frequency like the ear: 80 bands, on a log scale. It is what machine voices read.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ specWindow: 25, mel: true }); },
        try: [{ label: 'Log-mel, 80 bands', run: () => { store.setUi({ specWindow: 25, mel: true }); void sayL('a buzz and a hiss'); } }],
        look: 'The bands are narrow at the bottom and wide at the top: as in the ear.',
      },
    ],
  },
  {
    title: 'From sounds to sentences',
    steps: [
      {
        text: 'Speech is not a string of sounds: the tongue and the lips are always travelling, and every sound takes some color from its neighbours. Without it, the voice is a robot.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [
          { label: 'With every ingredient', run: () => void sayWithout(SENTENCE, {}) },
          { label: 'Robot style', run: () => void sayWithout(SENTENCE, NO_NATURAL) },
        ],
        look: 'Listen to the joins between the sounds.',
      },
      {
        text: 'Which ingredient do you miss most? Take them away one at a time.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [
          { label: 'No melody', run: () => void sayWithout(SENTENCE, { intonation: false, micro: false }) },
          { label: 'No timing', run: () => void sayWithout(SENTENCE, { timing: false }) },
          { label: 'No coarticulation', run: () => void sayWithout(SENTENCE, { coarticulation: false }) },
        ],
        look: 'What sounds mechanical each time?',
        why: 'Most people miss the melody first: on a flat pitch even perfect sounds seem robotic. Without coarticulation the joins jump; without the timing everything lasts the same, like a metronome. Naturalness is their sum.',
      },
      {
        text: 'Timing carries meaning too: how long does a vowel last?',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [
          { label: '“bead”', run: () => void sayL('bead') },
          { label: '“beat”', run: () => void sayL('beat') },
        ],
        look: 'The band of harmonics of the vowel: longer or shorter?',
        why: 'In Italian a stressed vowel in an open syllable stretches (“fa-to”) and shrinks before a double consonant (“fat-to”). In English a vowel lasts longer before a voiced consonant: “bead” more than “beat”. The ear uses such rules without noticing.',
        numbers: () => (`first vowel: “fato” ${vowelMs('fato', 'it')} ms, “fatto” ${vowelMs('fatto', 'it')} ms; “bead” ${vowelMs('bead', 'en')} ms, “beat” ${vowelMs('beat', 'en')} ms`),
      },
      {
        text: 'The melody falls at the end of a statement and rises in a yes/no question.',
        view: 'spectrogram', setup: () => { clean(); pose('a', 120); store.setUi({ mel: false, specWindow: 30 }); },
        try: [
          { label: 'A statement', run: () => void sayL('it is raining in the city today.') },
          { label: 'A question', run: () => void sayL('is it raining in the city today?') },
        ],
        look: 'At the end of the question the stripes of the harmonics go up.',
      },
    ],
  },
  {
    title: 'A machine voice',
    steps: [
      {
        text: 'A small speech model, the one of the “Teacher in the Loop” paper, builds a voice from the same ingredients: a melody, a buzz, a hiss and a filter.',
        view: 'spectrum', setup: () => { clean(); pose('a', 120); spectrum(); },
        tool: { tab: 'machine' },
        look: 'The panel shows the buzz part: nine sines locked to the pitch, a soft noise, a mix. The rest is a learned filter.',
      },
    ],
  },
];

const cancelling = (a: TourAction): TourAction => ({ ...a, run: () => { pending?.(); pending = null; a.run(); } });
export const LESSONS: Lesson[] = LESSON_LIST.map((l) => ({ ...l, steps: l.steps.map((s) => ({ ...s, try: s.try?.map(cancelling) })) }));

/**
 * Opens a step: whatever sounds stops, the view and the tool are the step's,
 * and the head takes the step's starting shape without a sound.
 */
export function openStep(s: Step): void {
  pending?.();
  pending = null;
  voice.stop();
  set((p) => { p.phonate = false; });
  store.setUi({ viewTab: s.view, learnTool: s.tool?.tab ?? null });
  s.setup?.();
}

/** Gives the head as it is a breath of voice (the step without sounds of its own). */
export const breath = blow;
