import { describe, it, expect } from 'vitest';
import { createVoice, speak, sing, beatbox, arrange, mix, toWav, parseNotes, noteNumber, sungPitch, BEATBOX_KIT, drumHit } from '../src/library';

const level = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
};

describe('notes as text', () => {
  it('reads names, lengths, rests and ties', () => {
    expect(noteNumber('C4')).toBe(60);
    expect(noteNumber('A4')).toBe(69);
    expect(noteNumber('Bb3')).toBe(58);
    expect(noteNumber('F#5')).toBe(78);
    const n = parseNotes('C4 D4:2 | r:0.5 ~E4:1/2 G4:1.5');
    expect(n).toEqual([
      { midi: 60, beats: 1 }, { midi: 62, beats: 2 }, { midi: null, beats: 0.5 }, { midi: 64, beats: 0.5, tie: true }, { midi: 67, beats: 1.5 },
    ]);
    expect(() => parseNotes('C4 H4')).toThrow(/H4/);
  });
});

describe('a voice from lungs at rest', () => {
  it('says a sentence without a puff before its first sound', () => {
    const s = speak(createVoice('man'), 'pane', { lang: 'it' });
    // the first 50 ms are the lead in, before the closure of the [p] lets go
    expect(level(s.samples, 0, Math.round(0.05 * s.fs))).toBeLessThan(-55);
    expect(level(s.samples, 0, s.samples.length)).toBeGreaterThan(-40);
  });
});

describe('singing', () => {
  const tune = 'F4 G4 A4 F4 | F4 G4 A4 F4:2';
  const words = 'Fra Martino campanaro';

  it('puts a syllable on each note, its vowel on the beat, in tune', () => {
    const s = sing(createVoice('woman'), { notes: tune, lyrics: words, lang: 'it', tempo: 120 });
    expect(s.warnings).toEqual([]);
    expect(s.syllables.map((y) => y.ipa).join(' ')).toBe('a a i o a a a o');
    // every vowel starts on its beat (within a frame or two) and holds most of its note
    for (const n of s.notes) {
      expect(Math.abs(n.v0 - n.t0)).toBeLessThan(0.012);
      expect(n.v1 - n.v0).toBeGreaterThan(0.45 * (n.t1 - n.t0));
    }
    const off = sungPitch(s.samples, s.fs, s.notes).filter(Number.isFinite);
    expect(off.length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...off.map(Math.abs))).toBeLessThan(15);
  }, 120000);

  it('hears a narrow vowel go flat and sings it again in tune', () => {
    // a held [u]: the air held back by the lips slows the folds (the engine's law), as in a real voice
    const song = { notes: 'C5:3', lyrics: 'tu', lang: 'it', tempo: 100, vibrato: 0 };
    const once = sing(createVoice('woman'), { ...song, tune: false });
    const tuned = sing(createVoice('woman'), song);
    const a = sungPitch(once.samples, once.fs, once.notes)[0], b = sungPitch(tuned.samples, tuned.fs, tuned.notes)[0];
    expect(a).toBeLessThan(-15);
    expect(Math.abs(b)).toBeLessThan(8);
  }, 120000);

  it('shares out syllables and notes that do not match, and says so', () => {
    const more = sing(createVoice('woman'), { notes: 'C4 D4 E4 F4', lyrics: 'la la', lang: 'it', tempo: 160, tune: false });
    expect(more.warnings[0]).toMatch(/more notes than syllables/);
    expect(more.syllables).toHaveLength(2);
    const fewer = sing(createVoice('woman'), { notes: 'C4 D4', lyrics: 'la la la la', lang: 'it', tempo: 160, tune: false });
    expect(fewer.warnings[0]).toMatch(/more syllables than notes/);
    expect(fewer.syllables).toHaveLength(4);
  }, 120000);
});

describe('beatbox', () => {
  it('has a kit of speech sounds', () => {
    expect(BEATBOX_KIT.find((k) => k.id === 'kick')!.ipa).toBe('pʼ');
    const h = drumHit(createVoice('man'), 'pʼ');
    // cut to itself: it strikes within a few milliseconds of its start and lasts well under half a second
    expect(h.hit).toBeGreaterThan(0.005);
    expect(h.hit).toBeLessThan(0.03);
    expect(h.samples.length / h.fs).toBeLessThan(0.4);
  });

  it('sets every hit on its step', () => {
    const tempo = 120, step = 60 / tempo / 4;
    const b = beatbox(createVoice('man'), [{ sound: 'pʼ', pattern: 'x.......x.......' }], { tempo });
    // where the sound strikes: the first millisecond within 12 dB of the loudest, near each step
    const ms = b.fs / 1000, env: number[] = [];
    for (let i = 0; i + ms <= b.samples.length; i += ms) env.push(level(b.samples, i, i + ms));
    const top = Math.max(...env);
    const strike = (from: number) => { let k = Math.round(from * 1000); while (env[k] < top - 12) k++; return k / 1000; };
    for (const s of [0, 8]) expect(Math.abs(strike(b.beat0 + s * step - 0.03) - (b.beat0 + s * step))).toBeLessThan(0.004);
  });
});

describe('mixing', () => {
  it('places, pans and normalises tracks, and writes stereo', () => {
    const fs = 8000, one = new Float32Array(fs).fill(0.1);
    const m = mix([{ samples: one, fs, at: 0, pan: -1 }, { samples: one, fs, at: 0.5, pan: 1 }], { room: 0, tail: 0, peak: -6 });
    expect(m.left.length).toBe(Math.round(1.5 * fs));
    // hard left: nothing on the right before the second track comes in
    expect(Math.max(...m.right.subarray(0, Math.round(0.45 * fs)).map(Math.abs))).toBe(0);
    expect(Math.max(...m.left.map(Math.abs))).toBeCloseTo(10 ** (-6 / 20), 5);
    const wav = toWav(m);
    expect(wav.length).toBe(44 + m.left.length * 4);
    expect(new DataView(wav.buffer).getUint16(22, true)).toBe(2);
  });

  it('a room keeps sounding after the dry sound ends', () => {
    const fs = 16000, click = new Float32Array(160).fill(0.5);
    const m = mix([{ samples: click, fs }], { room: 0.4, tail: 1, peak: null });
    expect(level(m.left, Math.round(0.3 * fs), Math.round(0.5 * fs))).toBeGreaterThan(-70);
  });

  it('brings performances in on their beats', () => {
    const fs = 8000, p = { samples: new Float32Array(800).fill(0.2), fs, beat0: 0.05, duration: 0.1 };
    const m = arrange([{ performance: p, startBeat: 0 }, { performance: p, startBeat: 2 }], { tempo: 120, room: 0, peak: null, tail: 0 });
    // the arrangement starts 0.5 s in; the second part's first beat is two beats (1 s) after the first's
    const first = m.left.findIndex((v) => v !== 0) / fs, second = (m.left.subarray(Math.round(0.9 * fs)).findIndex((v) => v !== 0) + Math.round(0.9 * fs)) / fs;
    expect(first).toBeCloseTo(0.45, 2);
    expect(second).toBeCloseTo(1.45, 2);
  });
});
