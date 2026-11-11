/**
 * Copy synthesis, to listen to: for each recording of a list, the recording
 * itself, a voice of the simulator saying the same text by its rules, the
 * same living (a seed), and then with the recording's timing, its timing
 * and melody, and its timing, melody and loudness. Writes WAV files and a
 * page that plays them side by side. With --cross, instead: the recording,
 * our copy with all three, the same with a sharper closure of the folds and
 * with the glottal hiss back at its default level, and our fine structure
 * through the recording's spectral envelope only in the passages of nasals,
 * liquids and fricatives. Other stretches: crossSynth's `where`.
 *   npx tsx scripts/copy-test.ts list.json [list2.json ...] [--voice=woman|file.voice.json]
 *       [--n=3] [--out=.ref/copy] [--cross] [--set=habits.precision=1,phonation.rd=1] [--losses=0.8] [--live=1] [--tau=0.8] [--mute=aspiration,...]
 * --set changes fields of the voice, --losses the engine's waveguide losses (to try what moves the copy toward the recording),
 * --mute=aspiration,frication,obstacle,burst switches noise sources of the engine off (to hear and measure what they add)
 * With --cross, --before=key keeps the files of an earlier run's column `key` as a column "before" (to hear a change of the model)
 * list.json: [{ "file": "a.wav", "text": "What it says.", "lang": "en" }, ...]
 * Without --voice, a list's own fitted voice (fit_auto_<name>.voice.json
 * next to it) if there is one, else the man's or the woman's by its pitch.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { textToPhones } from '../src/dsp/speech/g2p';
import { setEnglishLexicon } from '../src/dsp/speech/english';
import { decodeWav, encodeWav } from '../src/dsp/util/wav';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { voiceFromJson } from '../src/dsp/voice/codec';
import { VoiceDesign, withField } from '../src/dsp/voice/design';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { EngineParams, Score } from '../src/dsp/engine/params';
import { analyse, align, copyTiming, imposePitch, imposeLoudness, swell, crossSynth, Timing } from '../src/dsp/voice/copy';

setEnglishLexicon(gunzipSync(readFileSync(new URL('../public/lexicon/en-us.lex', import.meta.url))).toString('utf-8'));
const opt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const lists = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!lists.length) throw new Error('usage: copy-test.ts list.json [...] [--voice=...] [--n=3] [--out=.ref/copy]');
const cross = process.argv.includes('--cross');
const out = opt('out') ?? (cross ? '.ref/cross' : '.ref/copy');
mkdirSync(out, { recursive: true });
const N = Number(opt('n') ?? 3);

function render(params: EngineParams, score: Score, fs: number): Float32Array {
  const e = new VoiceEngine(fs, params);
  e.snapArticulators();
  e.playScore(score);
  const n = Math.round((score.duration + 0.15) * fs), y = new Float32Array(n);
  e.process(y, n);
  return y;
}

/** the same loudness for every version: the speech at -23 dB rms */
function level(x: Float32Array, fs: number): Float32Array {
  const hop = Math.round(0.01 * fs), e: number[] = [];
  for (let s = 0; s + hop <= x.length; s += hop) { let a = 0; for (let i = s; i < s + hop; i++) a += x[i] * x[i]; e.push(a / hop); }
  const top = Math.max(...e), speech = e.filter((v) => v > top * 10 ** -3.5);
  const rms = Math.sqrt(speech.reduce((a, b) => a + b, 0) / Math.max(1, speech.length));
  const g = rms > 0 ? 10 ** (-23 / 20) / rms : 1;
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v * g));
  const k = peak > 0.98 ? (0.98 / peak) * g : g;
  return Float32Array.from(x, (v) => v * k);
}

