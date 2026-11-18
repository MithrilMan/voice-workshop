import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../store';
import { voice } from '../voice/voice';
import { useLanes } from '../voice/hooks';
import { library, useLibrary } from '../library';
import { Pills } from '../ds';
import { Toggle } from '../components/controls';
import { VoiceField, sameValue } from '../components/VoiceField';
import { HeadView } from '../components/HeadView';
import { FromRecording } from '../components/FromRecording';
import { ViewFrame } from './views';
import { PhonemeButtons } from './quick';
import { VOICE_FIELDS, Tab, VoiceDesign, cloneVoice, fieldValue, newVoiceId, speechOptions, withField } from '../../dsp/voice/design';
import { BUILTIN_VOICES } from '../../dsp/voice/builtin';
import { voiceToJson, voiceFromJson, voiceToLink, voiceFileName } from '../../dsp/voice/codec';
import { speechLanguage } from '../../dsp/speech/languages';
import { textToPhones, ipaKind } from '../../dsp/speech/g2p';
import { loadDeliveryModel, planSpeech } from '../../dsp/voice/interpret';
import type { ViewTab } from '../store';
import { LanguagePick, ExamplePick } from '../components/LanguagePick';
import { EXAMPLES, MELODY_PATTERNS, firstExample } from '../examples';
import { Music, type MusicSection } from './Music';

const TABS: [Tab, string, string][] = [
  ['body', 'Body', 'size of the tract, nose and teeth'],
  ['phonation', 'Voice', 'how the vocal folds vibrate'],
  ['habits', 'Habits', 'the posture kept beneath every sound'],
  ['melody', 'Melody', 'pitch, accents, ends of phrases'],
  ['rhythm', 'Rhythm and breath', 'pace, pauses, loudness'],
];

/** the melody patterns shown for a language: its own where the rules read it, else the English ones */
const patternLang = (lang: string): 'it' | 'en' => (lang === 'it' ? 'it' : 'en');
/** the sentence to start from in a language */
const startText = (lang: string) => (lang === 'it' || lang === 'en' ? MELODY_PATTERNS[lang][0][1] : firstExample(lang) ?? MELODY_PATTERNS.en[0][1]);

