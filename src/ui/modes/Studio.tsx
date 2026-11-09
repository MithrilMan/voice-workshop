import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useL } from '../i18n';
import { store, useUi } from '../store';
import { voice } from '../voice/voice';
import { useLanes } from '../voice/hooks';
import { library, useLibrary } from '../library';
import { Pills } from '../ds';
import { Toggle } from '../components/controls';
import { VoiceField, sameValue } from '../components/VoiceField';
import { HeadView } from '../components/HeadView';
import { ViewFrame } from './views';
import { PhonemeButtons } from './quick';
import { VOICE_FIELDS, Tab, VoiceDesign, cloneVoice, fieldValue, newVoiceId, speechOptions, withField } from '../../dsp/voice/design';
import { BUILTIN_VOICES } from '../../dsp/voice/builtin';
import { voiceToJson, voiceFromJson, voiceToLink, voiceFileName } from '../../dsp/voice/codec';
import { SPEECH_LANGUAGES, speechLanguage } from '../../dsp/speech/languages';
import { textToPhones, ipaKind } from '../../dsp/speech/g2p';
import { buildScore } from '../../dsp/speech/sequencer';
import type { ViewTab } from '../store';

type Bi = { it: string; en: string };

const TABS: [Tab, Bi, Bi][] = [
  ['body', { it: 'Corpo', en: 'Body' }, { it: 'misure del tratto, naso e denti', en: 'size of the tract, nose and teeth' }],
  ['phonation', { it: 'Voce', en: 'Voice' }, { it: 'come vibrano le corde vocali', en: 'how the vocal folds vibrate' }],
  ['habits', { it: 'Abitudini', en: 'Habits' }, { it: 'la postura tenuta sotto ogni suono', en: 'the posture kept beneath every sound' }],
  ['melody', { it: 'Melodia', en: 'Melody' }, { it: 'altezza, accenti, fine delle frasi', en: 'pitch, accents, ends of phrases' }],
  ['rhythm', { it: 'Ritmo e fiato', en: 'Rhythm and breath' }, { it: 'velocità, pause, intensità', en: 'pace, pauses, loudness' }],
];

/** sentences that show a melody, in the language of the interface */
const PATTERNS: Record<'it' | 'en', [Bi, string][]> = {
  it: [[{ it: 'Affermazione', en: 'Statement' }, 'la luna è piena stanotte.'], [{ it: 'Domanda sì/no', en: 'Yes/no question' }, 'vieni anche tu domani?'],
    [{ it: 'Domanda con «dove»', en: 'Question with "where"' }, 'dove hai messo le chiavi?'], [{ it: 'Elenco', en: 'List' }, 'pane, latte, uova e caffè.']],
  en: [[{ it: 'Affermazione', en: 'Statement' }, 'the moon is full tonight.'], [{ it: 'Domanda sì/no', en: 'Yes/no question' }, 'are you coming tomorrow?'],
    [{ it: 'Domanda con «dove»', en: 'Question with "where"' }, 'where did you put the keys?'], [{ it: 'Elenco', en: 'List' }, 'bread, milk, eggs and coffee.']],
};

