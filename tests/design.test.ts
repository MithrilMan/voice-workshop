import { describe, it, expect } from 'vitest';
import { defaultParams, EngineParams, DEFAULT_SOURCE, DEFAULT_NOISE } from '../src/dsp/engine/params';
import { DEFAULT_ANATOMY } from '../src/dsp/tract/types';
import { VOICE_FIELDS, VOICE_V1_BASE, VoiceDesign, cloneVoice, sanitizeVoice, speechOptions, withField, fieldValue } from '../src/dsp/voice/design';
import { BUILTIN_VOICES, builtinVoice } from '../src/dsp/voice/builtin';
import { voiceToJson, voiceFromJson, voiceToLink, voiceFromLink, voiceFileName } from '../src/dsp/voice/codec';
import { VOICE_PRESETS } from '../src/ui/presets';
import { textToPhones } from '../src/dsp/speech/g2p';
import { buildScore } from '../src/dsp/speech/sequencer';
import { utterance } from '../src/dsp/voice/utterance';

/** the speaker presets as they were written before they became voices */
const base = (p: EngineParams) => { p.source = { ...DEFAULT_SOURCE }; p.anatomy = { ...DEFAULT_ANATOMY }; p.noise = { ...DEFAULT_NOISE, user: p.noise.user }; p.voicing = true; p.abduction = 0; p.articulators.larynx = 0; };
const OLD: Record<string, (p: EngineParams) => void> = {
  man: (p) => { base(p); p.source.f0 = 110; },
  woman: (p) => { base(p); p.anatomy.scale = 0.87; p.anatomy.pharynx = 0.86; p.source.f0 = 210; p.source.rd = 1.3; p.source.chink = 0.03; p.source.peakArea = 0.09; },
  child: (p) => { base(p); p.anatomy.scale = 0.72; p.anatomy.pharynx = 0.8; p.source.f0 = 290; p.source.rd = 1.4; p.source.chink = 0.025; p.source.peakArea = 0.06; },
  deep: (p) => { base(p); p.anatomy.scale = 1.08; p.anatomy.pharynx = 1.1; p.anatomy.pharynxWidth = 1.2; p.articulators.larynx = -0.8; p.source.f0 = 80; p.source.rd = 0.85; },
  whisper: (p) => { base(p); p.voicing = false; p.abduction = 0.42; p.noise.aspiration = 4; },
  creak: (p) => { base(p); p.source.f0 = 48; p.source.rd = 0.45; p.source.diplophonia = 0.55; p.source.jitter = 5; p.source.shimmer = 10; p.source.ps = 5.5; },
  breathy: (p) => { base(p); p.source.chink = 0.12; p.source.rd = 2.2; },
  pressed: (p) => { base(p); p.source.rd = 0.4; p.source.ps = 11; p.source.chink = 0; },
  raspy: (p) => { base(p); p.source.model = 'twomass'; p.source.asym = 0.4; p.source.ps = 10; p.source.f0 = 120; p.source.chink = 0.02; },
};

