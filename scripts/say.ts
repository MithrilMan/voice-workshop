/**
 * Renders example sentences with the speech sequencer and prints their phones,
 * timing, pitch range and levels; with a folder argument it also writes WAVs.
 *   npx tsx scripts/say.ts [outDir] [--flat]
 *   npx tsx scripts/say.ts outDir en "any English sentence"
 * --woman uses the woman preset of the source panel (210 Hz, shorter tract);
 * --voice=deep speaks with a built-in voice, --voice=my.voice.json with a
 * voice saved from the studio (its body, folds, habits and way of speaking);
 * ACCENT=5 sets the pitch-accent height in semitones.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { renderOffline } from '../src/dsp/engine/engine';
import { defaultParams } from '../src/dsp/engine/params';
import { textToPhones } from '../src/dsp/speech/g2p';
import { setEnglishLexicon } from '../src/dsp/speech/english';
import { buildScore, NaturalnessOptions } from '../src/dsp/speech/sequencer';
import { encodeWav } from '../src/dsp/util/wav';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { voiceFromJson } from '../src/dsp/voice/codec';
import { utterance } from '../src/dsp/voice/utterance';

setEnglishLexicon(gunzipSync(readFileSync(new URL('../public/lexicon/en-us.lex', import.meta.url))).toString('utf-8'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SP = args[0];
const flat = process.argv.includes('--flat');
const woman = process.argv.includes('--woman');
const voiceArg = process.argv.find((a) => a.startsWith('--voice='))?.slice(8);
const design = voiceArg ? builtinVoice(voiceArg)?.design ?? voiceFromJson(readFileSync(voiceArg, 'utf-8')) : null;
if (voiceArg && !design) throw new Error(`${voiceArg}: not a built-in voice nor a voice file`);
const natural: Partial<NaturalnessOptions> = flat ? { timing: false, intonation: false, micro: false, voiceQuality: false, coarticulation: true } : {};
const items: [string, 'it' | 'en'][] = args[1] && args[2]
  ? [[args.slice(2).join(' '), args[1] as 'it' | 'en']]
  : [['sasso', 'it'], ['mamma', 'it'], ['voce', 'it'], ['la voce è fatta di aria che vibra', 'it'], ['papà, tutto bene?', 'it'], ['il carro corre sulla strada', 'it'],
    ['heed', 'en'], ['father', 'en'], ['a buzz, a hiss and a filter', 'en'], ['Every voice you have ever heard is made of just two ingredients.', 'en'],
    ['Is it raining in the city today?', 'en'], ['The little button on the water bottle', 'en']];
for (const [t, lang] of items) {
  const ph = textToPhones(t, lang);
  const accent = process.env.ACCENT ? { accent: Number(process.env.ACCENT) } : {};
  let p = defaultParams(), sc;
  if (design) ({ params: p, score: sc } = utterance(design, ph, lang, { natural, ...accent }));
  else {
    if (woman) { p.anatomy.scale = 0.87; p.anatomy.pharynx = 0.86; p.source.f0 = 210; p.source.rd = 1.3; p.source.chink = 0.03; p.source.peakArea = 0.09; }
    sc = buildScore(ph, { lang, natural, f0: p.source.f0, ...accent });
  }
  const t0 = performance.now();
  const { out } = renderOffline(p, sc.duration + 0.3, 48000, sc);
  let mx = 0, bad = 0;
  out.forEach((v) => { if (!Number.isFinite(v)) bad++; mx = Math.max(mx, Math.abs(v)); });
  const f0s = sc.frames.filter((f) => f.t < sc.duration).map((f) => f.f0);
  const syl = ph.filter((x) => ['vowel'].includes((x as { ipa: string }).ipa ? 'vowel' : '')).length;
  void syl;
  console.log(`${t}  [${lang}]  ${sc.duration.toFixed(2)} s, F0 ${Math.min(...f0s).toFixed(0)}-${Math.max(...f0s).toFixed(0)} Hz, peak ${mx.toFixed(2)}, bad ${bad}, ${(performance.now() - t0).toFixed(0)} ms`);
  console.log('   ' + sc.phones.map((q) => `${q.ipa}${Math.round((q.t1 - q.t0) * 1000)}`).join(' '));
  if (SP) writeFileSync(`${SP}/${flat ? 'flat-' : ''}${design ? `${design.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'voice'}-` : woman ? 'w-' : ''}${t.replace(/[^a-zà-ú]+/gi, '_').slice(0, 24)}.wav`, encodeWav(out, 48000));
}
