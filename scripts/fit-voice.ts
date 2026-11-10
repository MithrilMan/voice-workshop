/**
 * Fits a voice of the simulator to recordings: measures them, says the same
 * text (or a passage of its own with --no-text) and moves the voice's fields
 * while the two come closer. Writes a .voice.json the studio imports.
 *   npx tsx scripts/fit-voice.ts list.json [--out=voice.voice.json] [--name=Name]
 *       [--start=woman] [--effort=0.5] [--no-text] [--compare=sky,woman]
 * list.json: [{ "file": "a.wav", "text": "What it says.", "lang": "en" }, ...]
 * (file relative to the list); WAV files, 16, 24 or 32 bit. The fit uses the
 * first recordings up to --seconds=12 of sound (each evaluation says them all).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { textToPhones } from '../src/dsp/speech/g2p';
import { setEnglishLexicon } from '../src/dsp/speech/english';
import { decodeWav } from '../src/dsp/util/wav';
import { voicePrint } from '../src/dsp/analysis/voiceprint';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { fitVoice, Material, PASSAGES, distance, say } from '../src/dsp/voice/fit';
import { sanitizeVoice, newVoiceId } from '../src/dsp/voice/design';
import { voiceToJson } from '../src/dsp/voice/codec';

setEnglishLexicon(gunzipSync(readFileSync(new URL('../public/lexicon/en-us.lex', import.meta.url))).toString('utf-8'));
const opt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const listPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!listPath) throw new Error('usage: fit-voice.ts list.json [--out=...] [--name=...] [--start=...] [--effort=...] [--no-text]');
const all = JSON.parse(readFileSync(listPath, 'utf-8')) as { file: string; text: string; lang: string }[];
const list: typeof all = [], clips: ReturnType<typeof decodeWav>[] = [];
let seconds = 0;
for (const e of all) {
  const c = decodeWav(new Uint8Array(readFileSync(join(dirname(listPath), e.file))));
  if (list.length && seconds + c.samples.length / c.fs > Number(opt('seconds') ?? 12)) continue;
  list.push(e); clips.push(c); seconds += c.samples.length / c.fs;
}
console.log(`${list.length} recording(s), ${seconds.toFixed(1)} s`);
const target = voicePrint(clips);
const sameText = !process.argv.includes('--no-text');
const lang = list[0]?.lang ?? 'en';
const material: Material[] = sameText
  ? list.map((e) => ({ phones: textToPhones(e.text, e.lang), lang: e.lang }))
  : [{ phones: textToPhones(PASSAGES[lang] ?? PASSAGES.en, PASSAGES[lang] ? lang : 'en'), lang: PASSAGES[lang] ? lang : 'en' }];
const start = opt('start') ? builtinVoice(opt('start')!)?.design : undefined;
for (const id of (opt('compare') ?? '').split(',').filter(Boolean)) {
  const d = builtinVoice(id)?.design;
  if (d) console.log(`${id}: distance ${distance(voicePrint(say(d, material, Math.min(24000, target.fs))), target, null, sameText).toFixed(2)}`);
}
const t0 = Date.now();
let last = '';
const res = fitVoice(target, material, {
  sameText, start, effort: Number(opt('effort') ?? 1),
  onProgress: (p) => {
    const line = `${p.stage.padEnd(7)} ${String(p.evaluations).padStart(3)}/${p.budget} distance ${p.distance.toFixed(2)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`;
    if (p.stage !== last || p.evaluations % 5 === 0) console.log(line);
    last = p.stage;
  },
});
console.log(`\ndistance ${res.startDistance.toFixed(2)} -> ${res.distance.toFixed(2)} in ${res.evaluations} evaluations, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const f = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : '-');
console.log('measure'.padEnd(22) + 'target'.padStart(9) + 'start'.padStart(9) + 'fitted'.padStart(9));
for (const m of res.measures) console.log(`${(m.label + ' (' + m.unit + ')').padEnd(22)}${f(m.target).padStart(9)}${f(m.start).padStart(9)}${f(m.now).padStart(9)}`);
const changed = (a: unknown, b: unknown, path = ''): string[] => {
  if (typeof a === 'object' && a && typeof b === 'object' && b) return Object.keys(a).flatMap((k) => changed((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return a !== b ? [`${path} ${String(b)} -> ${String(a)}`] : [];
};
console.log('\n' + changed(res.design, start ?? builtinVoice(res.design.body.anatomy.scale < 0.8 ? 'child' : res.target.f0 < 165 ? 'man' : 'woman')!.design).filter((l) => !l.startsWith('id ') && !l.startsWith('name ')).join('\n'));
const out = opt('out');
if (out) {
  const v = sanitizeVoice({ ...res.design, id: newVoiceId(), name: opt('name') ?? 'Fitted voice', notes: `Fitted by measurement to ${list.length} recording(s): distance ${res.startDistance.toFixed(2)} -> ${res.distance.toFixed(2)}.`, language: lang });
  writeFileSync(out, voiceToJson(v!));
  console.log(`\nwritten ${out}`);
}