/** The pitch the voice would give the test sentence, with its sounds under it. */
function MelodyPreview({ d, text, lang }: { d: VoiceDesign; text: string; lang: string }) {
  const dd = useDeferredValue(d);
  // a learnt delivery: its model, the first time it is needed
  const [models, setModels] = useState(0);
  const learnt = dd.speaking.delivery !== 'rules';
  useEffect(() => {
    if (learnt) void loadDeliveryModel().then(() => setModels((n) => n + 1), () => {});
  }, [learnt]);
  const plot = useMemo(() => {
    let phones;
    try { phones = textToPhones(text, lang); } catch { return null; }
    if (!phones.length) return null;
    const sc = planSpeech(phones, speechOptions(dd, lang), dd.speaking);
    const pts = sc.frames.filter((f) => f.t <= sc.duration && f.ps > 0.5 && f.abduction < 0.3);
    if (pts.length < 2) return null;
    const st = (f: number) => 12 * Math.log2(f / dd.speaking.f0);
    const lo = Math.min(-6, ...pts.map((f) => st(f.f0))), hi = Math.max(8, ...pts.map((f) => st(f.f0)));
    const W = 640, H = 120, x = (t: number) => (t / sc.duration) * W, y = (s: number) => H - 14 - ((s - lo) / (hi - lo)) * (H - 24);
    let path = '', last = -2;
    for (const f of pts) { const i = Math.round(f.t / 0.005); path += `${path && i === last + 1 ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(st(f.f0)).toFixed(1)}`; last = i; }
    return { W, H, path, base: y(0), phones: sc.phones.filter((p) => p.ipa !== '_').map((p) => ({ x: x(0.5 * (p.t0 + p.t1)), ipa: p.ipa })), range: [Math.round(lo), Math.round(hi)] };
  }, [dd, text, lang, models]);
  if (!plot) return <p className="muted small">Type a sentence to see its melody.</p>;
  return (
    <figure className="melody-preview">
      <svg viewBox={`0 0 ${plot.W} ${plot.H}`} role="img" aria-label={'Planned pitch curve'}>
        <line x1={0} x2={plot.W} y1={plot.base} y2={plot.base} className="mp-base" />
        <path d={plot.path} className="mp-curve" />
        {plot.phones.map((p, i) => <text key={i} x={p.x} y={plot.H - 2} className="mp-ipa">{p.ipa}</text>)}
      </svg>
      <figcaption className="muted small">{`The planned pitch, in semitones from the usual pitch (the line): ${plot.range[0]} to +${plot.range[1]}.`}</figcaption>
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
type Section = 'design' | MusicSection;
const SECTIONS: [Section, string, string][] = [
  ['design', 'Design', 'the voice itself: body, folds, habits, melody'],
  ['sing', 'Sing', 'the voice sings notes and words'],
  ['beat', 'Beatbox', 'the drums of its mouth on a grid'],
  ['ensemble', 'Ensemble', 'several voices at once: a round, a choir, a band of mouths'],
];
interface Prefs { hints: boolean; auto: boolean; section: Section }
/** what the studio remembers in this browser: explanations unfolded, saying the sentence again after a change, the section open */
function loadPrefs(): Prefs {
  try {
    const o = JSON.parse(window.localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return { hints: o.hints === true, auto: o.auto === true, section: SECTIONS.some(([s]) => s === o.section) ? o.section! : 'design' };
  } catch { return { hints: false, auto: false, section: 'design' }; }
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
  const lib = useLibrary();
  const speaking = useLanes().performer.kind === 'sentence';
  const [draft, setDraft] = useState<VoiceDesign>(() => cloneVoice(lib.incoming ?? (voice.active as VoiceDesign)));
  /** the voice as it was opened or last saved: what the changes are heard against */
  const [origin, setOrigin] = useState<VoiceDesign>(() => cloneVoice(draft));
  const [tab, setTab] = useState<Tab>('body');
  const [lang, setLang] = useState<string>(() => draft.language || 'en');
  const [text, setText] = useState(() => startText(draft.language || 'en'));
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

  // a voice of another language: its language, and an example sentence of it in place of one of another
  const open = (d: VoiceDesign) => {
    const c = cloneVoice(d); setDraft(c); setOrigin(c); setLink('');
    if (c.language && c.language !== lang) {
      setLang(c.language);
      if (EXAMPLES.some((e) => e.text === text) || Object.values(MELODY_PATTERNS).some((p) => p.some(([, t]) => t === text))) setText(startText(c.language));
    }
  };
  // a voice received with a link (decoded after the first render) opens at once
  useEffect(() => { if (lib.incoming) open(lib.incoming); }, [lib.incoming]);
  const info = (m: string) => store.setUi({ info: m });

  const say = async (d: VoiceDesign) => {
    voice.useVoice(d);
    if (lang === 'en') await store.ensureLexicon();
    if (speechLanguage(lang) && !ipaKind(text)) await store.ensurePhonemes(text, lang, true);
    const ph = textToPhones(text, lang);
    if (!ph.length) return;
    await voice.speak(await voice.plan(ph, lang), text);
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
    const named = draft.name.trim() ? draft : { ...draft, name: 'Unnamed voice' };
    const s = library.save(named);
    open(s);
    info(`“${s.name}” is saved in this browser.`);
  };
  const share = async () => {
    const frag = await voiceToLink(draft);
    const url = `${window.location.origin}${window.location.pathname}?mode=voices#${frag}`;
    setLink(url);
    try { await navigator.clipboard.writeText(url); info('Link copied: whoever opens it gets this voice.'); } catch { /* shown in the bar */ }
  };
  const importText = (t: string) => {
    const v = voiceFromJson(t);
    if (!v) { info('This file is not a voice.'); return; }
    const s = library.save(v);
    open(s);
    info(`“${s.name || '…'}” is in your library.`);
  };
  const importFiles = (files: FileList | null) => { for (const f of Array.from(files ?? []).slice(0, 10)) if (f.size < 200000) void f.text().then(importText); };

  return (
    <main className="studio" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void say(draft); } }}>
      <aside className="studio-lib ds-card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFiles(e.dataTransfer.files); }}>
        {lib.incoming && (
          <div className="studio-incoming">
            <p>A voice received with a link: <b>{lib.incoming.name || '…'}</b></p>
            <div className="row">
              <button className="btn primary" onClick={() => { const s = library.save(lib.incoming!); open(s); }}>Save to the library</button>
              <button className="chip" onClick={() => open(lib.incoming!)}>Open</button>
              <button className="chip" onClick={() => library.setIncoming(null)}>Dismiss</button>
            </div>
          </div>
        )}
        <h3>Your voices</h3>
        {lib.voices.length === 0 && <p className="muted small">None yet: start from a voice below, change it and save it. They stay in this browser; export them to keep them elsewhere.</p>}
        <ul className="studio-list">
          {lib.voices.map((v) => (
            <li key={v.id} className={v.id === draft.id ? 'on' : ''}>
              <button className="studio-voice" onClick={() => open(v)}>{v.name || 'Unnamed'}</button>
              <button className="ds-icon" title="Delete" aria-label="Delete"
                onClick={() => { if (window.confirm(`Delete “${v.name}” from this browser?`)) library.remove(v.id); }}>✕</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button className="chip" onClick={() => open({ ...cloneVoice(), id: newVoiceId(), name: 'New voice' })}>＋ New</button>
          <button className="chip" onClick={() => fileRef.current?.click()}>⇪ Import</button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <p className="muted small">Or drop a .voice.json file here.</p>
        <h3>Starting voices</h3>
        <div className="chips">
          {BUILTIN_VOICES.map((b) => (
            <button key={b.id} className={b.design.id === draft.id ? 'chip on' : 'chip'} title={b.hint} onClick={() => open({ ...cloneVoice(b.design), name: b.name })}>{b.name}</button>
          ))}
        </div>
        <h3>From a recording</h3>
        <p className="muted small">A voice measured on a recording (pitch, melody, formants, folds, hiss, pace) and searched for among the simulator’s voices: a voice of the same kind, not a copy. Everything stays in this browser.</p>
        <FromRecording lang={lang} onVoice={(d) => { open(d); info(`“${d.name}” is open: listen to it and save it if you like it.`); }} />
      </aside>

      <section className="studio-main">
        <nav className="studio-sections">
          <Pills value={prefs.section} onChange={(s) => setPrefs({ section: s })} label="Section" options={SECTIONS.map(([id, name, hint]) => [id, name, hint])} />
        </nav>
        <div className="studio-bar ds-card">
          <div className="studio-id">
            <input className="text-input studio-name" value={draft.name} maxLength={60} placeholder="Name of the voice" aria-label="Name of the voice"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <button className={changed || !mine ? 'btn primary' : 'btn'} onClick={save}>Save</button>
            <button className="btn" disabled={!changed} onClick={() => setDraft(cloneVoice(origin))}
              title={'Back to the voice as it was when you opened or saved it'}>
              ↺ Undo{diff.n > 0 && <span className="count">{diff.n}</span>}
            </button>
            <button className="btn" onClick={() => library.duplicate(draft, `${draft.name || 'Voice'} (2)`)} title={'Save a copy under another name'}>Duplicate</button>
            <button className="btn" onClick={() => download(draft)} title={'Download the voice as a .voice.json file'}>⇩ Export</button>
            <button className="btn" onClick={() => void share()} title={'An address that opens this voice'}>🔗 Link</button>
            <button className={notes ? 'btn on' : 'btn'} aria-expanded={notes} onClick={() => setNotes(!notes)} title={'Notes on the voice: who it is, how it speaks, what it is for'}>
              ✎ Notes{draft.notes.trim() && !notes && <span className="count dot" />}
            </button>
          </div>
          {prefs.section === 'design' && <div className="studio-say">
            <input className="text-input" value={text} aria-label={'Test sentence'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) void say(draft); }} />
            <ExamplePick now={lang} onPick={(t, l) => { setText(t); setLang(l); }} />
            <LanguagePick value={lang} onChange={(l) => { setLang(l); setDraft({ ...draft, language: l }); }} />
            {speaking
              ? <button className="btn big" onClick={() => voice.stop()}>■ Stop</button>
              : <button className="btn primary big" title={'Says the sentence with this voice (Ctrl+Enter from anywhere)'} onClick={() => void say(draft)}>🔊 Listen</button>}
            <button className="btn" disabled={!changed} title={'The same sentence with the voice as it was before the changes'} onClick={() => void say(origin)}>As it was</button>
            <Toggle label={'Replay after each change'} value={prefs.auto} onChange={(x) => setPrefs({ auto: x })}
              hint={'Says the sentence again by itself after every change'} />
          </div>}
          {notes && (
            <textarea className="studio-notes" autoFocus value={draft.notes} maxLength={500} rows={2} aria-label={'Notes on the voice'}
              placeholder="Notes: who it is, how it speaks, what it is for…"
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          )}
          {link && <input className="text-input studio-link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label={'Link of the voice'} />}
        </div>

        {prefs.section !== 'design' ? <Music section={prefs.section} voice={draft} /> : <div className="studio-work">
          <section className="ds-card studio-editor">
            <header className="studio-tabs">
              <Pills value={tab} onChange={setTab} label="Part of the voice"
                options={TABS.map(([id, name, hint]) => [id, <>{name}{diff.by[id] > 0 && <span className="count" title={'fields changed'}>{diff.by[id]}</span>}</>, hint])} />
              <Toggle label={'Explanations'} value={prefs.hints} onChange={(x) => setPrefs({ hints: x })}
                hint={'Shows under every field what it does. Off: a click on the name of a field unfolds its own.'} />
            </header>
            <div className="studio-fields" onPointerDown={() => { live.current.down = true; }}>
              <p className="muted small studio-tab-hint">{TABS.find((t) => t[0] === tab)![2]}</p>
              {tab === 'melody' && (
                <>
                  <div className="chips">
                    {MELODY_PATTERNS[patternLang(lang)].map(([name, t]) => <button key={t} className={t === text ? 'chip on' : 'chip'} onClick={() => { setText(t); setLang(patternLang(lang)); }}>{name}</button>)}
                  </div>
                  <MelodyPreview d={draft} text={text} lang={lang} />
                </>
              )}
              <div className="studio-groups">
                {groups.map((g) => (
                  <fieldset key={g} className="studio-group">
                    <legend>{g}</legend>
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
            <PhonemeButtons list={['a', 'e', 'i', 'o', 'u', 'm', 's']} size="small" label={'Hold a sound'} />
            <ViewFrame className="studio-view" view={view} onView={setView} />
          </div>
        </div>}
      </section>
    </main>
  );
}
