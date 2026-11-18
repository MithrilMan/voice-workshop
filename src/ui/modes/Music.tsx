import { useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../store';
import { useLibrary } from '../library';
import { Slider, Toggle } from '../components/controls';
import { LanguagePick } from '../components/LanguagePick';
import { makeParts, musicRate, arrangeParts, playMix, stopPlaying, saveWav, wakeSound, type MusicRequest, type PartOutcome } from '../voice/music';
import { useLanes } from '../voice/hooks';
import { SONGS, BEATS, ENSEMBLES, beatTracks, type PartPreset } from '../songs';
import { BEATBOX_KIT } from '../../dsp/music/beat';
import { parseNotes, noteName } from '../../dsp/music/notes';
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

  const go = async () => {
    wakeSound();
    job.setProblem(''); job.setBusy('Getting the words…');
    try {
      const words = await wordsOf(lyrics, lang);
      job.setBusy(tune ? 'Singing (a first take, then again in tune)…' : 'Singing…');
      const req: MusicRequest = { kind: 'sing', voice, fs: musicRate(), song: { notes, lyrics: words, lang, tempo, transpose, vibrato, tune, vowel: 'a' } };
      const run = makeParts([req]);
      job.stop.current = run.stop;
      const [o] = await run.done;
      job.setBusy('');
      if (!o.performance) { if (o.error) job.setProblem(o.error); return; }
      setOut(o);
      const m = arrangeParts([{ performance: o.performance }], { tempo, room: 0.15 });
      setMix(m);
      void playMix(m, `${voice.name || 'The voice'} sings`);
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
            : <button className="btn primary big" disabled={!!noteError} onClick={() => void go()}>♪ Sing</button>}
        <button className="btn" disabled={!mix} onClick={() => mix && void playMix(mix, 'Again')}>▶ Again</button>
        <button className="btn" disabled={!mix} onClick={() => mix && saveWav(mix, `${voice.name || 'voice'} - ${p.name}`)}>⇩ WAV</button>
      </div>
      <p className="muted small">{p.hint}. The voice you are editing sings it: change it in Design and sing again.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={tempo} min={40} max={200} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} />
        <Slider label="Transpose" value={transpose} min={-24} max={12} step={1} onChange={setTranspose} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} hint="semitones: −12 an octave down, for a man’s voice" />
        <Slider label="Vibrato" value={vibrato} min={0} max={1} step={0.05} onChange={setVibrato} format={(v) => `±${v.toFixed(2)} st`} hint="how far the pitch swings on a held note, semitones either way" />
        <Toggle label="Tune by ear" value={tune} onChange={setTune} hint="sings once, measures every note, sings again with each note put in tune (twice as long)" />
      </div>
      <label className="music-field">
        <span>Notes <small className="muted">C4 is middle C · :2 two beats · r a rest · ~ goes on with the syllable · | for the eye</small></span>
        <textarea className="music-notes" rows={3} value={notes} spellCheck={false} onChange={(e) => setNotes(e.target.value)} />
        {noteError && <small className="music-problem">{noteError}</small>}
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

const STEPS = 16;
const cycle = (c: string) => (c === '.' ? 'x' : c === 'x' ? 'X' : '.');
const fill = (p: string | undefined) => (p ?? '').replace(/[^.xXo>]/g, '').padEnd(STEPS, '.').slice(0, STEPS);