/** The pitch the voice would give the test sentence, with its sounds under it. */
function MelodyPreview({ d, text, lang }: { d: VoiceDesign; text: string; lang: string }) {
  const L = useL();
  const dd = useDeferredValue(d);
  const plot = useMemo(() => {
    let phones;
    try { phones = textToPhones(text, lang); } catch { return null; }
    if (!phones.length) return null;
    const sc = buildScore(phones, speechOptions(dd, lang));
    const pts = sc.frames.filter((f) => f.t <= sc.duration && f.ps > 0.5 && f.abduction < 0.3);
    if (pts.length < 2) return null;
    const st = (f: number) => 12 * Math.log2(f / dd.speaking.f0);
    const lo = Math.min(-6, ...pts.map((f) => st(f.f0))), hi = Math.max(8, ...pts.map((f) => st(f.f0)));
    const W = 640, H = 120, x = (t: number) => (t / sc.duration) * W, y = (s: number) => H - 14 - ((s - lo) / (hi - lo)) * (H - 24);
    let path = '', last = -2;
    for (const f of pts) { const i = Math.round(f.t / 0.005); path += `${path && i === last + 1 ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(st(f.f0)).toFixed(1)}`; last = i; }
    return { W, H, path, base: y(0), phones: sc.phones.filter((p) => p.ipa !== '_').map((p) => ({ x: x(0.5 * (p.t0 + p.t1)), ipa: p.ipa })), range: [Math.round(lo), Math.round(hi)] };
  }, [dd, text, lang]);
  if (!plot) return <p className="muted small">{L({ it: 'Scrivi una frase per vederne la melodia.', en: 'Type a sentence to see its melody.' })}</p>;
  return (
    <figure className="melody-preview">
      <svg viewBox={`0 0 ${plot.W} ${plot.H}`} role="img" aria-label={L({ it: 'Curva di altezza prevista', en: 'Planned pitch curve' })}>
        <line x1={0} x2={plot.W} y1={plot.base} y2={plot.base} className="mp-base" />
        <path d={plot.path} className="mp-curve" />
        {plot.phones.map((p, i) => <text key={i} x={p.x} y={plot.H - 2} className="mp-ipa">{p.ipa}</text>)}
      </svg>
      <figcaption className="muted small">{L({ it: `L’altezza prevista, in semitoni dall’altezza abituale (linea): da ${plot.range[0]} a +${plot.range[1]}.`, en: `The planned pitch, in semitones from the usual pitch (the line): ${plot.range[0]} to +${plot.range[1]}.` })}</figcaption>
    </figure>
  );
}

function download(d: VoiceDesign): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([voiceToJson(d)], { type: 'application/json' }));
  a.download = voiceFileName(d);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const PREFS = 'voice-workshop.studio';
