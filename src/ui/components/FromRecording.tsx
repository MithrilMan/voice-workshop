import { useRef, useState } from 'react';
import { useL } from '../i18n';
import { store } from '../store';
import { decodeRecording, playRecording, recordMicrophone, startFit, FitOutcome, FitStatus, Recording } from '../voice/fitter';
import { PASSAGES } from '../../dsp/voice/fit';
import { VoiceDesign, newVoiceId } from '../../dsp/voice/design';
import { textToPhones, ipaKind, Phone } from '../../dsp/speech/g2p';
import { SPEECH_LANGUAGES, speechLanguage } from '../../dsp/speech/languages';

type Bi = { it: string; en: string };

/** with the text, a recording up to this long is compared second by second */
const SAME_TEXT_MAX = 20;

const STAGES: Record<string, Bi> = {
  start: { it: 'misura', en: 'measuring' }, pitch: { it: 'altezza', en: 'pitch' }, melody: { it: 'melodia', en: 'melody' },
  body: { it: 'corpo e formanti', en: 'body and formants' }, folds: { it: 'corde vocali', en: 'vocal folds' }, hiss: { it: 'fruscii', en: 'hiss' },
  pace: { it: 'ritmo', en: 'pace' }, polish: { it: 'rifinitura', en: 'last pass' }, done: { it: 'fatto', en: 'done' },
};
const MEASURES: Record<string, Bi> = {
  f0: { it: 'Altezza', en: 'Pitch' }, below: { it: 'Discesa sotto la mediana', en: 'Range below the median' }, above: { it: 'Salita sopra la mediana', en: 'Range above the median' },
  f0Sd: { it: 'Escursione', en: 'Pitch spread' }, F1: { it: 'F1', en: 'F1' }, F2: { it: 'F2', en: 'F2' }, F3: { it: 'F3', en: 'F3' }, F4: { it: 'F4', en: 'F4' },
  h1h2: { it: 'H1-H2 (forma dell’impulso)', en: 'H1-H2 (shape of the pulse)' }, cpp: { it: 'Periodicità (CPP)', en: 'Periodicity (CPP)' },
  a1: { it: 'H1-A1 (voce su F1)', en: 'H1-A1 (voice at F1)' }, a2: { it: 'H1-A2 (voce su F2)', en: 'H1-A2 (voice at F2)' }, a3: { it: 'H1-A3 (voce su F3)', en: 'H1-A3 (voice at F3)' },
  b1: { it: 'Voce 0,5-1 kHz', en: 'Voice 0.5-1 kHz' }, b2: { it: 'Voce 1-2 kHz', en: 'Voice 1-2 kHz' }, b3: { it: 'Voce 2-4 kHz', en: 'Voice 2-4 kHz' }, b4: { it: 'Voce 4-8 kHz', en: 'Voice 4-8 kHz' },
  h0: { it: 'Fruscio 2-4 kHz', en: 'Hiss 2-4 kHz' }, h1: { it: 'Fruscio 4-8 kHz', en: 'Hiss 4-8 kHz' }, h2: { it: 'Fruscio 8-10,5 kHz', en: 'Hiss 8-10.5 kHz' },
  speech: { it: 'Tempo di parola', en: 'Time speaking' }, syllables: { it: 'Sillabe al secondo', en: 'Syllables per second' }, pause: { it: 'Pausa media', en: 'Mean pause' },
};

const num = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 1 : 2)) : '–');

/**
 * A voice estimated from a recording: it is measured, and a voice of the
 * simulator is said and measured again while its fields are moved toward
 * it. Opens the result in the editor, not saved.
 */
