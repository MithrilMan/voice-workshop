import { describe, it, expect } from 'vitest';
import { createVoice, speak, sing, beatbox, arrange, mix, toWav, parseNotes, noteNumber, sungPitch, BEATBOX_KIT, BEAT_PATTERNS, drumHit, drumSound, parseBeat, melodyOf, pitchTrack, imitate } from '../src/library';
import { beatHits } from '../src/dsp/music/beat';
import { textToPhones } from '../src/dsp/speech/g2p';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';

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

describe('the melody of a recording', () => {
  it('finds the notes, rests, tempo and tuning of a sung tune', () => {
    const s = sing(createVoice('deep'), { notes: 'C3 G3 C3:0.5 G3:0.5 E3:2 | r C3:2', lyrics: 'dum dum dum dum dum dum', lang: 'it', tempo: 120, tune: false });
    const m = melodyOf(s.samples, s.fs);
    expect(m.text).toBe('C3 G3 C3:0.5 G3:0.5 E3:2 r C3:2');
    expect(Math.abs(m.tempo - 120)).toBeLessThanOrEqual(2);
    // the engine sings a little flat on [u] (held back by the lips): the tuning found says so
    expect(m.tuning).toBeLessThan(0);
    const d = sing(createVoice('child'), { notes: 'F4 G4 A4 F4 | F4 G4 A4 F4', lyrics: 'Fra Martino campanaro', lang: 'it', tempo: 110, transpose: 0.35, tune: false });
    const n = melodyOf(d.samples, d.fs);
    expect(n.text).toBe('F4 G4 A4 F4 F4 G4 A4 F4');
    expect(Math.abs(n.tuning - 35)).toBeLessThan(10);
  }, 120000);

  it('follows a whistle, and a voice sings its own pitch back', () => {
    // a whistle: a sine scooping into each note, with vibrato, 20 cents flat, at 96 beats a minute
    const fs = 32000, plan: [number | null, number][] = [[76, 0.625], [79, 0.625], [81, 1.25], [null, 0.625], [83, 0.625], [79, 0.3125], [74, 1.25]];
    const x = new Float32Array(Math.round(5.8 * fs));
    let t = 0.3, ph = 0;
    for (const [m, len] of plan) {
      const a = Math.round(t * fs), b = Math.round((t + len) * fs);
      if (m !== null) for (let i = a; i < b; i++) {
        const u = (i - a) / fs, f = 440 * 2 ** ((m - 0.2 - 0.8 * Math.exp(-u / 0.03) + (u > 0.2 ? 0.3 * Math.sin(2 * Math.PI * 5.5 * (u - 0.2)) : 0) - 69) / 12);
        ph += (2 * Math.PI * f) / fs;
        x[i] = 0.3 * Math.min(1, u / 0.015, (b - i) / fs / 0.03) * Math.sin(ph);
      }
      t += len;
    }
    const m = melodyOf(x, fs);
    expect(m.text).toBe('E5 G5 A5:2 r B5 G5:0.5 D5:2');
    expect(Math.abs(m.tempo - 96)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.tuning + 20)).toBeLessThan(6);
    // sung with the whistle's own pitch (its scoops and vibrato), at its own times
    const s = sing(createVoice('woman'), { notes: m.exact, contour: m.contour, tempo: m.tempo, vowel: 'u' });
    const sung = pitchTrack(s.samples, s.fs, 100, 2000).f0, off: number[] = [];
    for (const c of m.contour) {
      const g = sung[Math.round((c.t + s.beat0) / 0.01)];
      if (c.f0 > 0 && g > 0) off.push(Math.abs(1200 * Math.log2(g / c.f0)));
    }
    off.sort((a, b) => a - b);
    expect(off.length).toBeGreaterThan(300);
    expect(off[Math.floor(0.5 * off.length)]).toBeLessThan(15);
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

  it('reads a beat written as text', () => {
    const t = parseBeat('b . ts+m:C2 . pf! . [kʼ]? ^k');
    expect(t).toEqual([
      { sound: 'b', pattern: 'x.......' },
      { sound: 'ts', pattern: '..x.....' },
      { sound: 'm', f0: 'C2', pattern: '..x.....' },
      { sound: 'pf', pattern: '....X...' },
      { sound: 'kʼ', pattern: '......o.' },
      { sound: '^k', pattern: '.......x' },
    ]);
    // layers, one to a line
    const l = parseBeat('> b . . . pf . . .\n> ts ts ts ts ts ts ts ts');
    expect(l.find((x) => x.sound === 'ts')!.pattern).toBe('xxxxxxxx');
    expect(() => parseBeat('b q')).toThrow(/"q"/);
    expect(() => parseBeat('m:H2')).toThrow(/H2/);
    // every beat to start from reads, a bar of sixteen steps in every layer
    for (const p of BEAT_PATTERNS) for (const tr of parseBeat(p.beat)) expect(tr.pattern.length, p.id).toBe(16);
  });

  it('has a kit of every family, each sound read whole and set to its level', () => {
    expect(new Set(BEATBOX_KIT.map((k) => k.family)).size).toBe(7);
    expect(BEATBOX_KIT.length).toBeGreaterThanOrEqual(35);
    expect(new Set(BEATBOX_KIT.map((k) => k.code)).size).toBe(BEATBOX_KIT.length);
    const man = createVoice('man');
    for (const k of BEATBOX_KIT) {
      // the reader keeps every symbol: what is said is what is written, sound by sound
      expect(textToPhones(`[${k.ipa}]`, 'it').map((p) => p.ipa).join('').replace(/ː/g, ''), k.id).toBe(k.ipa.replace(/ː/g, '').replace('ʌ̆', 'ʌ').replace('ᵑǃ', 'ŋǃ'));
    }
    const at = (id: string) => { const k = drumSound(id)!; return drumHit(man, k.ipa, 24000, { f0: k.f0, f0End: k.f0End, hold: k.hold, level: -20 + k.level }); };
    const loud = (x: Float32Array, fs: number) => { const w = Math.round(0.02 * fs); let b = 0; for (let i = 0; i + w <= x.length; i += w >> 2) { let e = 0; for (let j = i; j < i + w; j++) e += x[j] * x[j]; b = Math.max(b, e / w); } return 10 * Math.log10(b); };
    const hat = at('hat');
    expect(loud(hat.samples, hat.fs)).toBeCloseTo(-28, 1);
    // an 808 kick rings on as a hum that falls
    const k8 = at('kick808'), f = pitchTrack(k8.samples, k8.fs, 30, 400).f0.filter((x) => x > 0);
    expect(f.length).toBeGreaterThan(8);
    expect(f[f.length - 1]).toBeLessThan(0.75 * f[0]);
  }, 120000);

  it('draws the air in for an inward sound', () => {
    // [k↓]: the lungs pull, and at the release the air rushes in through the mouth
    const u = utterance(createVoice('man'), textToPhones('[ak↓a]', 'it'), 'it');
    const e = new VoiceEngine(24000, { ...u.params, source: { ...u.params.source, ps: 0 } });
    e.snapArticulators(); e.snapPressure(); e.playScore(u.score);
    const buf = new Float32Array(120);
    let least = 0, inflow = 0;
    for (let t = 0; t < u.score.duration; t += 0.005) {
      e.process(buf, 120);
      const m = e.telemetry();
      least = Math.min(least, m.ps);
      inflow = Math.min(inflow, m.uMouth);
    }
    expect(least / 980).toBeLessThan(-3);
    expect(inflow).toBeLessThan(-200);
    // and the outward [k] does not
    expect(textToPhones('[k↓]', 'it')[0].ipa).toBe('k↓');
  });

  it('makes one sound at a time with one mouth, all at once when layered', () => {
    const man = createVoice('man'), step = 60 / 120 / 4;
    const one = beatHits(man, [{ sound: 'tss', pattern: 'x.x.' }], { tempo: 120, fs: 24000 });
    const all = beatHits(man, [{ sound: 'tss', pattern: 'x.x.' }], { tempo: 120, fs: 24000, layered: true });
    // the open hi-hat (some 280 ms) is cut where the next one strikes, two steps (250 ms) later
    const len = (t: { samples: ArrayLike<number>; fs: number }) => t.samples.length / t.fs;
    expect(len(one.hits[0])).toBeLessThan(2 * step + 0.02);
    expect(len(all.hits[0])).toBeGreaterThan(2 * step + 0.02);
    // a human's unevenness moves the hits by a few milliseconds
    const h = beatHits(man, [{ sound: 't', pattern: 'xxxxxxxx' }], { tempo: 120, fs: 24000, humanize: 1, seed: 3 });
    const late = h.hits.map((x, i) => (x.at ?? 0) - (h.hits[0].at ?? 0) - i * step);
    expect(Math.max(...late.map(Math.abs))).toBeGreaterThan(0.002);
    expect(Math.max(...late.map(Math.abs))).toBeLessThan(0.045);
  }, 120000);

  it('sets every hit on its step', () => {
    const tempo = 120, step = 60 / tempo / 4;
    const b = beatbox(createVoice('man'), [{ sound: 'pʼ', pattern: 'x.......x.......' }], { tempo });
    // where the sound strikes: the first millisecond within 12 dB of the loudest, near each step
    const ms = b.fs / 1000, env: number[] = [];
    for (let i = 0; i + ms <= b.samples.length; i += ms) env.push(level(b.samples, i, i + ms));
    const top = Math.max(...env);
    const strike = (from: number) => { let k = Math.round(from * 1000); while (env[k] < top - 12) k++; return k / 1000; };
    for (const s of [0, 8]) expect(Math.abs(strike(b.beat0 + s * step - 0.03) - (b.beat0 + s * step))).toBeLessThan(0.004);
    // a rimshot's mouth can tick as it closes, 100 ms and more before it lets go: the hit is its burst, not the tick
    // (seed 3 is a take that ticks)
    const r = beatbox(createVoice('man'), [{ sound: 'k', pattern: 'x...x...x...' }], { tempo, seed: 3, fs: 24000 });
    const ms2 = r.fs / 1000, env2: number[] = [];
    for (let i = 0; i + ms2 <= r.samples.length; i += ms2) env2.push(level(r.samples, i, i + ms2));
    const top2 = Math.max(...env2);
    for (const s of [0, 4, 8]) {
      const at = Math.round((r.beat0 + s * step) * 1000);
      // nothing in the 100 ms before its step (but the 12 ms each hit starts before it strikes), the burst on it
      expect(Math.max(...env2.slice(at - 100, at - 15))).toBeLessThan(top2 - 40);
      expect(Math.max(...env2.slice(at, at + 40))).toBeGreaterThan(top2 - 6);
    }
  });
});

describe('a sound of the mouth from a recording', () => {
  it('finds the kind of sound it was, and a bigger head as bigger', () => {
    const man = createVoice('man');
    const few = ['p', 'pʼ', 'kʼ', 'ts', 's', 'ʃ', 'f', 'ǃ', 'ʘ', 'mː', 'k↓'];
    // a sound of a head 15 % larger, said by the voice with another seed: the same sound, and a head larger than its own
    const big = drumHit(createVoice('man', { 'body.anatomy.scale': 1.15 }), 'ʃ', 48000, { seed: 5 });
    const a = imitate(man, big.samples, big.fs, { candidates: few });
    expect(a.sound.ipa).toBe('ʃ');
    expect(a.sound.knobs?.['body.anatomy.scale']).toBeGreaterThan(1.05);
    expect(a.distance).toBeLessThan(3);
    // a hum on 90 Hz: a nasal on its pitch
    const hum = drumHit(man, 'mː', 48000, { seed: 5, f0: 90 });
    const b = imitate(man, hum.samples, hum.fs, { candidates: few, refine: false });
    expect(b.sound.ipa).toBe('mː');
    expect(Math.abs(b.f0! - 90)).toBeLessThan(5);
    // a burst of noise, high and short, not of a mouth at all: a hiss
    const fs = 44100, x = new Float32Array(Math.round(0.4 * fs));
    let s = 7, prev = 0, y = 0;
    for (let i = Math.round(0.1 * fs); i < x.length; i++) { s = (s * 16807) % 2147483647; const w = (s / 2147483647) * 2 - 1; y = 0.6 * (y + w - prev); prev = w; x[i] = 0.4 * y * Math.exp(-(i / fs - 0.1) / 0.06); }
    const c = imitate(man, x, fs, { candidates: few, refine: false });
    expect(['ts', 's']).toContain(c.sound.ipa);
    expect(() => imitate(man, new Float32Array(48000), 48000)).toThrow(/no sound/);
  }, 120000);

  it('plays a sound of its own in a beat, by its code', () => {
    const mine = { ...BEATBOX_KIT.find((k) => k.id === 'hat')!, id: 'my1', code: 'my1', name: 'Yours 1', knobs: { 'body.anatomy.scale': 1.2 } };
    const t = parseBeat('b my1 b my1', [mine]);
    expect(t.map((x) => x.sound)).toEqual(['b', 'my1']);
    const p = beatbox(createVoice('man'), 'b my1 b my1', { sounds: [mine], fs: 24000 });
    expect(p.duration).toBeGreaterThan(0.6);
  }, 120000);
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
