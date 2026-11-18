import { describe, it, expect } from 'vitest';
import { createVoice, speak, sing, beatbox, arrange, mix, toWav, parseNotes, noteNumber, sungPitch, BEATBOX_KIT, BEAT_PATTERNS, drumHit, drumSound, parseBeat, melodyOf, pitchTrack, imitate, beatLoop, singing, downmix } from '../src/library';
import { beatHits, postureAt, airAt, type Motion } from '../src/dsp/music/beat';
import { MixStream } from '../src/dsp/music/mix';
import { textToPhones } from '../src/dsp/speech/g2p';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';

const level = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
};
/** how long a sound is heard: from its first to its last millisecond within 30 dB of its loudest, s */
const heard = (x: Float32Array, fs: number) => {
  const ms = Math.round(fs / 1000), env: number[] = [];
  for (let i = 0; i + ms <= x.length; i += ms) env.push(level(x, i, i + ms));
  const top = Math.max(...env), loud = env.map((e, i) => (e >= top - 30 ? i : -1)).filter((i) => i >= 0);
  return (loud[loud.length - 1] - loud[0]) / 1000;
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

  it('sings piece by piece the samples it sings whole, the ear correcting each note just ahead', () => {
    // a flat [u] the ear corrects, notes it leaves alone, and a take with no ear
    for (const song of [
      { notes: 'C5:3', lyrics: 'tu', lang: 'it', tempo: 100, vibrato: 0 },
      { notes: 'G4 C5:2 A4 F4:2', lyrics: 'tu u si u', lang: 'it', tempo: 100 },
      { notes: 'C4 D4 E4', lyrics: 'la la la', lang: 'it', tempo: 140, tune: false },
    ]) {
      const v = createVoice('woman'), whole = sing(v, song, { fs: 24000 }), s = singing(v, song, { fs: 24000 });
      expect(s.duration).toBeCloseTo(whole.duration, 6);
      expect(s.notes).toEqual(whole.notes);
      const out = new Float32Array(whole.samples.length);
      let at = 0;
      for (let p = s.next(0.1); p; p = s.next(0.07)) { out.set(p, at); at += p.length; }
      expect(at).toBe(whole.samples.length);
      let diff = 0;
      for (let i = 0; i < at; i++) diff = Math.max(diff, Math.abs(out[i] - whole.samples[i]));
      expect(diff, song.lyrics).toBe(0);
      // the mouth of the take heard, its posture and air every 5 ms or so, with the head of the voice
      const m = s.motion;
      expect(Math.abs(m.frames.length * m.hop - at / 24000)).toBeLessThan(m.hop);
      expect(m.air!.length).toBe(m.frames.length);
      expect(m.head!.anatomy.scale).toBe(v.body.anatomy.scale);
      expect(Math.max(...m.air!.map((x) => x?.voicingAmp ?? 0))).toBeGreaterThan(0.3);
    }
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

  it('makes a beat as a loop that goes round with no seam, as the same beat played on', () => {
    const v = createVoice('man'), fs = 24000, tempo = 120, step = 60 / tempo / 4;
    const o = { tempo, fs, peak: null, room: 0 };
    const beat = 'b . ts . pf . ts .';
    const l = beatLoop(v, beat, { ...o, passes: 2 });
    expect([l.steps, l.passes]).toEqual([8, 2]);
    expect(l.samples.length).toBe(Math.round(8 * 2 * step * fs));
    // away from its seam it is the beat played twice on, sample for sample
    const p = beatbox(v, beat, { tempo, fs, repeat: 2 });
    const pre = Math.round(p.beat0 * fs);
    let err = 0, top = 0;
    for (let i = Math.round(0.3 * fs); i < l.samples.length - Math.round(0.2 * fs); i++) {
      err = Math.max(err, Math.abs(l.samples[i] - p.samples[pre + i]));
      top = Math.max(top, Math.abs(l.samples[i]));
    }
    expect(err / top).toBeLessThan(1e-4);
    // a hum on the last step: one mouth, it ends where the first strikes again; layered, it rings on into the start
    const tracks = (hum: string) => [{ sound: 'b', pattern: 'x.......' }, { sound: 'm', pattern: hum }];
    const fast = { ...o, tempo: 200, passes: 1 };
    const alone = beatLoop(v, tracks('........'), fast), cut = beatLoop(v, tracks('.......x'), fast), rings = beatLoop(v, tracks('.......x'), { ...fast, layered: true });
    const diff = (a: Float32Array, b: Float32Array) => { let d = 0, t = 0; for (let i = 0; i < 0.06 * fs; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); t = Math.max(t, Math.abs(b[i])); } return d / t; };
    expect(diff(cut.samples, alone.samples)).toBeLessThan(1e-6);
    expect(diff(rings.samples, alone.samples)).toBeGreaterThan(0.01);
  });

  it('gives sounds struck together a mouth each (a hum may go under a click), each moved by its own sounds', () => {
    const v = createVoice('man'), fs = 24000, tempo = 120;
    const l = beatLoop(v, [
      { sound: 'b', pattern: 'x...x...' }, { sound: 'ts', pattern: '..x...x.' }, { sound: 'pf', pattern: 'x.......' },
      { sound: 'ǃ', pattern: '....x...' }, { sound: 'm', pattern: '....x...' },
    ], { tempo, fs, passes: 1 });
    // the snare strikes with the kick: a second mouth, which also clicks and hums under the click
    expect(l.mouths.length).toBe(2);
    expect(l.trackMouths).toEqual([0, 0, 1, 1, 1]);
    const m = l.mouths[0];
    expect(m.frames.length).toBe(Math.ceil(l.length / m.hop));
    const at = (t: number) => postureAt(m, ((t % l.length) + l.length) % l.length);
    for (const kick of [0, 0.5]) {
      // the lips shut before the kick is heard (from 40 ms before it), open again after it
      for (const dt of [-0.04, -0.02, -0.01]) expect(at(kick + dt).lipOpen, `${kick}${dt}`).toBeLessThan(0);
      expect(at(kick + 0.1).lipOpen).toBeGreaterThan(0.1);
    }
    // the tip of the tongue up for the hi-hat (struck at 0.25 and 0.75 s), the lips apart
    for (const hat of [0.25, 0.75]) {
      expect(Math.max(...[-0.04, -0.02, 0].map((dt) => at(hat + dt).tipY))).toBeGreaterThan(0.5);
      expect(at(hat).lipOpen).toBeGreaterThan(0.1);
    }
    // the air as it was made: the hiss of the hi-hat on the teeth, the hum through the nose, the second mouth silent between its sounds
    const air = (mm: Motion, t: number) => airAt(mm, ((t % l.length) + l.length) % l.length);
    expect(m.air!.length).toBe(m.frames.length);
    for (const hat of [0.25, 0.75]) expect(Math.max(...[0.02, 0.03, 0.04, 0.05].map((dt) => air(m, hat + dt)?.levels.obstacle ?? 0))).toBeGreaterThan(10);
    const hum = air(l.mouths[1], 0.57)!;
    expect(hum.uNose).toBeGreaterThan(100);
    expect(hum.voicingAmp).toBeGreaterThan(0.5);
    expect(air(l.mouths[1], 0.35)).toBeNull();
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

  it('hears a stop going into a long hiss that dies away as sounds in a row, held as long', () => {
    // "ptssss" into a microphone, by another voice: a [p], a [t], a long [s] fading over its second half,
    // the [p]'s air thumping on the capsule (35 Hz, four times as loud as the sound), a little background
    const fs = 48000, h = drumHit(createVoice('woman'), 'ptss', fs, { seed: 5, hold: 5 }), len = h.samples.length;
    const x = new Float32Array(len + Math.round(0.4 * fs)), at = Math.round(0.2 * fs);
    let peak = 0;
    for (const v of h.samples) peak = Math.max(peak, Math.abs(v));
    for (let i = 0; i < len; i++) x[at + i] = h.samples[i] * (i < 0.45 * len ? 1 : 1 - (0.85 * (i / len - 0.45)) / 0.55);
    // (how long the sound itself is heard, before the thump, 12 dB over it, and the background are added)
    const said = heard(x, fs);
    const p0 = at + Math.round(h.hit * fs);
    for (let i = 0; i < Math.round(0.08 * fs); i++) { const t = i / fs; x[p0 + i] += 4 * peak * Math.sin(2 * Math.PI * 35 * t) * Math.exp(-t / 0.02); }
    let s = 11;
    for (let i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] += 0.0015 * peak * ((s / 2147483647) * 2 - 1); }
    const r = imitate(createVoice('man'), x, fs);
    // not the [p] alone: a stop striking, then the hiss, its last sound held to the recording's length
    expect(r.sound.ipa).toMatch(/^[ptkbdɡʔ]/u);
    expect(r.sound.ipa).toMatch(/s$/u);
    expect(r.sound.hold).toBeGreaterThan(2.5);
    expect(Math.abs(heard(r.samples, r.fs) / said - 1)).toBeLessThan(0.2);
    expect(r.distance).toBeLessThan(3.5);
  }, 120000);

  it('hears an effect of several sounds as sounds in time, and plays it in a beat', () => {
    // by another voice: five ejective taps 150 ms apart, the last two softer, then a long [ʃ] dying away
    const at = [0, 0.15, 0.3, 0.45, 0.6, 0.78];
    const effect = { id: 'x', code: 'x', name: 'x', family: 'fx' as const, ipa: '', alternatives: [], level: 0, hint: '', parts: [
      ...at.slice(0, 5).map((t, i) => ({ at: t, ipa: 'kʼ', gain: i < 3 ? 0 : -6 })), { at: at[5], ipa: 'ʃ', hold: 6, fade: 0.5, gain: -3 }] };
    const h = drumHit(createVoice('woman'), effect, 48000, { seed: 5 });
    const x = new Float32Array(h.samples.length + 19200);
    x.set(h.samples, 9600);
    let s = 3;
    for (let i = 0; i < x.length; i++) { s = (s * 16807) % 2147483647; x[i] += 1e-4 * ((s / 2147483647) * 2 - 1); }
    const r = imitate(createVoice('man'), x, 48000);
    // six sounds, each struck within 10 ms of its time
    expect(r.events?.length).toBe(6);
    r.events!.forEach((e, i) => expect(Math.abs(e.at - at[i]), `sound ${i}`).toBeLessThan(0.01));
    // the taps alike, the last one a long hiss
    expect(new Set(r.events!.slice(0, 5).map((e) => e.ipa)).size).toBeLessThanOrEqual(2);
    expect(r.events![5].ipa).toMatch(/[ʃɕsçx]/u);
    expect(r.sound.parts).toHaveLength(6);
    expect(Math.abs(heard(r.samples, r.fs) / heard(r.target, r.fs) - 1)).toBeLessThan(0.25);
    expect(r.distance).toBeLessThan(5);
    // kept as a sound of one's own, it plays in a beat, its sounds at their times
    const mine = { ...r.sound, id: 'my1', code: 'my1' };
    const b = beatbox(createVoice('man'), 'my1 . . . . . . .', { sounds: [mine], fs: 24000, tempo: 100 });
    expect(b.duration).toBeGreaterThan(0.9);
  }, 240000);

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

  it('mixes tracks as they come, in pieces, as it mixes them whole', () => {
    const fs = 8000, rand = (n: number, s: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * s) * Math.exp(-i / n));
    const tracks = [
      { samples: rand(3000, 0.31), fs, at: 0.1, gain: -3, pan: -0.5 },
      { samples: rand(5000, 0.17), fs, at: 0.4, gain: 2, pan: 0.8 },
      { samples: rand(800, 0.9), fs, at: 1.5, pan: 0 },
    ];
    const whole = downmix(mix(tracks, { room: 0.3, size: 0.5, peak: null }));
    const m = new MixStream(tracks.map((t) => ({ gain: t.gain, pan: t.pan })), fs, { room: 0.3, size: 0.5, gain: 0.5 });
    const got: Float32Array[] = [], sent = tracks.map(() => 0);
    // the first track placed at once, the others when they start to come; pieces of every size, in turns
    m.place(0, tracks[0].at);
    for (let turn = 0; !m.done; turn++) {
      const k = turn % 3, t = tracks[k], n = Math.min(t.samples.length - sent[k], 97 + 211 * k);
      if (sent[k] === 0 && k > 0) m.place(k, t.at);
      if (n > 0) { m.feed(k, t.samples.subarray(sent[k], sent[k] + n)); sent[k] += n; }
      if (sent[k] >= t.samples.length) m.end(k);
      got.push(m.take());
      expect(turn).toBeLessThan(500);
    }
    const out = new Float32Array(got.reduce((s, x) => s + x.length, 0));
    let at = 0;
    for (const x of got) { out.set(x, at); at += x.length; }
    expect(out.length).toBe(whole.length);
    let d = 0, top = 0;
    for (let i = 0; i < out.length; i++) { d = Math.max(d, Math.abs(out[i] - 0.5 * whole[i])); top = Math.max(top, Math.abs(whole[i])); }
    expect(d / top).toBeLessThan(1e-6);
  });
});
