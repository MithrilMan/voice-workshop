import { useRef, useState } from 'react';
import { store } from '../store';
import { LanguagePick } from './LanguagePick';
import { decodeRecording, playRecording, recordMicrophone, startFit, FitOutcome, FitStatus, Recording } from '../voice/fitter';
import { PASSAGES } from '../../dsp/voice/fit';
import { VoiceDesign, newVoiceId } from '../../dsp/voice/design';
import { textToPhones, ipaKind, Phone } from '../../dsp/speech/g2p';
import { speechLanguage } from '../../dsp/speech/languages';

/** with the text, a recording up to this long is compared second by second */
const SAME_TEXT_MAX = 20;

const STAGES: Record<string, string> = {
  start: 'measuring', pitch: 'pitch', melody: 'melody',
  body: 'body and formants', folds: 'vocal folds', hiss: 'hiss',
  pace: 'pace', polish: 'last pass', done: 'done',
};
const MEASURES: Record<string, string> = {
  f0: 'Pitch', below: 'Range below the median', above: 'Range above the median',
  f0Sd: 'Pitch spread', F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4',
  h1h2: 'H1-H2 (shape of the pulse)', cpp: 'Periodicity (CPP)',
  a1: 'H1-A1 (voice at F1)', a2: 'H1-A2 (voice at F2)', a3: 'H1-A3 (voice at F3)',
  b1: 'Voice 0.5-1 kHz', b2: 'Voice 1-2 kHz', b3: 'Voice 2-4 kHz', b4: 'Voice 4-8 kHz',
  h0: 'Hiss 2-4 kHz', h1: 'Hiss 4-8 kHz', h2: 'Hiss 8-10.5 kHz',
  speech: 'Time speaking', syllables: 'Syllables per second', pause: 'Mean pause',
};

const num = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 1 : 2)) : '–');

/**
 * A voice estimated from a recording: it is measured, and a voice of the
 * simulator is said and measured again while its fields are moved toward
 * it. Opens the result in the editor, not saved.
 */