/** the return phase of the column with a sharper closure of the folds */
const SHARP = 0.55;
const VERSIONS: [string, string][] = cross
  ? [['orig', 'Originale'], ...(opt('before') ? [['before', 'Prima (la migliore della volta scorsa)'] as [string, string]] : []), ['all', 'Nostra, con tempi, melodia e volume copiati'], ['sharp', 'Nostra, le corde si chiudono più nette'], ['nobreath', 'Nostra, senza il soffio aggiunto dalla stima'], ['pothers', 'Nostra, inviluppo loro solo nei passaggi di nasali, liquide e fricative']]
  : [['orig', 'Originale'], ['rules', 'Le nostre regole'], ['living', 'Regole, viva'], ['timing', 'Tempi copiati'], ['melody', 'Tempi e melodia'], ['all', 'Tempi, melodia e volume'], ['mouth', 'Tutto copiato, bocca viva']];
const rows: { name: string; text: string; voice: string; files: string[] }[] = [];

for (const listPath of lists) {
  const items = JSON.parse(readFileSync(listPath, 'utf-8')) as { file: string; text: string; lang: string }[];
  const name = basename(listPath).replace(/^list_/, '').replace(/\.json$/, '');
  const own = join(dirname(listPath), `fit_auto_${name}.voice.json`);
  const v = opt('voice');
  for (const item of items.slice(0, N)) {
    const wav = decodeWav(new Uint8Array(readFileSync(join(dirname(listPath), item.file))));
    const fs = Math.min(24000, wav.fs);
    if (wav.fs !== fs) throw new Error(`${item.file}: ${wav.fs} Hz, only up to 24000 for now`);
    let d: VoiceDesign | null = v ? (existsSync(v) ? voiceFromJson(readFileSync(v, 'utf-8')) : builtinVoice(v)?.design ?? null) : existsSync(own) ? voiceFromJson(readFileSync(own, 'utf-8')) : null;
    const rec = { samples: wav.samples, fs };
    const recA = analyse(rec, true);
    if (!d) {
      const f = recA.f0.filter((x) => x > 0).sort((a, b) => a - b);
      d = builtinVoice(f[f.length >> 1] < 165 ? 'man' : 'woman')!.design;
    }
    for (const kv of (opt('set') ?? '').split(',').filter(Boolean)) { const [path, value] = kv.split('='); d = withField(d, path, Number(value)); }
    const phones = textToPhones(item.text, item.lang);
    const u = utterance(d, phones, item.lang);
    const tune = (params: typeof u.params) => {
      if (opt('losses')) params.losses = Number(opt('losses'));
      for (const k of (opt('mute') ?? '').split(',').filter(Boolean)) (params.noise as unknown as Record<string, boolean>)[`${k}On`] = false;
      return params;
    };
    tune(u.params);
    // the same voice with some fields changed (its sound only: the plan and the copied score stay)
    const voiceWith = (set: Record<string, number>) => { let d2 = d!; for (const [k, x] of Object.entries(set)) d2 = withField(d2, k, x); return tune(utterance(d2, phones, item.lang).params); };
    const rules = render(u.params, u.score, fs);
    const living = render(u.params, utterance(d, phones, item.lang, { seed: 1 + rows.length }).score, fs);
    const map = align(recA, analyse({ samples: rules, fs }));
    const recSeconds = wav.samples.length / fs;
    // --tau: the time constants of the slow articulators (tongue body and root, jaw, lip rounding) times this in the copies
    // (or one articulator at a time: --tau=jaw:1.6,tongueX:0.8)
    const tauOpt = opt('tau');
    const tau = !tauOpt ? undefined : tauOpt.includes(':') ? Object.fromEntries(tauOpt.split(',').map((kv) => { const [k, v] = kv.split(':'); return [k, Number(v)]; }))
      : Object.fromEntries(['tongueX', 'tongueY', 'tongueRoot', 'jaw', 'lipRound', 'lipProtrude'].map((k) => [k, Number(tauOpt)]));
    const plan = (ph: typeof phones, timing?: Timing) => utterance(d!, ph, item.lang, { ...(timing ? { timing } : {}), ...(tau ? { tauScale: tau } : {}) }).score;
    let copied = copyTiming(phones, plan, recA, map, recSeconds);
    // a pause the recording made and our text did not: aligned again with it
    if (copied.phones.some((p, i) => p.pause !== phones[i].pause)) copied = copyTiming(copied.phones, plan, recA, align(recA, analyse({ samples: render(u.params, plan(copied.phones), fs), fs })), recSeconds);
    const timed = copied.score;
    const timing = render(u.params, timed, fs);
    const sung = imposePitch(timed, recA);
    const melody = render(u.params, sung, fs);
    // twice: the level answers the pressure only roughly as the held vowel does
    const loud1 = imposeLoudness(sung, recA, analyse({ samples: melody, fs }, true));
    const loud = imposeLoudness(loud1, recA, analyse({ samples: render(u.params, loud1, fs), fs }, true));
    const all = render(u.params, loud, fs);
    // checks: on the copied timing the two line up; the copied melody is the recording's; the copied swell follows its loudness
    const lag = (m: (t: number) => number) => { const xs: number[] = []; for (let s = 0.15; s < recSeconds - 0.15; s += 0.05) xs.push(Math.abs(m(s) - s)); xs.sort((a, b) => a - b); return 1000 * xs[xs.length >> 1]; };
    const melA = analyse({ samples: melody, fs }, true), allA = analyse({ samples: all, fs }, true);
    const st: number[] = [];
    melA.f0.forEach((x, i) => { if (x > 0 && recA.f0[i] > 0) st.push(Math.abs(12 * Math.log2(x / recA.f0[i]))); });
    st.sort((a, b) => a - b);
    const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / Math.max(1, xs.length));
    const corr = (a: number[], b: number[]) => {
      const top = Math.max(...recA.level), ks = recA.level.map((l, i) => (l > top - 30 && i < a.length && i < b.length ? i : -1)).filter((i) => i >= 0);
      const ma = ks.reduce((s, i) => s + a[i], 0) / ks.length, mb = ks.reduce((s, i) => s + b[i], 0) / ks.length;
      let num = 0, da = 0, db = 0;
      for (const i of ks) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
      return num / Math.sqrt(da * db);
    };
    console.log(`  timing: median gap ${lag(map).toFixed(0)} ms by our rules, ${lag(align(recA, analyse({ samples: timing, fs }))).toFixed(0)} ms copied; pitch off by ${st.length ? st[st.length >> 1].toFixed(2) : '-'} st (median, ${st.length} frames); loudness against the recording r = ${corr(recA.level, melA.level).toFixed(2)} with its melody, ${corr(recA.level, allA.level).toFixed(2)} with its swell too; swell off by ${rms(swell(recA, melA)).toFixed(1)} -> ${rms(swell(recA, allA)).toFixed(1)} dB rms`);
    const k = rows.length;
    const files = VERSIONS.map(([key]) => `${name}_${k}_${key}.wav`);
    const allC = { samples: all, fs };
    // the copy with a living mouth (and breath and folds): a seed for the engine alone, the planner's work kept
    const mouth = render(u.params, { ...loud, seed: 1000 + rows.length, variation: Number(opt('live') ?? 1) }, fs);
    // on the recording's time, the passages: within 25 ms of the edge between two sounds, those
    // next to a stop or an affricate (its closing, its closure's edges, its release) and the others
    const STOP = /^[pbtdkgʔ]|^t[ʃs]|^d[ʒz]/;
    const ps = loud.phones, stop = (i: number) => i >= 0 && i < ps.length && STOP.test(ps[i].ipa);
    const edges = [{ t: ps[0].t0, stop: stop(0) }, ...ps.map((p, i) => ({ t: p.t1, stop: stop(i) || stop(i + 1) }))];
    const near = (which: (e: (typeof edges)[number]) => boolean) => (t: number) => edges.some((e) => which(e) && Math.abs(t - e.t) < 0.025);
    const passage = near(() => true), pStops = near((e) => e.stop), pOthers = (t: number) => passage(t) && !pStops(t);
    const before = opt('before'), was = join(out, `${name}_${k}_${before}.wav`);
    if (cross && before && existsSync(was)) copyFileSync(was, join(out, `${name}_${k}_before.wav`));
    const versions = cross ? [wav.samples, ...(before ? [null] : []), all, render(voiceWith({ 'phonation.returnPhase': SHARP }), loud, fs), render(voiceWith({ 'phonation.aspiration': 0 }), loud, fs), crossSynth(allC, rec, pOthers)] : [wav.samples, rules, living, timing, melody, all, mouth];
    versions.forEach((x, i) => { if (x) writeFileSync(join(out, files[i]), encodeWav(level(x, fs), fs)); });
    // the sounds of the copy, on the recording's time (for scripts/envelope-report.ts)
    writeFileSync(join(out, `${name}_${k}_phones.json`), JSON.stringify(loud.phones.map((p) => ({ ipa: p.ipa, t0: +p.t0.toFixed(4), t1: +p.t1.toFixed(4) }))));
    rows.push({ name, text: item.text, voice: d.name, files });
    console.log(`${name} ${k}: ${item.text} (${recSeconds.toFixed(2)} s; ours ${u.score.duration.toFixed(2)} s, copied ${timed.duration.toFixed(2)} s)`);
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${cross ? 'Sintesi incrociata' : 'Prova di copia'}</title>
<style>
body { font: 15px/1.45 system-ui, sans-serif; margin: 24px; background: #fafaf7; color: #222; }
h1 { font-size: 20px; } p { max-width: 70ch; }
.wrap { overflow-x: auto; } table { border-collapse: collapse; } td, th { padding: 6px 8px; border-bottom: 1px solid #ddd; vertical-align: top; text-align: left; }
th { font-weight: 600; font-size: 13px; } .t { min-width: 20ch; max-width: 30ch; font-size: 13px; } .v { color: #777; font-size: 12px; }
audio { width: 170px; height: 32px; }
</style></head><body>
${cross ? `<h1>Sintesi incrociata</h1>
<p>Le stesse frasi della prova di copia, con la nostra voce già sui tempi, sulla melodia e sul volume della registrazione.${opt('before') ? ' «Prima» è la colonna migliore della volta scorsa, rimasta com’era.' : ''} «Nostra» è il modello di adesso: il getto d'aria fruscia sui denti solo quando esce da un canale stretto e vicino a loro (le sibilanti, lo scoppio di una t), non più in [h] o nelle vocali; a fine frase i polmoni smettono di spingere invece di soffiare ancora 100 ms tra le corde aperte; la voce è stimata di nuovo dalle registrazioni, misurando anche quanto sono forti gli armonici sulle formanti. Le due colonne dopo cambiano una cosa sola: le corde che si chiudono più nette alla fine di ogni impulso (fase di ritorno ${SHARP} di quella che dà la loro forma: formanti alte più forti), oppure il soffio della glottide riportato al livello di partenza (la stima lo alza di 8 dB per avvicinare la periodicità della voce a quella delle registrazioni). L'ultima prende il loro inviluppo solo nei passaggi tra un suono e l'altro di nasali, liquide e fricative, con una dissolvenza di 20 ms.</p>` : `<h1>Prova di copia</h1>
<p>Ogni riga è una frase di una voce registrata. Da sinistra: la registrazione; la nostra voce che la dice con le sue regole; la stessa, viva (variabilità 1); con i tempi della registrazione; con i suoi tempi e la sua melodia; con tempi, melodia e volume. Tutte allo stesso volume medio. Se con tempi e melodia copiati la nostra suona molto più umana, il lavoro va sulla prosodia; se resta meccanica, sul suono.</p>`}
<div class="wrap"><table><tr><th>Frase</th>${VERSIONS.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
${rows.map((r) => `<tr><td class="t">${esc(r.text)}<div class="v">${esc(r.name)} · voce: ${esc(r.voice)}</div></td>${r.files.map((f) => `<td><audio controls preload="none" src="${f}"></audio></td>`).join('')}</tr>`).join('\n')}
</table></div></body></html>
`);
console.log(`written ${join(out, 'index.html')}`);