interface Prefs { hints: boolean; auto: boolean }
/** what the studio remembers in this browser: explanations unfolded, saying the sentence again after a change */
function loadPrefs(): Prefs {
  try {
    const o = JSON.parse(window.localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return { hints: o.hints === true, auto: o.auto === true };
  } catch { return { hints: false, auto: false }; }
}

/**
 * The voice studio: a library of voices (the ones that come with the
 * simulator, yours, one received with a link) and an editor of every part of
 * a voice, in five tabs. The bar on top (the voice's name, saving and
 * sharing, the test sentence and Listen) and the head stay in place while
 * the fields scroll. A change is heard at once: the voice being edited is
 * the voice.
 */
export function Studio() {
  const L = useL();
  const ui = useUi();
  const lib = useLibrary();
  const speaking = useLanes().performer.kind === 'sentence';
  const [draft, setDraft] = useState<VoiceDesign>(() => cloneVoice(lib.incoming ?? (voice.active as VoiceDesign)));
  /** the voice as it was opened or last saved: what the changes are heard against */
  const [origin, setOrigin] = useState<VoiceDesign>(() => cloneVoice(draft));
  const [tab, setTab] = useState<Tab>('body');
  const [text, setText] = useState(() => PATTERNS[ui.lang][0][1]);
  const [lang, setLang] = useState<string>(() => draft.language || ui.lang);
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState(false);
  const [view, setView] = useState<ViewTab>('spectrum');
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(origin);
  const mine = lib.voices.some((v) => v.id === draft.id);
  /** how many fields differ from the voice as it was, in all and in each tab */
  const diff = useMemo(() => {
    const by: Record<Tab, number> = { body: 0, phonation: 0, habits: 0, melody: 0, rhythm: 0 };
    let n = 0;
    for (const f of VOICE_FIELDS) if (!sameValue(f, fieldValue(draft, f), fieldValue(origin, f))) { by[f.tab]++; n++; }
    return { by, n };
  }, [draft, origin]);
  const groups = useMemo(() => [...new Set(VOICE_FIELDS.filter((f) => f.tab === tab).map((f) => f.group))], [tab]);
  const setPrefs = (next: Partial<Prefs>) => {
    const p = { ...prefs, ...next };
    setPrefsState(p);
    try { window.localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* storage blocked */ }
  };

  // the voice being edited is the voice that sounds
  useEffect(() => { voice.useVoice(draft); }, [draft]);
  // the dictionary or the model of the language of the test sentence
  useEffect(() => {
    if (lang === 'en') void store.ensureLexicon();
    else if (speechLanguage(lang) && !ipaKind(text)) { const id = setTimeout(() => void store.ensurePhonemes(text, lang), 400); return () => clearTimeout(id); }
  }, [text, lang]);

  const open = (d: VoiceDesign) => { const c = cloneVoice(d); setDraft(c); setOrigin(c); setLink(''); if (c.language) setLang(c.language); };
  // a voice received with a link (decoded after the first render) opens at once
  useEffect(() => { if (lib.incoming) open(lib.incoming); }, [lib.incoming]);
  const info = (m: Bi) => store.setUi({ info: L(m) });

  const say = async (d: VoiceDesign) => {
    voice.useVoice(d);
    if (lang === 'en') await store.ensureLexicon();
    if (speechLanguage(lang) && !ipaKind(text)) await store.ensurePhonemes(text, lang, true);
    const ph = textToPhones(text, lang);
    if (!ph.length) return;
    await voice.speak(buildScore(ph, voice.speechOptions(lang)), { it: text, en: text });
    if (d !== draft) voice.useVoice(draft);
  };

  // saying the sentence again by itself after a change: when the slider is let go, or a moment after a key
  const live = useRef({ say: () => {}, auto: prefs.auto, down: false, pending: false, timer: 0 });
  live.current.say = () => void say(draft);
  live.current.auto = prefs.auto;
  const listenSoon = (ms: number) => {
    const s = live.current;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => { s.pending = false; s.say(); }, ms);
  };
  useEffect(() => {
    const s = live.current;
    const up = () => { s.down = false; if (s.pending && s.auto) listenSoon(120); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.clearTimeout(s.timer); };
  }, []);
  const set = (path: string, v: number | boolean | string) => {
    setDraft((d) => withField(d, path, v));
    const s = live.current;
    if (!s.auto) return;
    s.pending = true;
    if (s.down) window.clearTimeout(s.timer); else listenSoon(550);
  };

  const save = () => {
    const named = draft.name.trim() ? draft : { ...draft, name: L({ it: 'Voce senza nome', en: 'Unnamed voice' }) };
    const s = library.save(named);
    open(s);
    info({ it: `«${s.name}» è salvata in questo browser.`, en: `“${s.name}” is saved in this browser.` });
  };
  const share = async () => {
    const frag = await voiceToLink(draft);
    const url = `${window.location.origin}${window.location.pathname}?mode=voices#${frag}`;
    setLink(url);
    try { await navigator.clipboard.writeText(url); info({ it: 'Link copiato: chi lo apre trova questa voce.', en: 'Link copied: whoever opens it gets this voice.' }); } catch { /* shown in the bar */ }
  };
  const importText = (t: string) => {
    const v = voiceFromJson(t);
    if (!v) { info({ it: 'Questo file non è una voce.', en: 'This file is not a voice.' }); return; }
    const s = library.save(v);
    open(s);
    info({ it: `«${s.name || '…'}» è nella tua libreria.`, en: `“${s.name || '…'}” is in your library.` });
  };
  const importFiles = (files: FileList | null) => { for (const f of Array.from(files ?? []).slice(0, 10)) if (f.size < 200000) void f.text().then(importText); };

  return (
    <main className="studio" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void say(draft); } }}>
      <aside className="studio-lib ds-card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files); }}>
        {lib.incoming && (
          <div className="studio-incoming">
            <p>{L({ it: 'Una voce ricevuta con un link:', en: 'A voice received with a link:' })} <b>{lib.incoming.name || '…'}</b></p>
            <div className="row">
              <button className="btn primary" onClick={() => { const s = library.save(lib.incoming!); open(s); }}>{L({ it: 'Salva nella libreria', en: 'Save to the library' })}</button>
              <button className="chip" onClick={() => open(lib.incoming!)}>{L({ it: 'Apri', en: 'Open' })}</button>
              <button className="chip" onClick={() => library.setIncoming(null)}>{L({ it: 'Ignora', en: 'Dismiss' })}</button>
            </div>
          </div>
        )}
        <h3>{L({ it: 'Le tue voci', en: 'Your voices' })}</h3>
        {lib.voices.length === 0 && <p className="muted small">{L({ it: 'Nessuna ancora: parti da una voce qui sotto, cambiala e salvala. Restano in questo browser; esportale per tenerle altrove.', en: 'None yet: start from a voice below, change it and save it. They stay in this browser; export them to keep them elsewhere.' })}</p>}
        <ul className="studio-list">
          {lib.voices.map((v) => (
            <li key={v.id} className={v.id === draft.id ? 'on' : ''}>
              <button className="studio-voice" onClick={() => open(v)}>{v.name || L({ it: 'Senza nome', en: 'Unnamed' })}</button>
              <button className="ds-icon" title={L({ it: 'Elimina', en: 'Delete' })} aria-label={L({ it: 'Elimina', en: 'Delete' })}
                onClick={() => { if (window.confirm(L({ it: `Eliminare «${v.name}» da questo browser?`, en: `Delete “${v.name}” from this browser?` }))) library.remove(v.id); }}>✕</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="chip" onClick={() => open({ ...cloneVoice(), id: newVoiceId(), name: L({ it: 'Nuova voce', en: 'New voice' }) })}>＋ {L({ it: 'Nuova', en: 'New' })}</button>
          <button className="chip" onClick={() => fileRef.current?.click()}>⇪ {L({ it: 'Importa', en: 'Import' })}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <p className="muted small">{L({ it: 'Oppure trascina qui un file .voice.json.', en: 'Or drop a .voice.json file here.' })}</p>
        <h3>{L({ it: 'Voci di partenza', en: 'Starting voices' })}</h3>
        <div className="chips">
          {BUILTIN_VOICES.map((b) => (
            <button key={b.id} className={b.design.id === draft.id ? 'chip on' : 'chip'} title={L(b.hint)} onClick={() => open({ ...cloneVoice(b.design), name: L(b.name) })}>{L(b.name)}</button>
          ))}
        </div>
      </aside>

      <section className="studio-main">
        <div className="studio-bar ds-card">
          <div className="studio-id">
            <input className="text-input studio-name" value={draft.name} maxLength={60} placeholder={L({ it: 'Nome della voce', en: 'Name of the voice' })} aria-label={L({ it: 'Nome della voce', en: 'Name of the voice' })}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <button className={changed || !mine ? 'btn primary' : 'btn'} onClick={save}>{L({ it: 'Salva', en: 'Save' })}</button>
            <button className="btn" disabled={!changed} onClick={() => setDraft(cloneVoice(origin))}
              title={L({ it: 'Torna alla voce com’era quando l’hai aperta o salvata', en: 'Back to the voice as it was when you opened or saved it' })}>
              ↺ {L({ it: 'Annulla', en: 'Undo' })}{diff.n > 0 && <span className="count">{diff.n}</span>}
            </button>
            <button className="btn" onClick={() => library.duplicate(draft, `${draft.name || L({ it: 'Voce', en: 'Voice' })} (2)`)} title={L({ it: 'Salva una copia con un altro nome', en: 'Save a copy under another name' })}>{L({ it: 'Duplica', en: 'Duplicate' })}</button>
            <button className="btn" onClick={() => download(draft)} title={L({ it: 'Scarica la voce come file .voice.json', en: 'Download the voice as a .voice.json file' })}>⇩ {L({ it: 'Esporta', en: 'Export' })}</button>
            <button className="btn" onClick={() => void share()} title={L({ it: 'Un indirizzo che apre questa voce', en: 'An address that opens this voice' })}>🔗 {L({ it: 'Link', en: 'Link' })}</button>
            <button className={notes ? 'btn on' : 'btn'} aria-expanded={notes} onClick={() => setNotes(!notes)} title={L({ it: 'Note sulla voce: chi è, come parla, a cosa serve', en: 'Notes on the voice: who it is, how it speaks, what it is for' })}>
              ✎ {L({ it: 'Note', en: 'Notes' })}{draft.notes.trim() && !notes && <span className="count dot" />}
            </button>
          </div>
          <div className="studio-say">
            <input className="text-input" value={text} aria-label={L({ it: 'Frase di prova', en: 'Test sentence' })} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) void say(draft); }} />
            <select className="lang-pick" value="" aria-label={L({ it: 'Frasi di esempio', en: 'Example sentences' })} onChange={(e) => { if (e.target.value) { setText(e.target.value); setLang(ui.lang); } }}>
              <option value="">{L({ it: 'Esempi…', en: 'Examples…' })}</option>
              {PATTERNS[ui.lang].map(([name, t]) => <option key={t} value={t}>{L(name)}</option>)}
            </select>
            <select className="lang-pick" value={lang} aria-label={L({ it: 'Lingua', en: 'Language' })} onChange={(e) => { setLang(e.target.value); setDraft({ ...draft, language: e.target.value }); }}>
              <option value="it">{L({ it: 'Italiano', en: 'Italian' })}</option>
              <option value="en">{L({ it: 'Inglese (americano)', en: 'English (American)' })}</option>
              {[...SPEECH_LANGUAGES].sort((a, b) => L(a.name).localeCompare(L(b.name))).map((l) => <option key={l.code} value={l.code}>{L(l.name)}</option>)}
            </select>
            {speaking
              ? <button className="btn big" onClick={() => voice.stop()}>■ {L({ it: 'Ferma', en: 'Stop' })}</button>
              : <button className="btn primary big" title={L({ it: 'Dice la frase con questa voce (Ctrl+Invio da qualsiasi punto)', en: 'Says the sentence with this voice (Ctrl+Enter from anywhere)' })} onClick={() => void say(draft)}>🔊 {L({ it: 'Ascolta', en: 'Listen' })}</button>}
            <button className="btn" disabled={!changed} title={L({ it: 'La stessa frase con la voce com’era prima delle modifiche', en: 'The same sentence with the voice as it was before the changes' })} onClick={() => void say(origin)}>{L({ it: 'Com’era', en: 'As it was' })}</button>
            <Toggle label={L({ it: 'Riascolta a ogni modifica', en: 'Replay after each change' })} value={prefs.auto} onChange={(x) => setPrefs({ auto: x })}
              hint={L({ it: 'Ridice la frase da sola dopo ogni modifica', en: 'Says the sentence again by itself after every change' })} />
          </div>
          {notes && (
            <textarea className="studio-notes" autoFocus value={draft.notes} maxLength={500} rows={2} aria-label={L({ it: 'Note sulla voce', en: 'Notes on the voice' })}
              placeholder={L({ it: 'Note: chi è, come parla, a cosa serve…', en: 'Notes: who it is, how it speaks, what it is for…' })}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          )}
          {link && <input className="text-input studio-link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={L({ it: 'Link della voce', en: 'Link of the voice' })} />}
        </div>

        <div className="studio-work">
          <section className="ds-card studio-editor">
            <header className="studio-tabs">
              <Pills value={tab} onChange={setTab} label={L({ it: 'Parte della voce', en: 'Part of the voice' })}
                options={TABS.map(([id, name, hint]) => [id, <>{L(name)}{diff.by[id] > 0 && <span className="count" title={L({ it: 'campi modificati', en: 'fields changed' })}>{diff.by[id]}</span>}</>, L(hint)])} />
              <Toggle label={L({ it: 'Spiegazioni', en: 'Explanations' })} value={prefs.hints} onChange={(x) => setPrefs({ hints: x })}
                hint={L({ it: 'Mostra sotto ogni campo che cosa fa. Spente: un clic sul nome di un campo apre la sua.', en: 'Shows under every field what it does. Off: a click on the name of a field unfolds its own.' })} />
            </header>
            <div className="studio-fields" onPointerDown={() => { live.current.down = true; }}>
              <p className="muted small studio-tab-hint">{L(TABS.find((t) => t[0] === tab)![2])}</p>
              {tab === 'melody' && (
                <>
                  <div className="chips">
                    {PATTERNS[ui.lang].map(([name, t]) => <button key={t} className={t === text ? 'chip on' : 'chip'} onClick={() => { setText(t); setLang(ui.lang); }}>{L(name)}</button>)}
                  </div>
                  <MelodyPreview d={draft} text={text} lang={lang} />
                </>
              )}
              <div className="studio-groups">
                {groups.map((g) => (
                  <fieldset key={g.en} className="studio-group">
                    <legend>{L(g)}</legend>
                    {VOICE_FIELDS.filter((f) => f.tab === tab && f.group === g).map((f) => (
                      <VoiceField key={f.path} f={f} value={fieldValue(draft, f)} was={fieldValue(origin, f)} hints={prefs.hints} onChange={set} />
                    ))}
                  </fieldset>
                ))}
              </div>
            </div>
          </section>
          <div className="studio-side">
            <div className="ds-card studio-headview"><HeadView /></div>
            <PhonemeButtons list={['a', 'e', 'i', 'o', 'u', 'm', 's']} size="small" label={{ it: 'Tieni un suono', en: 'Hold a sound' }} />
            <ViewFrame className="studio-view" view={view} onView={setView} />
          </div>
        </div>
      </section>
    </main>
  );
}