export function FromRecording({ lang, onVoice }: { lang: string; onVoice: (d: VoiceDesign) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [text, setText] = useState('');
  // the language the recording speaks: its text, or the passage, is said in it
  const [recLang, setRecLang] = useState(lang);
  const [fine, setFine] = useState(false);
  const [status, setStatus] = useState<FitStatus | null>(null);
  const [result, setResult] = useState<FitOutcome | null>(null);
  const [error, setError] = useState('');
  const job = useRef<{ stop: () => void } | null>(null);
  const mic = useRef<{ stop: () => Promise<Recording> } | null>(null);
  const [recording, setRecording] = useState(0);
  const running = status !== null && !result && !error;

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setResult(null); setError(''); setStatus(null);
    try { setRec(await decodeRecording(f)); } catch { setRec(null); setError('This file cannot be read as audio.'); }
  };

  const toggleMic = async () => {
    if (mic.current) {
      const m = mic.current;
      mic.current = null;
      window.clearInterval(recording);
      setRecording(0);
      try { const r = await m.stop(); setRec({ ...r, name: 'microphone' }); } catch { setError('The recording cannot be read.'); }
      return;
    }
    setResult(null); setError(''); setStatus(null);
    try {
      mic.current = await recordMicrophone();
      const t0 = Date.now();
      setRecording(window.setInterval(() => setSeconds((Date.now() - t0) / 1000), 250));
    } catch { setError('The microphone is not available (permission denied or none).'); }
  };
  const [seconds, setSeconds] = useState(0);

  const run = async () => {
    if (!rec) return;
    setResult(null); setError('');
    const sameText = !!text.trim() && rec.seconds <= SAME_TEXT_MAX;
    // a passage in another language would be compared with other sounds and another rhythm
    if (!sameText && !PASSAGES[recLang]) {
      setError(`In this language the text of a recording of ${SAME_TEXT_MAX} s at most is needed: there is no passage for the voice to say.`);
      return;
    }
    const say = sameText ? text.trim() : PASSAGES[recLang];
    const sayLang = recLang;
    if (sayLang === 'en') await store.ensureLexicon();
    if (speechLanguage(sayLang) && !ipaKind(say)) await store.ensurePhonemes(say, sayLang, true);
    let phones: Phone[];
    try { phones = textToPhones(say, sayLang); } catch { phones = []; }
    if (!phones.length) { setError('The text cannot be read in this language.'); return; }
    setStatus({ stage: 'start', evaluations: 0, budget: 1, distance: NaN });
    const j = startFit(rec, [{ phones, lang: sayLang }], sameText, fine ? 1 : 0.5, setStatus);
    job.current = j;
    try {
      const out = await j.done;
      setResult(out);
      const name = `From “${rec.name || 'recording'}”`;
      const f0 = out.measures.find((m) => m.key === 'f0');
      const notes = `Estimated from a recording of ${rec.seconds.toFixed(1)} s${sameText ? ', with its text' : ''}${f0 ? `: pitch ${num(f0.now)} Hz (recording ${num(f0.target)})` : ''}; distance ${out.startDistance.toFixed(2)} → ${out.distance.toFixed(2)}${out.stopped ? ' (stopped before the end)' : ''}. A voice of the same kind, not a copy.`;
      onVoice({ ...out.design, id: newVoiceId(), name, notes, language: recLang });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '';
      setError(reason === 'novoice' ? 'There is not enough voice in the recording to measure.'
        : reason === 'stopped' ? '' : `The estimate stopped: ${reason}`);
      setStatus(null);
    } finally { job.current = null; }
  };

  return (
    <div className="fit-panel">
      <div className="row">
        <button className="chip" disabled={running || !!recording} onClick={() => fileRef.current?.click()}>⇪ Choose an audio file</button>
        <button className={recording ? 'chip on' : 'chip'} disabled={running} onClick={() => void toggleMic()}
          title={'Record from the microphone: read the text aloud, then press again'}>
          {recording ? `■ Done (${seconds.toFixed(0)} s)` : `🎙 Record`}
        </button>
        <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
        {rec && <button className="chip" onClick={() => void playRecording(rec, rec.name)} title={'Listen to the recording'}>▶ {rec.name.slice(0, 18) || '…'} ({rec.seconds.toFixed(1)} s)</button>}
      </div>
      {rec && (
        <>
          <div className="row">
            <label className="small">Language of the recording{' '}
              <LanguagePick value={recLang} disabled={running} onChange={setRecLang} />
            </label>
          </div>
          <textarea className="studio-notes" rows={2} value={text} disabled={running} maxLength={600} onChange={(e) => setText(e.target.value)}
            aria-label={'What the recording says'}
            placeholder={'What it says (optional in Italian and English, where the voice has a passage of its own): with the text its pace is compared better.'} />
          {text.trim() && rec.seconds > SAME_TEXT_MAX && <p className="muted small">{`Beyond ${SAME_TEXT_MAX} s the text is not used: the voice says a passage of its own.`}</p>}
          <div className="row">
            <label className="small"><input type="checkbox" checked={fine} disabled={running} onChange={(e) => setFine(e.target.checked)} /> Thorough (slower)</label>
            {running
              ? <button className="btn" onClick={() => job.current?.stop()} title={'Keeps the best voice found so far'}>■ Stop</button>
              : <button className="btn primary" onClick={() => void run()}>Estimate the voice</button>}
          </div>
        </>
      )}
      {running && status && (
        <div className="fit-status">
          <progress max={status.budget} value={Math.min(status.evaluations, status.budget)} />
          <span className="small">{STAGES[status.stage] ?? status.stage} · {status.evaluations}/{status.budget}{Number.isFinite(status.distance) ? ` · distance ${status.distance.toFixed(2)}` : ''}</span>
        </div>
      )}
      {error && <p className="small warn">{error}</p>}
      {result && (
        <>
          <p className="small">{`Distance ${result.startDistance.toFixed(2)} → ${result.distance.toFixed(2)} in ${result.evaluations} trials. The voice is open beside, not saved yet.`}</p>
          {result.measures.length > 0 && (
            <table className="fit-table">
              <thead><tr><th>Measure</th><th>Rec.</th><th>Voice</th></tr></thead>
              <tbody>
                {result.measures.map((m) => <tr key={m.key}><td>{MEASURES[m.key] ?? m.label} <span className="muted">{m.unit}</span></td><td>{num(m.target)}</td><td>{num(m.now)}</td></tr>)}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
