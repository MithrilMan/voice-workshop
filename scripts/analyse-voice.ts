/**
 * A voice analysed over its sentences: recordings that come with their text
 * and the times of their sounds are measured sound by sound (delivery.ts),
 * a voice of the simulator says the same sentences by its own rules, and the
 * fields of its melody and rhythm are moved until the figures of the two
 * deliveries agree. Some sentences are kept out of the fit, to see whether
 * what was learnt holds on text the fit has not seen. Prints the figures,
 * writes the voice, and a page to listen to: the recording, the voice as it
 * was, the voice with the delivery from the analysis.
 *   npx tsx scripts/analyse-voice.ts list.json [list2.json ...] [--voice=file.voice.json] [--hold=3] [--n=4] [--out=.ref/delivery]
 * list.json: [{ "file": "a.wav", "text": "What it says.", "lang": "en" }, ...], with a.phones.json next to a.wav
 * ([{ "ipa": "h", "t0": 1.38, "t1": 1.41 }, ...]); the voice is the list's own fitted one
 * (fit_auto_<name>.voice.json next to it) unless --voice says another.
 * --hold=3: every third sentence is kept out of the fit (0: none). --n: how many sentences are rendered for the page (0: none).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { textToPhones, Phone } from '../src/dsp/speech/g2p';
import { setEnglishLexicon } from '../src/dsp/speech/english';
import { decodeWav, encodeWav } from '../src/dsp/util/wav';
import { builtinVoice } from '../src/dsp/voice/builtin';
import { voiceFromJson, voiceToJson } from '../src/dsp/voice/codec';
import { VoiceDesign } from '../src/dsp/voice/design';
import { utterance } from '../src/dsp/voice/utterance';
import { VoiceEngine } from '../src/dsp/engine/engine';
import { EngineParams, Score } from '../src/dsp/engine/params';
import { analyse, clock, copyTimingSaid, Analysis, Said, Timing } from '../src/dsp/voice/copy';
import { Saying, Delivery, sayingOf, heard, planned, deliveryOf, gapBetween, fitDelivery, deliveryDistance } from '../src/dsp/voice/delivery';

setEnglishLexicon(gunzipSync(readFileSync(new URL('../public/lexicon/en-us.lex', import.meta.url))).toString('utf-8'));
const opt = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const lists = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!lists.length) throw new Error('usage: analyse-voice.ts list.json [...] [--voice=file.voice.json] [--hold=3] [--n=4] [--out=.ref/delivery]');
const out = opt('out') ?? '.ref/delivery';
mkdirSync(out, { recursive: true });
const N = Number(opt('n') ?? 4), HOLD = Number(opt('hold') ?? 3);

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

/** the figures of a delivery, as they are printed and shown: key, what it is (for the page), unit, decimals */
const FIGURES: [keyof Delivery, string, string, number][] = [
  ['pitch', 'altezza mediana delle vocali', 'Hz', 0],
  ['range', 'estensione (dal 10° al 90° percentile)', 'st', 1],
  ['low', 'vocali basse sotto la mediana', 'st', 1],
  ['accent', 'vocale accentata sopra le vicine', 'st', 1],
  ['step', 'da una vocale alla successiva (rms)', 'st', 1],
  ['top', 'vocale più alta della frase sopra la mediana', 'st', 1],
  ['slope', 'andamento lungo la frase', 'st/s', 1],
  ['late', 'vocali oltre 1,5 s in una frase lunga, contro le prime', 'st', 1],
  ['endStop', 'ultima vocale prima del punto', 'st', 1],
  ['endQuestion', 'ultima vocale di una domanda sì/no', 'st', 1],
  ['endComma', 'ultima vocale prima della virgola', 'st', 1],
  ['rate', 'suoni al secondo', '/s', 1],
  ['stressLength', 'vocale accentata / non accentata, durata', '×', 2],
  ['lastLength', 'ultima vocale / le altre, durata', '×', 2],
  ['pauseComma', 'pausa alla virgola', 's', 2],
  ['pauseStop', 'pausa tra frasi', 's', 2],
  ['stressLevel', 'vocale accentata sopra le altre, volume', 'dB', 1],
  ['endLevel', 'ultima vocale contro le altre, volume', 'dB', 1],
];
const num = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '-');