function BeatBench({ voice }: { voice: VoiceDesign }) {
  const [preset, setPreset] = useState(BEATS[0].id);
  const b = BEATS.find((x) => x.id === preset) ?? BEATS[0];
  const [tempo, setTempo] = useState(b.tempo);
  const [swing, setSwing] = useState(b.swing);
  const [repeat, setRepeat] = useState(2);
  const [sounds, setSounds] = useState<Record<string, string>>(() => Object.fromEntries(BEATBOX_KIT.map((k) => [k.id, k.ipa])));
  const [grid, setGrid] = useState<Record<string, string>>(() => Object.fromEntries(BEATBOX_KIT.map((k) => [k.id, fill(b.tracks[k.id])])));
  const [mix, setMix] = useState<Stereo | null>(null);
  const job = useJob();
  const speaking = useLanes().performer.kind !== 'hands';
  const pick = (id: string) => {
    const x = BEATS.find((q) => q.id === id)!;
    setPreset(id); setTempo(x.tempo); setSwing(x.swing);
    setGrid(Object.fromEntries(BEATBOX_KIT.map((k) => [k.id, fill(x.tracks[k.id])])));
  };
  const tracks = () => BEATBOX_KIT.map((k) => ({ sound: sounds[k.id], f0: k.f0, pattern: grid[k.id] })).filter((t) => /[xXo>]/.test(t.pattern));

  const run = async (req: MusicRequest, label: string, room: number) => {
    wakeSound();
    job.setProblem(''); job.setBusy('Making the sounds…');
    const r = makeParts([req]);
    job.stop.current = r.stop;
    const [o] = await r.done;
    job.setBusy('');
    if (!o.performance) { if (o.error) job.setProblem(o.error); return null; }
    const m = arrangeParts([{ performance: o.performance }], { tempo, room, size: 0.3 });
    void playMix(m, label);
    return m;
  };
  const play = async () => {
    const t = tracks();
    if (!t.length) { job.setProblem('Nothing on the grid: click the steps to put hits on them.'); return; }
    const m = await run({ kind: 'beat', voice, tracks: t, opts: { tempo, swing, repeat, fs: musicRate() } }, `${voice.name || 'The voice'} beatboxes`, 0.08);
    if (m) setMix(m);
  };
  const audition = (id: string) => void run({ kind: 'beat', voice, tracks: [{ sound: sounds[id], f0: BEATBOX_KIT.find((k) => k.id === id)!.f0, pattern: 'x' }], opts: { tempo, fs: musicRate() } }, `[${sounds[id]}]`, 0);

  return (
    <div className="music-bench">
      <div className="music-row">
        <select className="text-input music-pick" value={preset} onChange={(e) => pick(e.target.value)} aria-label="Beat">
          {BEATS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {job.busy
          ? <button className="btn big" onClick={() => { job.stop.current(); job.setBusy(''); }}>■ Stop</button>
          : speaking
            ? <button className="btn big" onClick={stopPlaying}>■ Stop</button>
            : <button className="btn primary big" onClick={() => void play()}>▶ Play</button>}
        <button className="btn" disabled={!mix} onClick={() => mix && void playMix(mix, 'Again')}>▶ Again</button>
        <button className="btn" disabled={!mix} onClick={() => mix && saveWav(mix, `${voice.name || 'voice'} - ${b.name}`)}>⇩ WAV</button>
      </div>
      <p className="muted small">{b.hint}. Every drum is a sound of the mouth of the voice you are editing (a bigger head, a deeper kit). Click a step: a hit, again: an accent, again: nothing.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={tempo} min={50} max={180} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} />
        <Slider label="Swing" value={swing} min={0} max={0.6} step={0.05} onChange={setSwing} format={(v) => v.toFixed(2)} hint="every second step played a little late" />
        <Slider label="Bars" value={repeat} min={1} max={8} step={1} onChange={setRepeat} format={(v) => `${Math.round(v)}`} />
      </div>
      <div className="beat-grid" role="grid" aria-label="Steps">
        {BEATBOX_KIT.map((k) => (
          <div key={k.id} className="beat-row" role="row">
            <span className="beat-name" title={k.hint}>{k.name}</span>
            <select className="beat-sound" value={sounds[k.id]} aria-label={`Sound of ${k.name}`} onChange={(e) => setSounds({ ...sounds, [k.id]: e.target.value })}>
              {[k.ipa, ...k.alternatives].map((s) => <option key={s} value={s}>[{s}]</option>)}
            </select>
            <button className="chip" title={`Hear [${sounds[k.id]}] once`} onClick={() => audition(k.id)}>▶</button>
            <div className="beat-steps">
              {[...grid[k.id]].map((c, i) => (
                <button key={i} className={`beat-step${c === 'x' ? ' on' : c === 'X' || c === '>' ? ' accent' : ''}${i % 4 === 0 ? ' beat' : ''}`}
                  aria-label={`${k.name}, step ${i + 1}`} onClick={() => setGrid({ ...grid, [k.id]: grid[k.id].slice(0, i) + cycle(c) + grid[k.id].slice(i + 1) })} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {job.busy && <p className="music-busy">{job.busy}</p>}
      {job.problem && <p className="music-problem">{job.problem}</p>}
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
      const b = BEATS.find((x) => x.id === p.beat)!;
      const sounds = Object.fromEntries(BEATBOX_KIT.map((k) => [k.id, { sound: k.ipa, f0: k.f0 }]));
      return { kind: 'beat', voice, tracks: beatTracks(b, sounds), opts: { tempo, swing: e.swing ?? b.swing, repeat: e.repeat ?? 2, fs: musicRate() } };
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

  const perform = async () => {
    wakeSound();
    job.setProblem(''); job.setBusy('Getting the words…');
    try {
      const reqs = await Promise.all(parts.map(requestOf));
      const keys = reqs.map((r) => JSON.stringify(r));
      const next: (Made | null)[] = parts.map((_, i) => (made[i]?.key === keys[i] ? made[i] : null));
      const todo = next.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
      setStatus(parts.map((_, i) => (next[i] ? 'ready' : 'waiting')));
      job.setBusy(todo.length ? `Making ${todo.length} part${todo.length > 1 ? 's' : ''} (a few at a time)…` : '');
      if (todo.length) {
        const run = makeParts(todo.map((i) => reqs[i]), (k, o) => {
          const i = todo[k];
          next[i] = { key: keys[i], out: o };
          setStatus((st) => st.map((x, j) => (j === i ? (o.performance ? 'ready' : `failed: ${o.error ?? ''}`) : x)));
        });
        job.stop.current = run.stop;
        await run.done;
      }
      job.setBusy('');
      setMade(next);
      const m = remix(next);
      if (m) void playMix(m, e.name);
    } catch (err) { job.setBusy(''); job.setProblem((err as Error).message); }
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
      <p className="muted small">{e.hint}. Each part is made by its own voice (yours too, from the library) away from the page, a few at a time; then they are heard together. Level, place and room change without making the parts again.</p>
      <div className="music-grid2">
        <Slider label="Tempo" value={tempo} min={40} max={200} step={1} onChange={setTempo} format={(v) => `${Math.round(v)} bpm`} />
        <Slider label="Room" value={room} min={0} max={0.6} step={0.01} onChange={setRoom} format={(v) => v.toFixed(2)} hint="how much of the room is heard" />
      </div>
      <div className="part-list">
        {parts.map((p, i) => (
          <div key={i} className={p.mute ? 'part-row muted-part' : 'part-row'}>
            <div className="part-head">
              <b className="part-name">{p.name}</b>
              <select className="part-voice" value={p.voice} aria-label={`Voice of ${p.name}`} onChange={(ev) => setPart(i, { voice: ev.target.value })}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <span className="muted small part-what">{p.beat ? `beatbox: ${BEATS.find((b) => b.id === p.beat)?.name}` : p.song ? SONGS.find((s) => s.id === p.song)?.name : p.lyrics ? `on “${p.lyrics.split(' ')[0]}”` : `on “${p.vowel ?? 'a'}”`}</span>
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