describe('a voice as data', () => {
  it('the speaker presets are the same voices they were', () => {
    expect(VOICE_PRESETS.map((p) => p.id)).toEqual(Object.keys(OLD));
    for (const pr of VOICE_PRESETS) {
      const a = defaultParams(), b = defaultParams();
      a.articulators.jaw = b.articulators.jaw = 0.7;
      OLD[pr.id](a); pr.apply(b);
      expect(b, pr.id).toEqual(a);
    }
  });

  it('every field is in the voice, within its range, and every number of the voice has a field', () => {
    const paths = new Set(VOICE_FIELDS.map((f) => f.path));
    expect(paths.size).toBe(VOICE_FIELDS.length);
    for (const f of VOICE_FIELDS) {
      const v = fieldValue(VOICE_V1_BASE as VoiceDesign, f);
      expect(v, f.path).not.toBeUndefined();
      if (f.kind === 'number') { expect(v as number, f.path).toBeGreaterThanOrEqual(f.min!); expect(v as number, f.path).toBeLessThanOrEqual(f.max!); }
    }
    const leaves = (o: unknown, at = ''): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => leaves(v, at ? `${at}.${k}` : k)) : [at]);
    const loose = leaves(VOICE_V1_BASE).filter((p) => !paths.has(p) && !['format', 'version', 'id', 'name', 'notes', 'language'].includes(p));
    expect(loose).toEqual([]);
    for (const v of BUILTIN_VOICES) expect(sanitizeVoice(JSON.parse(JSON.stringify(v.design))), v.id).toEqual(v.design);
  });

  it('keeps only what a voice can be from anything that claims to be one', () => {
    expect(sanitizeVoice(null)).toBeNull();
    expect(sanitizeVoice({ name: 'no format' })).toBeNull();
    const d = sanitizeVoice({
      format: 'voice-workshop.voice', version: 7, id: '../../etc', name: 'x'.repeat(200) + '\u0007', evil: '<script>',
      body: { anatomy: { scale: 99, pharynx: 'wide', extra: 1 } }, phonation: { model: 'quantum', voicing: 'yes' }, speaking: { f0: -5, style: { flutter: Infinity } },
    })!;
    expect(d).not.toBeNull();
    expect(d.name.length).toBe(60);
    expect(d.id).toMatch(/^[a-z0-9-]+$/);
    expect(d.version).toBe(1);
    expect((d as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(d.body.anatomy.scale).toBe(1.18);
    expect(d.body.anatomy.pharynx).toBe(1);
    expect((d.body.anatomy as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(d.phonation.model).toBe('lf');
    expect(d.phonation.voicing).toBe(true);
    expect(d.speaking.f0).toBe(30);
    expect(d.speaking.style.flutter).toBe(25);
    expect(withField(d, 'habits.larynx', -9).habits.larynx).toBe(-1.2);
  });

  it('goes to a file and back', () => {
    for (const v of BUILTIN_VOICES) expect(voiceFromJson(voiceToJson(v.design as VoiceDesign))).toEqual(v.design);
    expect(voiceFromJson('not json')).toBeNull();
    expect(voiceFileName({ ...cloneVoice(), name: 'Voce di Nonna Lùcia!' })).toBe('voce-di-nonna-lucia.voice.json');
  });

  it('goes to a short link and back, and a broken or hostile link gives nothing', async () => {
    const lengths: number[] = [];
    for (const v of BUILTIN_VOICES) {
      const link = await voiceToLink(v.design as VoiceDesign);
      lengths.push(link.length);
      expect(await voiceFromLink(`#${link}`), v.id).toEqual(v.design);
    }
    // every field changed at once still makes a link of a few hundred characters
    let all = cloneVoice(builtinVoice('woman')!.design);
    for (const f of VOICE_FIELDS) if (f.kind === 'number') all = withField(all, f.path, f.min! + 0.37 * (f.max! - f.min!));
    all.name = 'Una voce con tutto cambiato'; all.notes = 'note';
    const big = await voiceToLink(all);
    expect(await voiceFromLink(`#lang=it&${big}`)).toEqual(all);
    expect(Math.max(...lengths)).toBeLessThan(200);
    expect(big.length).toBeLessThan(1200);
    for (const bad of ['', '#voice=', '#voice=v9.abc', '#voice=v1.!!!', '#voice=v1.AAAA', `#voice=v1u.${btoa('[1,2]')}`, `#voice=v1u.${'A'.repeat(40000)}`]) expect(await voiceFromLink(bad), bad).toBeNull();
  });

  it('speaks with its habits and its style', () => {
    const w = builtinVoice('whisper')!.design;
    const sc = buildScore(textToPhones('la luna', 'it'), speechOptions(w, 'it'));
    const a = sc.phones.find((p) => p.ipa === 'a')!;
    expect(sc.frames[Math.round((0.5 * (a.t0 + a.t1)) / 0.005)].abduction).toBeGreaterThanOrEqual(0.42);
    const deep = buildScore(textToPhones('la luna', 'it'), speechOptions(builtinVoice('deep')!.design, 'it'));
    expect(deep.frames[40].art!.larynx).toBeCloseTo(-0.8, 2);
  });

  it('one turn of a conversation: two voices say the same words, each with its own body and way of speaking', () => {
    const phones = textToPhones('la luna', 'it');
    const deep = utterance(builtinVoice('deep')!.design, phones, 'it');
    const child = utterance(builtinVoice('child')!.design, phones, 'it');
    expect(deep.voice).toBe('builtin-deep');
    expect(deep.params.phonate).toBe(true);
    expect(deep.params.anatomy.scale).toBeCloseTo(1.08, 6);
    expect(child.params.anatomy.scale).toBeCloseTo(0.72, 6);
    const mean = (u: typeof deep) => { const v = u.score.frames.filter((f) => f.ps > 1); return v.reduce((s, f) => s + f.f0, 0) / v.length; };
    expect(mean(child)).toBeGreaterThan(2.5 * mean(deep));
    // what the caller asks for wins over the voice
    expect(utterance(builtinVoice('deep')!.design, phones, 'it', { rate: 2 }).score.duration).toBeLessThan(0.7 * deep.score.duration);
  });
});