interface Item { file: string; text: string; lang: string; phones: Phone[]; rec: { samples: Float32Array; fs: number }; recA: Analysis; theirs: Saying; held: boolean }

const sections: string[] = [];
for (const listPath of lists) {
  const dir = dirname(listPath), name = basename(listPath).replace(/^list_/, '').replace(/\.json$/, '');
  const own = join(dir, `fit_auto_${name}.voice.json`);
  const voicePath = opt('voice') ?? (existsSync(own) ? own : undefined);
  const voice: VoiceDesign = (voicePath ? voiceFromJson(readFileSync(voicePath, 'utf-8')) : null) ?? builtinVoice('woman')!.design;
  console.log(`\n== ${name}: ${voicePath ?? 'the woman'}`);

  // the recordings, sound by sound
  const items: Item[] = [];
  for (const it of JSON.parse(readFileSync(listPath, 'utf-8')) as { file: string; text: string; lang: string }[]) {
    const wav = join(dir, it.file), sidecar = wav.replace(/\.wav$/, '.phones.json');
    if (!existsSync(wav) || !existsSync(sidecar)) { console.log(`   (skipped, no recording or no times: ${it.file})`); continue; }
    const said: Said[] = (JSON.parse(readFileSync(sidecar, 'utf-8')) as { ipa?: string; ph?: string; t0: number; t1: number }[]).map((x) => ({ ipa: x.ipa ?? x.ph ?? '', t0: x.t0, t1: x.t1 }));
    const rec = decodeWav(readFileSync(wav)), recA = analyse(rec, true);
    const phones = textToPhones(it.text, it.lang);
    const plan = (ph: Phone[], timing?: Timing) => utterance(voice, ph, it.lang, timing ? { timing } : {}).score;
    const copied = copyTimingSaid(phones, plan, recA, said, 0);
    if (Math.abs(copied.score.duration - plan(phones).duration) < 1e-9) { console.log(`   (skipped, its sounds could not be matched: ${it.file})`); continue; }
    const i = items.length;
    items.push({ ...it, phones, rec, recA, theirs: sayingOf(phones, copied.score.phones, heard(recA)), held: HOLD > 0 && i % HOLD === HOLD - 1 });
  }
  const train = items.filter((x) => !x.held), held = items.filter((x) => x.held);
  const say = (d: VoiceDesign, set: Item[]): Saying[] => set.map((x) => { const u = utterance(d, x.phones, x.lang); return sayingOf(x.phones, u.score.phones, planned(u.score)); });

  // the fit, on the sentences it may see
  const target = deliveryOf(train.map((x) => x.theirs));
  const t0 = Date.now();
  const fit = fitDelivery(target, voice, (d) => deliveryOf(say(d, train)));
  console.log(`   ${train.length} sentences fitted, ${held.length} kept out; ${fit.evaluations} plans of them in ${((Date.now() - t0) / 1000).toFixed(0)} s; distance ${fit.from.toFixed(2)} -> ${fit.to.toFixed(2)}`);
  const rows: string[] = [];
  console.log(`   ${'figure'.padEnd(14)} ${'recording'.padStart(10)} ${'before'.padStart(8)} ${'after'.padStart(8)}`);
  for (const [k, label, unit, d] of FIGURES) {
    const plain = k === 'stressLevel' || k === 'endLevel';
    console.log(`   ${k.padEnd(14)} ${num(target[k], d).padStart(10)} ${(plain ? '' : num(fit.start[k], d)).padStart(8)} ${(plain ? '' : num(fit.end[k], d)).padStart(8)} ${unit}`);
    rows.push(`<tr><td>${label}</td><td>${num(target[k], d)}</td><td>${plain ? '' : num(fit.start[k], d)}</td><td>${plain ? '' : num(fit.end[k], d)}</td><td>${unit}</td></tr>`);
  }
  const short = (path: string) => path.slice(path.lastIndexOf('.') + 1);
  const knobs = fit.fields.map((f) => `${short(f.path)} ${num(f.from, 2)} -> ${num(f.to, 2)}${f.limit ? ' (at its limit)' : ''}`);
  const knobsPage = fit.fields.filter((f) => Math.abs(f.to - f.from) > 1e-9).map((f) => `${short(f.path)} ${num(f.from, 2)} → ${num(f.to, 2)}${f.limit ? ' <strong>(al limite)</strong>' : ''}`);
  console.log(`   fields: ${knobs.join(', ')}`);

  // sound by sound against the recording, on what the fit saw and on what it did not
  const gaps: string[] = [];
  for (const [label, set] of [['fitted', train], ['kept out', held]] as [string, Item[]][]) {
    if (!set.length) continue;
    const th = set.map((x) => x.theirs), a = gapBetween(say(voice, set), th), b = gapBetween(say(fit.voice, set), th);
    const dist = [deliveryDistance(deliveryOf(say(voice, set)), deliveryOf(th)), deliveryDistance(deliveryOf(say(fit.voice, set)), deliveryOf(th))];
    console.log(`   ${label} (${set.length}): pitch of the vowels ${a.pitch.toFixed(2)} -> ${b.pitch.toFixed(2)} st rms (together ${a.together.toFixed(2)} -> ${b.together.toFixed(2)}, ${b.vowels} vowels), lengths ${a.length.toFixed(2)} -> ${b.length.toFixed(2)} (${b.sounds} sounds), figures ${dist[0].toFixed(2)} -> ${dist[1].toFixed(2)}`);
    gaps.push(`<tr><td>${label === 'fitted' ? 'frasi usate per la stima' : 'frasi tenute fuori'} (${set.length})</td><td>${a.pitch.toFixed(2)} → ${b.pitch.toFixed(2)} st</td><td>${a.together.toFixed(2)} → ${b.together.toFixed(2)}</td><td>${a.length.toFixed(2)} → ${b.length.toFixed(2)}</td><td>${dist[0].toFixed(2)} → ${dist[1].toFixed(2)}</td></tr>`);
  }

  const fitted: VoiceDesign = { ...fit.voice, name: `${name}-delivery`, notes: `Melody and rhythm from an analysis of ${train.length} recording(s): distance ${fit.from.toFixed(2)} -> ${fit.to.toFixed(2)}.` };
  writeFileSync(join(out, `delivery_${name}.voice.json`), voiceToJson(fitted));

  // to listen to: the sentences kept out first
  const chosen = [...held, ...train].slice(0, N);
  const audio: string[] = [];
  const heardNow: { theirs: Saying[]; before: Saying[]; after: Saying[] } = { theirs: [], before: [], after: [] };
  for (const x of chosen) {
    const fs = x.rec.fs, stem = x.file.replace(/\.wav$/, '');
    writeFileSync(join(out, `${stem}.orig.wav`), encodeWav(level(x.rec.samples, fs), fs));
    heardNow.theirs.push(x.theirs);
    for (const [key, d] of [['before', voice], ['after', fit.voice]] as [('before' | 'after'), VoiceDesign][]) {
      const u = utterance(d, x.phones, x.lang), y = render(u.params, u.score, fs);
      writeFileSync(join(out, `${stem}.${key}.wav`), encodeWav(level(y, fs), fs));
      const a = analyse({ samples: y, fs }, true);
      heardNow[key].push(sayingOf(x.phones, u.score.phones, heard(a, clock(u.score.phones, a))));
    }
    audio.push(`<tr><td>${x.text}${x.held ? ' <em>(tenuta fuori dalla stima)</em>' : ''}</td>${['orig', 'before', 'after'].map((k) => `<td><audio controls preload="none" src="${stem}.${k}.wav"></audio></td>`).join('')}</tr>`);
    console.log(`   rendered: ${x.text}`);
  }
  let check = '';
  if (chosen.length) {
    const a = gapBetween(heardNow.before, heardNow.theirs), b = gapBetween(heardNow.after, heardNow.theirs);
    const da = deliveryOf(heardNow.before), db = deliveryOf(heardNow.after), dt = deliveryOf(heardNow.theirs);
    console.log(`   as heard (${chosen.length} rendered): pitch of the vowels ${a.pitch.toFixed(2)} -> ${b.pitch.toFixed(2)} st rms (together ${a.together.toFixed(2)} -> ${b.together.toFixed(2)}), figures ${deliveryDistance(da, dt).toFixed(2)} -> ${deliveryDistance(db, dt).toFixed(2)}`);
    for (const [k, , unit, d] of FIGURES) console.log(`   heard ${k.padEnd(14)} ${num(dt[k], d).padStart(10)} ${num(da[k], d).padStart(8)} ${num(db[k], d).padStart(8)} ${unit}`);
    check = `<p>Misurato sull’audio delle ${chosen.length} frasi qui sotto (non sul piano): altezza delle vocali ${a.pitch.toFixed(2)} → ${b.pitch.toFixed(2)} st di scarto dalla registrazione, andamento insieme ${a.together.toFixed(2)} → ${b.together.toFixed(2)}; volume: vocale accentata sopra le altre ${num(dt.stressLevel, 1)} dB nella registrazione, ${num(db.stressLevel, 1)} dB la nostra; ultima vocale ${num(dt.endLevel, 1)} dB, la nostra ${num(db.endLevel, 1)} dB (il volume è solo misurato, non ancora stimato).</p>`;
  }
  sections.push(`<h2>${name}</h2>
<table class="fig"><tr><th>misura</th><th>registrazione</th><th>nostra, com’era</th><th>nostra, dall’analisi</th><th></th></tr>${rows.join('')}</table>
<table class="fig"><tr><th>suono per suono contro la registrazione</th><th>altezza delle vocali (scarto)</th><th>andamento insieme (−1..1)</th><th>durate (scarto, in rapporto)</th><th>distanza delle misure</th></tr>${gaps.join('')}</table>
<p>Manopole mosse: ${knobsPage.join(', ') || 'nessuna'}.${fit.fields.some((f) => f.limit) ? ' «Al limite»: la manopola è arrivata in fondo alla sua corsa e le misure chiedevano di più.' : ''}</p>${check}
<table><tr><th>frase</th><th>Originale</th><th>Nostra, com’era</th><th>Nostra, melodia e ritmo dall’analisi</th></tr>${audio.join('')}</table>`);
}

writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="it"><meta charset="utf-8"><title>Analisi di una voce</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:2em auto;padding:0 1em;color:#222}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ccc;padding:.3em .6em;text-align:left;vertical-align:middle}table.fig td:nth-child(n+2){text-align:right}audio{width:230px}h2{margin-top:2em}</style>
<h1>Analisi di una voce su più frasi</h1>
<p>Ogni registrazione è misurata suono per suono (altezza, durata e volume di ogni vocale, con i tempi dei suoni che la accompagnano); da lì escono le misure del modo di dire della voce. La nostra voce dice le stesse frasi con le sue regole, e le manopole di melodia e ritmo vengono mosse finché le sue misure sono quelle della registrazione. Non è una copia frase per frase: la colonna «dall’analisi» legge con le regole, e legge così anche un testo mai sentito. Le frasi segnate «tenuta fuori» non sono state usate per la stima.</p>
${sections.join('\n')}
</html>`);
console.log(`\npage: ${join(out, 'index.html')}`);