export function FromRecording({ lang, onVoice }: { lang: string; onVoice: (d: VoiceDesign) => void }) {
  const L = useL();
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
    try { setRec(await decodeRecording(f)); } catch { setRec(null); setError(L({ it: 'Questo file non si legge come audio.', en: 'This file cannot be read as audio.' })); }
  };

  const toggleMic = async () => {
    if (mic.current) {
      const m = mic.current;
      mic.current = null;
      window.clearInterval(recording);
      setRecording(0);
      try { const r = await m.stop(); setRec({ ...r, name: L({ it: 'microfono', en: 'microphone' }) }); } catch { setError(L({ it: 'La registrazione non si legge.', en: 'The recording cannot be read.' })); }
      return;
    }
    setResult(null); setError(''); setStatus(null);
    try {
      mic.current = await recordMicrophone();
      const t0 = Date.now();
      setRecording(window.setInterval(() => setSeconds((Date.now() - t0) / 1000), 250));
    } catch { setError(L({ it: 'Il microfono non è disponibile (permesso negato o assente).', en: 'The microphone is not available (permission denied or none).' })); }
  };
  const [seconds, setSeconds] = useState(0);

  const run = async () => {
    if (!rec) return;
    setResult(null); setError('');
    const sameText = !!text.trim() && rec.seconds <= SAME_TEXT_MAX;
    // a passage in another language would be compared with other sounds and another rhythm
    if (!sameText && !PASSAGES[recLang]) {
      setError(L({ it: `In questa lingua serve il testo di una registrazione di ${SAME_TEXT_MAX} s al massimo: non c’è un brano da far dire alla voce.`, en: `In this language the text of a recording of ${SAME_TEXT_MAX} s at most is needed: there is no passage for the voice to say.` }));
      return;
    }
    const say = sameText ? text.trim() : PASSAGES[recLang];
    const sayLang = recLang;
    if (sayLang === 'en') await store.ensureLexicon();
    if (speechLanguage(sayLang) && !ipaKind(say)) await store.ensurePhonemes(say, sayLang, true);
    let phones: Phone[];
    try { phones = textToPhones(say, sayLang); } catch { phones = []; }
    if (!phones.length) { setError(L({ it: 'Il testo non si legge in questa lingua.', en: 'The text cannot be read in this language.' })); return; }
    setStatus({ stage: 'start', evaluations: 0, budget: 1, distance: NaN });
    const j = startFit(rec, [{ phones, lang: sayLang }], sameText, fine ? 1 : 0.5, setStatus);
    job.current = j;
    try {
      const out = await j.done;
      setResult(out);
      const name = L({ it: `Da «${rec.name || 'registrazione'}»`, en: `From “${rec.name || 'recording'}”` });
      const f0 = out.measures.find((m) => m.key === 'f0');
      const notes = L({
        it: `Stimata da una registrazione di ${rec.seconds.toFixed(1)} s${sameText ? ', con il suo testo' : ''}${f0 ? `: altezza ${num(f0.now)} Hz (registrazione ${num(f0.target)})` : ''}; distanza ${out.startDistance.toFixed(2)} → ${out.distance.toFixed(2)}${out.stopped ? ' (fermata prima della fine)' : ''}. Una voce dello stesso tipo, non una copia.`,
        en: `Estimated from a recording of ${rec.seconds.toFixed(1)} s${sameText ? ', with its text' : ''}${f0 ? `: pitch ${num(f0.now)} Hz (recording ${num(f0.target)})` : ''}; distance ${out.startDistance.toFixed(2)} → ${out.distance.toFixed(2)}${out.stopped ? ' (stopped before the end)' : ''}. A voice of the same kind, not a copy.`,
      });
      onVoice({ ...out.design, id: newVoiceId(), name, notes, language: recLang });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '';
      setError(reason === 'novoice' ? L({ it: 'Nella registrazione non c’è abbastanza voce da misurare.', en: 'There is not enough voice in the recording to measure.' })
        : reason === 'stopped' ? '' : L({ it: `La stima si è interrotta: ${reason}`, en: `The estimate stopped: ${reason}` }));
      setStatus(null);
    } finally { job.current = null; }
  };

  return (
    <div className="fit-panel">
      <div className="row">
        <button className="chip" disabled={running || !!recording} onClick={() => fileRef.current?.click()}>⇪ {L({ it: 'Scegli un file audio', en: 'Choose an audio file' })}</button>
        <button className={recording ? 'chip on' : 'chip'} disabled={running} onClick={() => void toggleMic()}
          title={L({ it: 'Registra dal microfono: leggi il testo ad alta voce, poi premi di nuovo', en: 'Record from the microphone: read the text aloud, then press again' })}>
          {recording ? `■ ${L({ it: 'Fine', en: 'Done' })} (${seconds.toFixed(0)} s)` : `🎙 ${L({ it: 'Registra', en: 'Record' })}`}
        </button>
        <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
        {rec && <button className="chip" onClick={() => void playRecording(rec, { it: rec.name, en: rec.name })} title={L({ it: 'Ascolta la registrazione', en: 'Listen to the recording' })}>▶ {rec.name.slice(0, 18) || '…'} ({rec.seconds.toFixed(1)} s)</button>}
      </div>
      {rec && (
        <>
          <div className="row">
            <label className="small">{L({ it: 'Lingua della registrazione', en: 'Language of the recording' })}{' '}
              <select className="lang-pick" value={recLang} disabled={running} onChange={(e) => setRecLang(e.target.value)}>
                <option value="it">{L({ it: 'Italiano', en: 'Italian' })}</option>
                <option value="en">{L({ it: 'Inglese (americano)', en: 'English (American)' })}</option>
                {[...SPEECH_LANGUAGES].sort((a, b) => L(a.name).localeCompare(L(b.name))).map((l) => <option key={l.code} value={l.code}>{L(l.name)}</option>)}
              </select>
            </label>
          </div>
          <textarea className="studio-notes" rows={2} value={text} disabled={running} maxLength={600} onChange={(e) => setText(e.target.value)}
            aria-label={L({ it: 'Che cosa dice la registrazione', en: 'What the recording says' })}
            placeholder={L({ it: 'Che cosa dice (facoltativo in italiano e in inglese, dove la voce sa dire un brano suo): con il testo il ritmo si confronta meglio.', en: 'What it says (optional in Italian and English, where the voice has a passage of its own): with the text its pace is compared better.' })} />
          {text.trim() && rec.seconds > SAME_TEXT_MAX && <p className="muted small">{L({ it: `Oltre ${SAME_TEXT_MAX} s il testo non si usa: la voce dice un brano suo.`, en: `Beyond ${SAME_TEXT_MAX} s the text is not used: the voice says a passage of its own.` })}</p>}
          <div className="row">
            <label className="small"><input type="checkbox" checked={fine} disabled={running} onChange={(e) => setFine(e.target.checked)} /> {L({ it: 'Accurata (più lenta)', en: 'Thorough (slower)' })}</label>
            {running
              ? <button className="btn" onClick={() => job.current?.stop()} title={L({ it: 'Tiene la voce migliore trovata finora', en: 'Keeps the best voice found so far' })}>■ {L({ it: 'Ferma', en: 'Stop' })}</button>
              : <button className="btn primary" onClick={() => void run()}>{L({ it: 'Stima la voce', en: 'Estimate the voice' })}</button>}
          </div>
        </>
      )}
      {running && status && (
        <div className="fit-status">
          <progress max={status.budget} value={Math.min(status.evaluations, status.budget)} />
          <span className="small">{L(STAGES[status.stage] ?? { it: status.stage, en: status.stage })} · {status.evaluations}/{status.budget}{Number.isFinite(status.distance) ? ` · ${L({ it: 'distanza', en: 'distance' })} ${status.distance.toFixed(2)}` : ''}</span>
        </div>
      )}
      {error && <p className="small warn">{error}</p>}
      {result && (
        <>
          <p className="small">{L({ it: `Distanza ${result.startDistance.toFixed(2)} → ${result.distance.toFixed(2)} in ${result.evaluations} prove. La voce è aperta qui accanto, non ancora salvata.`, en: `Distance ${result.startDistance.toFixed(2)} → ${result.distance.toFixed(2)} in ${result.evaluations} trials. The voice is open beside, not saved yet.` })}</p>
          {result.measures.length > 0 && (
            <table className="fit-table">
              <thead><tr><th>{L({ it: 'Misura', en: 'Measure' })}</th><th>{L({ it: 'Registr.', en: 'Rec.' })}</th><th>{L({ it: 'Voce', en: 'Voice' })}</th></tr></thead>
              <tbody>
                {result.measures.map((m) => <tr key={m.key}><td>{L(MEASURES[m.key] ?? { it: m.label, en: m.label })} <span className="muted">{m.unit}</span></td><td>{num(m.target)}</td><td>{num(m.now)}</td></tr>)}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
