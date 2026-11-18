import { useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../store';
import { useLibrary } from '../library';
import { Slider, Toggle, Seg } from '../components/controls';
import { LanguagePick } from '../components/LanguagePick';
import { makeParts, musicRate, arrangeParts, playMix, stopPlaying, saveWav, wakeSound, findMelody, imitateSound, recordMicrophone, decodeRecording, playRecording, makeLoop, playLoop, swapLoop, loopPlace, performLive, type MusicRequest, type PartOutcome, type Recording, type MadeLoop } from '../voice/music';
import type { Melody } from '../../dsp/music/transcribe';
import { useLanes } from '../voice/hooks';
import { HeadView, FACE_SHOW, type FaceShow } from '../components/HeadView';
import { SONGS, ENSEMBLES, type PartPreset } from '../songs';
import { BEATBOX_KIT, DRUM_FAMILIES, drumSound, parseBeat, type BeatTrack, type DrumSound } from '../../dsp/music/beat';
import type { Imitation } from '../../dsp/music/imitate';
import { BEAT_PATTERNS } from '../../dsp/music/patterns';
import { parseNotes, noteName, noteNumber } from '../../dsp/music/notes';
import type { Stereo, Placed } from '../../dsp/music/mix';
import { BUILTIN_VOICES } from '../../dsp/voice/builtin';
import { VoiceDesign, cloneVoice } from '../../dsp/voice/design';
import { speechLanguage } from '../../dsp/speech/languages';
import { textToPhones, ipaKind, type Phone } from '../../dsp/speech/g2p';

export type MusicSection = 'sing' | 'beat' | 'ensemble';

/** the words of a song as phones, its dictionary fetched first if the language needs one */
async function wordsOf(lyrics: string, lang: string): Promise<Phone[]> {
  const text = lyrics.replace(/(\p{L})-(?=\p{L})/gu, '$1').trim();
  if (!text) return [];
  if (lang === 'en') await store.ensureLexicon();
  if (speechLanguage(lang) && !ipaKind(text)) await store.ensurePhonemes(text, lang, true);
  const ph = textToPhones(text, lang);
  if (!ph.length) throw new Error(`no words of “${text.slice(0, 40)}” found in this language`);
  return ph;
}

/** what is being made or played, and what went wrong */
function useJob() {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const stop = useRef<() => void>(() => {});
  return { busy, setBusy, problem, setProblem, stop };
}

/** The notes as sung, on a roll: one bar per note, its vowel written on it. */
function Roll({ out }: { out: PartOutcome | null }) {
  if (!out?.notes?.length) return null;
  const n = out.notes, t0 = n[0].t0, t1 = n[n.length - 1].t1;
  const lo = Math.min(...n.map((x) => x.midi)) - 1, hi = Math.max(...n.map((x) => x.midi)) + 1;
  const W = 720, H = 120, x = (t: number) => ((t - t0) / (t1 - t0)) * W, y = (m: number) => H - 8 - ((m - lo) / Math.max(1, hi - lo)) * (H - 16);
  const syl = out.syllables ?? [];
  return (
    <figure className="music-roll">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The notes as sung">
        {n.map((q, i) => <rect key={i} x={x(q.t0)} y={y(q.midi) - 4} width={Math.max(2, x(q.t1) - x(q.t0) - 1)} height={8} rx={2} className="roll-note" />)}
        {n.map((q, i) => <rect key={`v${i}`} x={x(q.v0)} y={y(q.midi) - 1.5} width={Math.max(1, x(q.v1) - x(q.v0))} height={3} className="roll-vowel" />)}
        {syl.map((s, i) => <text key={`s${i}`} x={x(s.t0) + 1} y={y(s.midi[0] ?? lo) - 7} className="roll-syl">{s.ipa}</text>)}
      </svg>
      <figcaption className="muted small">{`Each bar a note (${noteName(lo + 1)} to ${noteName(hi - 1)}), the thin line on it where its vowel sounds; the consonants come just before each beat.`}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ singing

function SingBench({ voice }: { voice: VoiceDesign }) {
  const [preset, setPreset] = useState(SONGS[0].id);
  const p = SONGS.find((s) => s.id === preset) ?? SONGS[0];
  const [notes, setNotes] = useState(p.notes);
  const [lyrics, setLyrics] = useState(p.lyrics);
  const [lang, setLang] = useState(p.lang);
  const [tempo, setTempo] = useState(p.tempo);
  const [transpose, setTranspose] = useState(0);
  const [vibrato, setVibrato] = useState(0.4);
  const [tune, setTune] = useState(true);
  const [out, setOut] = useState<PartOutcome | null>(null);
  const [mix, setMix] = useState<Stereo | null>(null);
  const job = useJob();
  const speaking = useLanes().performer.kind !== 'hands';
  const low = voice.speaking.f0 < 160;
  const pick = (id: string) => {
    const s = SONGS.find((x) => x.id === id)!;
    setPreset(id); setNotes(s.notes); setLyrics(s.lyrics); setLang(s.lang); setTempo(s.tempo); setTranspose(low ? s.low ?? 0 : 0);
  };
  const noteError = useMemo(() => { try { parseNotes(notes); return ''; } catch (e) { return (e as Error).message; } }, [notes]);

  // a tune of the user's own: recorded or opened, its melody found, then sung on its notes or with its exact pitch
  const [rec, setRec] = useState<Recording | null>(null);
  const [recording, setRecording] = useState<{ stop: () => Promise<Recording> } | null>(null);
  const [melody, setMelody] = useState<Melody | null>(null);
  const [exact, setExact] = useState(false);
  const listen = async (r: Recording) => {
    setRec(r); setMelody(null); setExact(false);
    job.setProblem(''); job.setBusy('Finding the melody…');
    try { setMelody(await findMelody(r)); } catch (e) { job.setProblem((e as Error).message); }
    job.setBusy('');
  };
  const startRec = async () => {
    job.setProblem('');
    try { setRecording(await recordMicrophone()); } catch (e) { job.setProblem(`The microphone did not open: ${(e as Error).message}`); }
  };
  const stopRec = async () => {
    const r = recording;
    setRecording(null);
    if (r) await listen(await r.stop());
  };
  const openFile = async (f: File | undefined) => {
    if (!f) return;
    try { await listen(await decodeRecording(f)); } catch (e) { job.setProblem(`That file could not be read: ${(e as Error).message}`); }
  };
  /** the octaves that bring the tune to where this voice sings (a whistle is high, a man's voice low) */
  const octaves = (m: Melody) => {
    const sung = m.found.map((n) => n.midi).sort((a, b) => a - b), mid = sung[sung.length >> 1];
    const home = 69 + 12 * Math.log2(voice.speaking.f0 / 440) + 7;
    return 12 * Math.round((home - mid) / 12);
  };
  const applyMelody = (m: Melody) => { setNotes(m.text); setTempo(m.tempo); setTranspose(octaves(m)); };

  const go = async () => {
    wakeSound();
    job.setProblem(''); job.setBusy('Getting the words…');
    try {
      const words = await wordsOf(lyrics, lang);
      job.setBusy('Starting to sing…');
      const own = exact && melody ? { notes: melody.exact, contour: melody.contour, tempo: melody.tempo } : { notes, tempo };
      const req: MusicRequest = { kind: 'sing', voice, fs: musicRate(), song: { ...own, lyrics: words, lang, transpose, vibrato, tune, vowel: 'a' } };
      // heard as it is sung: the singer's ear corrects each note just ahead of it
      const run = performLive([{ req }], {
        tempo: own.tempo, room: 0.15, label: `${voice.name || 'The voice'} sings`,
        onInfo: (_, info) => setOut({ performance: null, warnings: info.warnings, notes: info.notes, syllables: info.syllables }),
        onStart: () => job.setBusy(''),
      });
      job.stop.current = run.stop;
      const { parts: [o], mix: m } = await run.done;
      job.setBusy('');
      if (!o.performance) { if (o.error) job.setProblem(o.error); return; }
      setOut(o);
      setMix(m);
    } catch (e) { job.setBusy(''); job.setProblem((e as Error).message); }
  };

  return (
    <div className="music-bench">
      <div className="music-row">
        <select className="text-input music-pick" value={preset} onChange={(e) => pick(e.target.value)} aria-label="Song">
          {SONGS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <LanguagePick value={lang} onChange={setLang} />
        {job.busy
          ? <button className="btn big" onClick={() => { job.stop.current(); job.setBusy(''); }}>■ Stop</button>
          : speaking
            ? <button className="btn big" onClick={stopPlaying}>■ Stop</button>
            : <button className="btn primary big" disabled={!!noteError && !(exact && melody)} onClick={() => void go()}>♪ Sing</button>}
        <button className="btn" disabled={!mix} onClick={() => mix && void playMix(mix, 'Again')}>▶ Again</button>
        <button className="btn" disabled={!mix} onClick={() => mix && saveWav(mix, `${voice.name || 'voice'} - ${p.name}`)}>⇩ WAV</button>
      </div>
      <p className="muted small">{p.hint}. The voice you are editing sings it: change it in Design and sing again.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={exact && melody ? melody.tempo : tempo} min={40} max={200} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} hint={exact && melody ? 'your own timing: the tempo of your recording' : undefined} />
        <Slider label="Transpose" value={transpose} min={-36} max={12} step={1} onChange={setTranspose} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} hint="semitones: −12 an octave down, for a man’s voice" />
        <Slider label="Vibrato" value={vibrato} min={0} max={1} step={0.05} onChange={setVibrato} format={(v) => `±${v.toFixed(2)} st`} hint="how far the pitch swings on a held note, semitones either way" />
        <Toggle label="Tune by ear" value={tune} onChange={setTune} hint="sings once, measures every note, sings again with each note put in tune (twice as long)" />
      </div>
      <section className="music-own" aria-label="A tune of your own">
        <div className="music-row">
          {recording
            ? <button className="btn primary" onClick={() => void stopRec()}>■ Stop recording</button>
            : <button className="btn" disabled={!!job.busy} onClick={() => void startRec()}>● Record a tune</button>}
          <label className="btn music-file">Open a sound file…<input type="file" accept="audio/*" onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn" disabled={!rec || !!recording} onClick={() => rec && void playRecording(rec, 'Your tune')}>▶ Hear yours</button>
        </div>
        {recording
          ? <p className="music-busy">Recording: sing, hum or whistle your tune, then stop.</p>
          : !melody && <p className="muted small">Sing, hum or whistle a tune of a few seconds (or open a recording of one): its notes and tempo are found, and the voice sings them with the words below.</p>}
        {melody && (
          <div className="music-found">
            <p className="small">{`${melody.found.length} notes at ${melody.tempo} bpm; you sing ${Math.abs(melody.tuning)} cents ${melody.tuning < 0 ? 'flat of' : 'sharp of'} the piano’s notes (taken out).`}</p>
            <code className="music-found-notes">{melody.text}</code>
            <div className="music-row">
              <button className="btn" onClick={() => { applyMelody(melody); setExact(false); }}>Use these notes</button>
              <Toggle label="Sing my exact pitch" value={exact} onChange={(v) => { setExact(v); if (v) setTranspose(octaves(melody)); }} hint="your own slides, vibrato and timing, in place of the notes on their grid (the words below still go one syllable to each note)" />
            </div>
          </div>
        )}
      </section>
      <label className="music-field">
        <span>Notes <small className="muted">C4 is middle C · :2 two beats · r a rest · ~ goes on with the syllable · | for the eye</small></span>
        <textarea className="music-notes" rows={3} value={exact && melody ? melody.text : notes} disabled={exact && !!melody} spellCheck={false} onChange={(e) => setNotes(e.target.value)} />
        {exact && melody && <small className="muted">Sung with your own pitch and timing: turn off “Sing my exact pitch” to write notes.</small>}
        {noteError && !exact && <small className="music-problem">{noteError}</small>}
      </label>
      <label className="music-field">
        <span>Words <small className="muted">one syllable to each note; empty: “a” on every note; [IPA] as written</small></span>
        <textarea className="music-notes" rows={2} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
      </label>
      {job.busy && <p className="music-busy">{job.busy}</p>}
      {job.problem && <p className="music-problem">{job.problem}</p>}
      {out?.warnings.map((w) => <p key={w} className="music-problem">{w}</p>)}
      <Roll out={out} />
    </div>
  );
}

// ------------------------------------------------------------------ beatbox

/** a step clicked: nothing, a hit, an accent, a soft one, nothing */
const cycle = (c: string) => (c === '.' ? 'x' : c === 'x' ? 'X' : c === 'X' || c === '>' ? 'o' : '.');
/** how a row's sound is written in a beat: its code in the kit, or its IPA in brackets; and its pitch */
const tokenOf = (t: BeatTrack, own: readonly DrumSound[]) => `${drumSound(t.sound, own)?.code ?? `[${t.sound}]`}${t.f0 !== undefined && t.f0 !== '' ? `:${t.f0}` : ''}`;

/** rows of a grid as the text of a beat: a layer to a row (a row without hits has nothing to write), a bar line every four steps */
function beatText(all: readonly BeatTrack[], own: readonly DrumSound[] = []): string {
  const rows = all.filter((r) => /[xXo>]/.test(r.pattern));
  const n = Math.max(16, ...all.map((r) => r.pattern.length));
  const words = rows.map((r) => Array.from({ length: n }, (_, i) => {
    const c = r.pattern[i] ?? '.';
    return c === '.' ? '.' : tokenOf(r, own) + (c === 'X' || c === '>' ? '!' : c === 'o' ? '?' : '');
  }));
  const w = Math.max(1, ...words.flat().map((x) => x.length));
  return words.map((ws) => `> ${ws.map((x, i) => `${i > 0 && i % 4 === 0 ? '| ' : ''}${x.padEnd(w)}`).join(' ').trimEnd()}`).join('\n');
}

/** sounds in time told briefly: each sound, and how many times in a row it comes */
function runsOf(events: readonly { ipa: string }[]): string {
  const runs: { ipa: string; n: number }[] = [];
  for (const e of events) { const r = runs[runs.length - 1]; if (r && r.ipa === e.ipa) r.n++; else runs.push({ ipa: e.ipa, n: 1 }); }
  return runs.map((r) => `[${r.ipa}]${r.n > 1 ? ` ×${r.n}` : ''}`).join(', then ');
}

const OWN_KEY = 'voice-workshop.beat-sounds';
/** the sounds of one's own kept in this browser (none if it keeps nothing) */
function loadOwnSounds(): DrumSound[] {
  try {
    const v = JSON.parse(localStorage.getItem(OWN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((s): s is DrumSound => !!s && typeof s.code === 'string' && typeof s.ipa === 'string' && /^my\d+$/.test(s.code)) : [];
  } catch { return []; }
}
function saveOwnSounds(s: readonly DrumSound[]): void {
  try { localStorage.setItem(OWN_KEY, JSON.stringify(s)); } catch { /* kept for this visit only */ }
}

/** a pitch as typed: a note's name or Hz (undefined: none; null: not a pitch) */
function readPitch(s: string): number | string | undefined | null {
  const t = s.trim();
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) { const v = +t; return v >= 30 && v <= 1500 ? v : null; }
  return noteNumber(t) !== null ? t : null;
}

/**
 * The pitch of a row: what is typed stays in the box, and reaches the beat
 * only once it is a pitch (a half-typed note is shown as wrong and left
 * there; leaving the box puts back the pitch the row has).
 */
function PitchInput({ value, enabled, label, onCommit }: { value?: number | string; enabled: boolean; label: string; onCommit: (v: number | string | undefined) => void }) {
  const shown = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const bad = readPitch(draft) === null;
  return (
    <input className={`beat-pitch${bad ? ' bad' : ''}`} value={draft} disabled={!enabled} placeholder={enabled ? 'C2' : ''} aria-label={label} aria-invalid={bad}
      title={bad ? 'not a pitch: a note (C2, F#1, Bb1) or Hz (30 to 1500)' : 'the pitch of a hummed sound: a note (C2) or Hz'}
      onChange={(e) => { setDraft(e.target.value); const v = readPitch(e.target.value); if (v !== null) onCommit(v); }}
      onBlur={() => { if (readPitch(draft) === null) setDraft(shown); }} />
  );
}

/**
 * A face for each mouth of what plays (`mouth`: which of the mouths the
 * voice follows), each with its caption; a click enlarges one over the
 * page, where what the faces show is chosen (the same for every face, kept
 * in this browser).
 */
function Faces({ faces }: { faces: { mouth: number; caption: string; long?: string }[] }) {
  const [big, setBig] = useState<number | null>(null);
  const [show, setShow] = useState<FaceShow>(() => { try { return { ...FACE_SHOW, ...JSON.parse(localStorage.getItem('voice-workshop.faceShow') ?? '{}') }; } catch { return FACE_SHOW; } });
  const setShown = (o: Partial<FaceShow>) => setShow((s) => { const n = { ...s, ...o }; try { localStorage.setItem('voice-workshop.faceShow', JSON.stringify(n)); } catch { /* not kept */ } return n; });
  useEffect(() => {
    if (big === null) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [big]);
  if (!faces.length) return null;
  const b = big !== null && big < faces.length ? faces[big] : null;
  return (
    <>
      <div className="beat-faces">
        {faces.map((x, k) => (
          <figure key={x.mouth} className="beat-face ds-card" title="Click to enlarge" onClick={() => setBig(k)}>
            <HeadView mouth={x.mouth} show={show} />
            <figcaption>{x.caption}</figcaption>
          </figure>
        ))}
      </div>
      {b && (
        <div className="beat-face-big" role="dialog" aria-label={`${b.caption}, enlarged`} onClick={() => setBig(null)}>
          <figure className="ds-card">
            <div className="beat-face-tools" onClick={(e) => e.stopPropagation()}>
              <Seg value={show.field} options={[['off', 'No field'], ['pressure', 'Pressure'], ['velocity', 'Velocity'], ['air', 'Airflow']]} onChange={(v) => setShown({ field: v })} />
              {([['flow', 'Flow', 'the air flowing, as dots'], ['noise', 'Noise', 'sparks where the air hisses'], ['handles', 'Handles', 'the points that move the head in the Lab'], ['labels', 'Names', 'the name of each part']] as const).map(([k, name, hint]) => (
                <button key={k} className={show[k] ? 'chip on' : 'chip'} title={hint} onClick={() => setShown({ [k]: !show[k] })}>{name}</button>
              ))}
            </div>
            <HeadView mouth={b.mouth} show={show} />
            <figcaption>{b.long ?? b.caption} · a click or Esc closes it</figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

function BeatBench({ voice }: { voice: VoiceDesign }) {
  const [preset, setPreset] = useState(BEAT_PATTERNS[0].id);
  const b = BEAT_PATTERNS.find((x) => x.id === preset) ?? BEAT_PATTERNS[0];
  // the rows of the grid are the beat; the text is another view of them, which takes their place only once it reads
  // (a row without hits yet is kept in the grid, and left out of the text)
  const [rows, setRows] = useState<BeatTrack[]>(() => parseBeat(b.beat));
  const [text, setText] = useState(() => beatText(parseBeat(b.beat)));
  const [textError, setTextError] = useState('');
  const [view, setView] = useState<'grid' | 'text'>('grid');
  const [tempo, setTempo] = useState(b.tempo);
  const [swing, setSwing] = useState(b.swing ?? 0);
  const [repeat, setRepeat] = useState(2);
  const [humanize, setHumanize] = useState(0.3);
  const [oneMouth, setOneMouth] = useState(true);
  const [anySound, setAnySound] = useState('');
  // the beat plays live, round and round, and every change is heard as it plays; `now` the step heard
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(-1);
  const shape = useRef<{ passes: number; steps: number; made: string } | null>(null);
  const asked = useRef(0), playing = useRef(0);
  // the faces: a mouth each, with the sounds it makes; one enlarged over the page
  const [faces, setFaces] = useState<string[][]>([]);
  const took = (l: MadeLoop, t: BeatTrack[]) => setFaces(l.mouths.map((_, m) => t.filter((_, i) => l.trackMouths[i] === m).map((x) => drumSound(x.sound, own)?.name ?? `[${x.sound}]`)));
  const job = useJob();
  const speaking = useLanes().performer.kind !== 'hands';
  const steps = Math.max(16, ...rows.map((r) => r.pattern.length));
  // sounds of one's own, imitated from recordings (kept in this browser)
  const [own, setOwn] = useState<DrumSound[]>(loadOwnSounds);
  const [found, setFound] = useState<{ imitation: Imitation; rec: Recording } | null>(null);
  const [recordingSound, setRecordingSound] = useState<{ stop: () => Promise<Recording> } | null>(null);
  const edit = (next: BeatTrack[]) => { setRows(next); setText(beatText(next, own)); setTextError(''); };
  const editText = (t: string) => {
    setText(t);
    try { setRows(parseBeat(t, own)); setTextError(''); } catch (e) { setTextError((e as Error).message); }
  };
  const listenTo = async (rec: Recording) => {
    setFound(null);
    job.setProblem(''); job.setBusy('Listening for the nearest sound of the mouth…');
    const r = imitateSound(voice, rec, (done, total, best) => job.setBusy(`Trying the sounds of the mouth: ${done} of ${total}${best ? `, nearest so far [${best}]` : ''}…`));
    job.stop.current = r.stop;
    try { const imitation = await r.done; setFound({ imitation, rec }); } catch (e) { if ((e as Error).message !== 'stopped') job.setProblem((e as Error).message); }
    job.setBusy('');
  };
  const startSound = async () => {
    job.setProblem('');
    try { setRecordingSound(await recordMicrophone()); } catch (e) { job.setProblem(`The microphone did not open: ${(e as Error).message}`); }
  };
  const stopSound = async () => {
    const r = recordingSound;
    setRecordingSound(null);
    if (r) await listenTo(await r.stop());
  };
  const openSound = async (f: File | undefined) => {
    if (!f) return;
    try { await listenTo(await decodeRecording(f)); } catch (e) { job.setProblem(`That file could not be read: ${(e as Error).message}`); }
  };
  /** keeps the sound found (or one of the others tried) as a sound of one's own, written my1, my2… */
  const keep = (found: DrumSound) => {
    let n = 1;
    while (own.some((s) => s.code === `my${n}`)) n++;
    const s: DrumSound = { ...found, id: `my${n}`, code: `my${n}`, name: `Yours ${n}` };
    const next = [...own, s];
    setOwn(next); saveOwnSounds(next);
    return s;
  };
  const forget = (code: string) => {
    const next = own.filter((s) => s.code !== code);
    setOwn(next); saveOwnSounds(next);
    if (rows.some((r) => r.sound === code)) edit(rows.filter((r) => r.sound !== code));
  };
  const pick = (id: string) => {
    const x = BEAT_PATTERNS.find((q) => q.id === id)!;
    setPreset(id); setTempo(x.tempo); setSwing(x.swing ?? 0); edit(parseBeat(x.beat));
  };
  const setRow = (r: number, ch: Partial<BeatTrack>) => edit(rows.map((x, k) => (k === r ? { ...x, ...ch } : x)));
  const addRow = (sound: string) => edit([...rows, { sound, pattern: '.'.repeat(steps) }]);

  const make = async (req: MusicRequest, room: number) => {
    job.setProblem(''); job.setBusy('Making the sounds…');
    const r = makeParts([req]);
    job.stop.current = r.stop;
    const [o] = await r.done;
    job.setBusy('');
    if (!o.performance) { if (o.error) job.setProblem(o.error); return null; }
    return arrangeParts([{ performance: o.performance }], { tempo, room, size: 0.3 });
  };
  const run = async (req: MusicRequest, label: string, room: number) => {
    wakeSound();
    const m = await make(req, room);
    if (m) void playMix(m, label);
  };
  const hits = () => rows.filter((x) => /[xXo>]/.test(x.pattern));
  // the loop: four times round the pattern (each a little different when human), over the room of the WAV
  const loopOpts = { tempo, swing, humanize, layered: !oneMouth, sounds: own, fs: musicRate(), room: 0.08, size: 0.3, passes: 4 };
  const madeKey = (t: BeatTrack[]) => JSON.stringify([t, loopOpts, voice]);
  const play = async () => {
    if (textError && view === 'text') { job.setProblem(`The text has a mistake (${textError}): mend it, or go back to the grid, which still holds the beat as it was.`); return; }
    const t = hits();
    if (!t.length) { job.setProblem('Nothing to play: click the steps of the grid, or write a beat as text.'); return; }
    wakeSound();
    job.setProblem(''); job.setBusy('Making the sounds…');
    const id = ++asked.current;
    job.stop.current = () => { asked.current++; };
    try {
      const key = madeKey(t);
      const l = await makeLoop(voice, t, loopOpts);
      job.setBusy('');
      if (id !== asked.current) return;
      shape.current = { passes: l.passes, steps: l.steps, made: key };
      took(l, t);
      const token = ++playing.current;
      setLive(true);
      // from a little before the end of the round: the first strike comes 120 ms after the press, its start heard whole
      await playLoop(l.samples, `${voice.name || 'The voice'} beatboxes`, Math.max(0, l.samples.length / musicRate() - 0.12), l.mouths);
      if (playing.current === token) { setLive(false); setNow(-1); }
    } catch (e) {
      job.setBusy('');
      job.setProblem((e as Error).message);
    }
  };
  // while it plays, what changes is made again (the sounds already said are kept) and heard from the same step
  useEffect(() => {
    if (!live) return;
    const t = hits();
    const key = madeKey(t);
    if (shape.current?.made === key) return;
    const id = ++asked.current;
    const timer = setTimeout(() => {
      if (!t.length) {
        // nothing left to play: a silent round, the steps still going
        const s = shape.current, n = Math.round(((s?.steps ?? 16) * (s?.passes ?? 4) * 15 * musicRate()) / tempo);
        if (s) shape.current = { ...s, made: key };
        swapLoop(new Float32Array(Math.max(1, n)));
        return;
      }
      makeLoop(voice, t, loopOpts).then((l) => {
        if (id !== asked.current) return;
        shape.current = { passes: l.passes, steps: l.steps, made: key };
        took(l, t);
        swapLoop(l.samples, l.mouths);
      }).catch((e: Error) => job.setProblem(e.message));
    }, 30);
    return () => clearTimeout(timer);
  }, [live, rows, tempo, swing, humanize, oneMouth, own, voice]);
  // before it plays, its sounds are said ahead (the worker keeps them), so that Play sounds at once
  useEffect(() => {
    if (live) return;
    const t = hits();
    if (!t.length) return;
    const timer = setTimeout(() => { makeLoop(voice, t, loopOpts).then((l) => took(l, t)).catch(() => {}); }, 400);
    return () => clearTimeout(timer);
  }, [live, rows, own, voice]);
  // the step heard now
  useEffect(() => {
    if (!live) return;
    let raf = 0, last = -2;
    const tick = () => {
      const pl = loopPlace(), s = shape.current;
      if (pl && s) {
        const pass = pl.length / s.passes;
        const k = Math.min(s.steps - 1, Math.floor(((pl.at % pass) / pass) * s.steps));
        if (k !== last) { last = k; setNow(k); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setNow(-1); };
  }, [live]);
  const wav = async () => {
    const t = hits();
    if (!t.length) { job.setProblem('Nothing to save: click the steps of the grid, or write a beat as text.'); return; }
    const m = await make({ kind: 'beat', voice, tracks: t, opts: { tempo, swing, repeat, humanize, layered: !oneMouth, sounds: own, fs: musicRate() } }, 0.08);
    if (m) saveWav(m, `${voice.name || 'voice'} - ${b.name}`);
  };
  const audition = (t: { sound: string; f0?: number | string }, sounds: DrumSound[] = own) =>
    void run({ kind: 'beat', voice, tracks: [{ sound: t.sound, f0: t.f0 === '' ? undefined : t.f0, pattern: 'x' }], opts: { tempo, sounds, fs: musicRate() } }, `[${drumSound(t.sound, sounds)?.ipa ?? t.sound}]`, 0);

  return (
    <div className="music-bench">
      <div className="music-row">
        <select className="text-input music-pick" value={preset} onChange={(e) => pick(e.target.value)} aria-label="Beat">
          {BEAT_PATTERNS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {job.busy
          ? <button className="btn big" onClick={() => { job.stop.current(); job.setBusy(''); }}>■ Stop</button>
          : speaking
            ? <button className="btn big" onClick={stopPlaying}>■ Stop</button>
            : <button className="btn primary big" onClick={() => void play()}>▶ Play</button>}
        <button className="btn" disabled={!!job.busy} title="The beat as a WAV file, as many bars as Bars says" onClick={() => void wav()}>⇩ WAV</button>
      </div>
      <p className="muted small">{b.hint}. Every drum is a sound of the mouth of the voice you are editing (a bigger head, a deeper kit). It plays round and round: change the steps, the sounds, the tempo as it plays.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={tempo} min={50} max={200} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} />
        <Slider label="Swing" value={swing} min={0} max={0.6} step={0.05} onChange={setSwing} format={(v) => v.toFixed(2)} hint="every second step played a little late" />
        <Slider label="Bars" value={repeat} min={1} max={8} step={1} onChange={setRepeat} format={(v) => `${Math.round(v)}`} hint="how many times round the pattern the WAV holds" />
        <Slider label="Human" value={humanize} min={0} max={1} step={0.05} onChange={setHumanize} format={(v) => v.toFixed(2)} hint="hits a few milliseconds early or late, a little louder or softer, as a person plays" />
        <Toggle label="One mouth" value={oneMouth} onChange={setOneMouth} hint="one sound at a time, each cut by the next, as a beatboxer makes them (a hum goes on under the clicks); off: every hit rings out, as a drum machine" />
      </div>
      <Faces faces={faces.map((names, m) => ({ mouth: m, caption: `${faces.length > 1 ? `Mouth ${m + 1}: ` : ''}${names.join(', ')}`, long: `${faces.length > 1 ? `Mouth ${m + 1} of ${faces.length}: ` : ''}${names.join(', ')}` }))} />
      <div className="music-row">
        <Seg value={view} options={[['grid', 'Grid'], ['text', 'Text']]} onChange={setView} />
        <span className="muted small">{view === 'grid' ? 'Click a step: a hit, an accent, a soft one, nothing.' : 'A step to a word: b kick · pf snare · ts hi-hat · ^k inward snare · . nothing · b+ts together · pf! accent · t? soft · m:C2 a hum on C2 · [kʼ] any sound · a line starting with > is a layer.'}</span>
      </div>
      {view === 'text'
        ? <textarea className="music-notes beat-text" rows={Math.max(3, text.split('\n').length + 1)} value={text} spellCheck={false} onChange={(e) => editText(e.target.value)} aria-label="The beat as text" />
        : (
          <div className="beat-grid" role="grid" aria-label="Steps" style={{ ['--steps' as string]: steps }}>
            {rows.map((r, ri) => {
              const kit = drumSound(r.sound, own);
              return (
                <div key={ri} className="beat-row" role="row">
                  <select className="beat-sound" value={kit?.code ?? `[${r.sound}]`} aria-label={`Sound of row ${ri + 1}`} title={kit ? `${kit.hint} [${kit.ipa}]` : `[${r.sound}]`}
                    onChange={(e) => setRow(ri, { sound: e.target.value.replace(/^\[|\]$/g, ''), f0: undefined })}>
                    {!kit && <option value={`[${r.sound}]`}>[{r.sound}]</option>}
                    {own.length > 0 && (
                      <optgroup label="Your sounds">
                        {own.map((k) => <option key={k.code} value={k.code}>{k.name} · {k.code}</option>)}
                      </optgroup>
                    )}
                    {DRUM_FAMILIES.map((f) => (
                      <optgroup key={f.id} label={f.name}>
                        {BEATBOX_KIT.filter((k) => k.family === f.id).map((k) => <option key={k.id} value={k.code}>{k.name} · {k.code}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <PitchInput value={r.f0} enabled={!kit || !!kit.f0} label={`Pitch of row ${ri + 1}`} onCommit={(f0) => setRow(ri, { f0 })} />
                  <button className="chip" title="Hear it once" onClick={() => audition(r)}>▶</button>
                  <div className="beat-steps">
                    {Array.from({ length: steps }, (_, i) => r.pattern[i] ?? '.').map((c, i) => (
                      <button key={i} className={`beat-step${c === 'x' ? ' on' : c === 'X' || c === '>' ? ' accent' : c === 'o' ? ' soft' : ''}${i % 4 === 0 ? ' beat' : ''}${i === now ? ' now' : ''}`}
                        aria-label={`Row ${ri + 1}, step ${i + 1}`} onClick={() => { const p = r.pattern.padEnd(steps, '.'); setRow(ri, { pattern: p.slice(0, i) + cycle(c) + p.slice(i + 1) }); }} />
                    ))}
                  </div>
                  <button className="chip" title="Take this row away" aria-label={`Remove row ${ri + 1}`} onClick={() => edit(rows.filter((_, k) => k !== ri))}>✕</button>
                </div>
              );
            })}
            {!rows.length && <p className="muted small">No rows: add a sound from the kit below.</p>}
          </div>
        )}
      {textError && view === 'text' && <p className="music-problem">{`${textError}. The grid still holds the beat as it was before this mistake.`}</p>}
      {job.busy && <p className="music-busy">{job.busy}</p>}
      {job.problem && <p className="music-problem">{job.problem}</p>}
      <details className="beat-kit">
        <summary>{`The kit: ${BEATBOX_KIT.length} sounds of the mouth`} <small className="muted">click one to hear it, + to put it in the beat</small></summary>
        {DRUM_FAMILIES.map((f) => (
          <div key={f.id} className="beat-family">
            <span className="beat-family-name">{f.name}</span>
            <div className="chips">
              {BEATBOX_KIT.filter((k) => k.family === f.id).map((k) => (
                <span key={k.id} className="beat-kit-sound">
                  <button className="chip" title={`${k.hint} [${k.ipa}]${k.inward ? ' (air drawn in)' : ''}`} onClick={() => audition({ sound: k.code })}>{k.name} <small>{k.code}</small></button>
                  <button className="chip" title={`Add a row of ${k.name}`} aria-label={`Add ${k.name}`} onClick={() => { setView('grid'); addRow(k.code); }}>+</button>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="music-row">
          <input className="text-input beat-any" value={anySound} placeholder="any sound in IPA, e.g. tʃʼ" onChange={(e) => setAnySound(e.target.value)} aria-label="Any sound in IPA" />
          <button className="btn" disabled={!anySound.trim()} onClick={() => audition({ sound: anySound.trim().replace(/^\[|\]$/g, '') })}>▶ Hear</button>
          <button className="btn" disabled={!anySound.trim()} onClick={() => { setView('grid'); addRow(anySound.trim().replace(/^\[|\]$/g, '')); }}>+ Add a row</button>
        </div>
      </details>
      <details className="beat-kit" open={!!found || own.length > 0 || !!recordingSound}>
        <summary>Your own sounds <small className="muted">make a noise, the voice’s mouth finds the nearest sound it can make</small></summary>
        <div className="music-row">
          {recordingSound
            ? <button className="btn primary" onClick={() => void stopSound()}>■ Stop recording</button>
            : <button className="btn" disabled={!!job.busy} onClick={() => void startSound()}>● Record a sound</button>}
          <label className="btn music-file">Open a sound file…<input type="file" accept="audio/*" onChange={(e) => { void openSound(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
        {recordingSound && <p className="music-busy">Recording: make one sound (a click, a pop, a hiss, a hum, a p going into a long ss) or an effect of several (a run of taps, then a roar: 4 s at most), then stop.</p>}
        {found && (
          <div className="music-found">
            <p className="small">{found.imitation.events?.length
              ? `Heard as ${found.imitation.events.length} sounds in time: ${runsOf(found.imitation.events)}, each at its time and level: ${found.imitation.distance} dB from yours (0 would be the same; under 3 near, over 6 far: sounds the mouth cannot quite make).`
              : `Nearest: [${found.imitation.sound.ipa}]${found.imitation.sound.knobs ? `, the head ×${(found.imitation.sound.knobs['body.anatomy.scale'] / (voice.body.anatomy.scale || 1)).toFixed(2)}` : ''}${found.imitation.sound.hold ? `, its last sound held ×${found.imitation.sound.hold}` : ''}${found.imitation.sound.fade ? ', dying away' : ''}${found.imitation.f0 ? `, on ${found.imitation.f0} Hz` : ''}: ${found.imitation.distance} dB from yours (0 would be the same; under 3 near, over 6 far: a sound the mouth cannot quite make).`}</p>
            <div className="music-row">
              <button className="btn" onClick={() => void playRecording(found.rec, 'Your sound')}>▶ Yours</button>
              <button className="btn" onClick={() => audition({ sound: 'own' }, [found.imitation.sound])}>▶ The voice’s</button>
              <button className="btn primary" onClick={() => { const s = keep(found.imitation.sound); setFound(null); setView('grid'); setRows((rs) => { const next = [...rs, { sound: s.code, pattern: '.'.repeat(steps) }]; setText(beatText(next, [...own, s])); return next; }); }}>+ Keep it, add a row</button>
            </div>
            {found.imitation.tried.length > 1 && <div className="chips">
              <span className="muted small">or another near one:</span>
              {found.imitation.tried.filter((t) => t.ipa !== found.imitation.sound.ipa).slice(0, 5).map((t) => (
                <span key={t.ipa} className="beat-kit-sound">
                  <button className="chip" title={`${t.sound.hint}; ${t.distance} dB from yours`} onClick={() => audition({ sound: 'own' }, [t.sound])}>[{t.ipa}] <small>{t.distance}</small></button>
                  <button className="chip" aria-label={`Keep [${t.ipa}]`} title="Keep this one instead" onClick={() => { const s = keep(t.sound); setFound(null); setView('grid'); setRows((rs) => { const next = [...rs, { sound: s.code, pattern: '.'.repeat(steps) }]; setText(beatText(next, [...own, s])); return next; }); }}>+</button>
                </span>
              ))}
            </div>}
          </div>
        )}
        {own.length > 0 && (
          <div className="chips">
            {own.map((k) => (
              <span key={k.code} className="beat-kit-sound">
                <button className="chip" title={k.parts ? `${k.hint}: ${runsOf(k.parts)}` : k.hint} onClick={() => audition({ sound: k.code })}>{k.name} <small>{k.code} {k.parts ? `${k.parts.length} sounds` : `[${k.ipa}]`}</small></button>
                <button className="chip" aria-label={`Add ${k.name}`} title={`Add a row of ${k.name}`} onClick={() => { setView('grid'); addRow(k.code); }}>+</button>
                <button className="chip" aria-label={`Forget ${k.name}`} title="Forget this sound" onClick={() => forget(k.code)}>✕</button>
              </span>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ ensemble

interface PartState extends PartPreset { mute: boolean }
type Made = { key: string; out: PartOutcome };

function EnsembleBench() {
  const lib = useLibrary();
  const voices = useMemo(() => [...BUILTIN_VOICES.map((b) => ({ id: b.id, name: b.name, design: b.design })), ...lib.voices.map((v) => ({ id: v.id, name: v.name || 'Unnamed', design: v }))], [lib.voices]);
  const [preset, setPreset] = useState(ENSEMBLES[0].id);
  const e = ENSEMBLES.find((x) => x.id === preset) ?? ENSEMBLES[0];
  const [tempo, setTempo] = useState(e.tempo);
  const [room, setRoom] = useState(e.room);
  const [parts, setParts] = useState<PartState[]>(() => e.parts.map((p) => ({ ...p, mute: false })));
  const [made, setMade] = useState<(Made | null)[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [mix, setMix] = useState<Stereo | null>(null);
  const job = useJob();
  const speaking = useLanes().performer.kind !== 'hands';
  const pick = (id: string) => {
    const x = ENSEMBLES.find((q) => q.id === id)!;
    setPreset(id); setTempo(x.tempo); setRoom(x.room); setParts(x.parts.map((p) => ({ ...p, mute: false }))); setMade([]); setMix(null); setStatus([]);
  };
  const setPart = (i: number, ch: Partial<PartState>) => setParts(parts.map((p, k) => (k === i ? { ...p, ...ch } : p)));
  const designOf = (id: string): VoiceDesign => cloneVoice((voices.find((v) => v.id === id) ?? voices[0]).design as VoiceDesign);

  /** the request that makes a part, and a key that says whether a part already made is still it */
  const requestOf = async (p: PartState): Promise<MusicRequest> => {
    const voice = designOf(p.voice);
    if (p.beat) {
      const b = BEAT_PATTERNS.find((x) => x.id === p.beat)!;
      return { kind: 'beat', voice, tracks: parseBeat(b.beat), opts: { tempo, swing: e.swing ?? b.swing ?? 0, repeat: e.repeat ?? 2, humanize: 0.3, fs: musicRate() } };
    }
    const s = p.song ? SONGS.find((x) => x.id === p.song)! : null;
    const lang = p.lang ?? s?.lang ?? 'it';
    const words = await wordsOf(p.lyrics ?? s?.lyrics ?? '', lang);
    return { kind: 'sing', voice, fs: musicRate(), song: { notes: p.notes ?? s!.notes, lyrics: words, lang, tempo, transpose: p.transpose ?? 0, vowel: p.vowel ?? 'a' } };
  };

  const remix = (list: (Made | null)[], ps = parts, r = room) => {
    const placed: Placed[] = [];
    list.forEach((m, i) => { if (m?.out.performance && !ps[i].mute) placed.push({ performance: m.out.performance, startBeat: ps[i].startBeat, gain: ps[i].gain, pan: ps[i].pan }); });
    if (!placed.length) return null;
    const m = arrangeParts(placed, { tempo, room: r });
    setMix(m);
    return m;
  };

  // a face for each part that sings, while the parts are heard
  const [faces, setFaces] = useState<{ mouth: number; caption: string }[]>([]);
  const heard = useLanes().performer.kind !== 'hands';
  useEffect(() => { if (!heard) setFaces([]); }, [heard]);

  const perform = async () => {
    wakeSound();
    job.setProblem(''); job.setBusy('Getting the words…');
    try {
      const reqs = await Promise.all(parts.map(requestOf));
      const keys = reqs.map((r) => JSON.stringify(r));
      // the parts already made (and still the same) are heard as they are, the others as they are made
      const next: (Made | null)[] = parts.map((_, i) => (made[i]?.key === keys[i] && made[i]?.out.performance ? made[i] : null));
      const todo = next.filter((m) => !m).length;
      setStatus(parts.map((_, i) => (next[i] ? 'ready' : 'making…')));
      job.setBusy(todo ? `Starting ${todo} part${todo > 1 ? 's' : ''}, each in its own worker…` : '');
      const run = performLive(parts.map((p, i) => ({
        req: next[i] ? undefined : reqs[i], made: next[i]?.out.performance ?? undefined,
        // a muted part is made too (to be heard again without making it), but not heard
        startBeat: p.startBeat, gain: p.mute ? -300 : p.gain, pan: p.pan,
      })), {
        tempo, room, label: e.name,
        onPart: (i, o) => {
          next[i] = { key: keys[i], out: o };
          setStatus((st) => st.map((x, j) => (j === i ? (o.performance ? 'ready' : `failed: ${o.error ?? ''}`) : x)));
        },
        onStart: () => {
          job.setBusy('');
          setFaces(parts.map((p, i) => ({ p, i })).filter(({ p }) => !p.mute && !p.beat).map(({ p, i }) => ({ mouth: i, caption: `${p.name} · ${voices.find((v) => v.id === p.voice)?.name ?? p.voice}` })));
        },
      });
      job.stop.current = run.stop;
      await run.done;
      job.setBusy('');
      setMade(next);
      remix(next);
    } catch (err) { setFaces([]); job.setBusy(''); job.setProblem((err as Error).message); }
  };

  // a change of level, place or room is heard again from the parts already made
  const live = useRef(false);
  useEffect(() => { if (live.current && made.some(Boolean)) remix(made); live.current = true; }, [room, parts.map((p) => `${p.gain}|${p.pan}|${p.mute}|${p.startBeat}`).join(',')]);

  return (
    <div className="music-bench">
      <div className="music-row">
        <select className="text-input music-pick" value={preset} onChange={(ev) => pick(ev.target.value)} aria-label="Ensemble">
          {ENSEMBLES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {job.busy
          ? <button className="btn big" onClick={() => { job.stop.current(); job.setBusy(''); }}>■ Stop</button>
          : speaking
            ? <button className="btn big" onClick={stopPlaying}>■ Stop</button>
            : <button className="btn primary big" onClick={() => void perform()}>♪ Perform</button>}
        <button className="btn" disabled={!mix} onClick={() => mix && void playMix(mix, 'Again')}>▶ Again</button>
        <button className="btn" disabled={!mix} onClick={() => mix && saveWav(mix, e.name)}>⇩ WAV</button>
      </div>
      <p className="muted small">{e.hint}. Each part is made by its own voice (yours too, from the library) away from the page, all at once, and heard together as they are made. Level, place and room change without making the parts again.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={tempo} min={40} max={200} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} />
        <Slider label="Room" value={room} min={0} max={0.6} step={0.01} onChange={setRoom} format={(v) => v.toFixed(2)} hint="how much of the room is heard" />
      </div>
      <Faces faces={faces} />
      <div className="part-list">
        {parts.map((p, i) => (
          <div key={i} className={p.mute ? 'part-row muted-part' : 'part-row'}>
            <div className="part-head">
              <b className="part-name">{p.name}</b>
              <select className="part-voice" value={p.voice} aria-label={`Voice of ${p.name}`} onChange={(ev) => setPart(i, { voice: ev.target.value })}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <span className="muted small part-what">{p.beat ? `beatbox: ${BEAT_PATTERNS.find((b) => b.id === p.beat)?.name}` : p.song ? SONGS.find((s) => s.id === p.song)?.name : p.lyrics ? `on “${p.lyrics.split(' ')[0]}”` : `on “${p.vowel ?? 'a'}”`}</span>
              <Toggle label="Mute" value={p.mute} onChange={(x) => setPart(i, { mute: x })} />
              <span className="part-status small">{status[i] ?? ''}</span>
            </div>
            <div className="part-knobs">
              <Slider label="In at beat" value={p.startBeat} min={0} max={32} step={1} onChange={(v) => setPart(i, { startBeat: v })} format={(v) => `${Math.round(v)}`} />
              {!p.beat && <Slider label="Transpose" value={p.transpose ?? 0} min={-24} max={12} step={1} onChange={(v) => setPart(i, { transpose: v })} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} />}
              <Slider label="Level" value={p.gain} min={-18} max={9} step={0.5} onChange={(v) => setPart(i, { gain: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} />
              <Slider label="Place" value={p.pan} min={-1} max={1} step={0.05} onChange={(v) => setPart(i, { pan: v })} format={(v) => (Math.abs(v) < 0.03 ? 'centre' : v < 0 ? `left ${Math.round(-v * 100)}` : `right ${Math.round(v * 100)}`)} />
            </div>
          </div>
        ))}
      </div>
      {job.busy && <p className="music-busy">{job.busy}</p>}
      {job.problem && <p className="music-problem">{job.problem}</p>}
      {made.flatMap((m) => m?.out.warnings ?? []).map((w, i) => <p key={i} className="music-problem">{w}</p>)}
    </div>
  );
}

/**
 * Singing, beatbox and voices together: benches to try the voices on
 * music. The parts are made away from the page and then played.
 */
export function Music({ section, voice }: { section: MusicSection; voice: VoiceDesign }) {
  return (
    <section className="ds-card music">
      {section === 'sing' && <SingBench voice={voice} />}
      {section === 'beat' && <BeatBench voice={voice} />}
      {section === 'ensemble' && <EnsembleBench />}
    </section>
  );
}
