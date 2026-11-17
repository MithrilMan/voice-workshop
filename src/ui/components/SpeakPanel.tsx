import { useEffect } from 'react';
import { store, useUi, useTick } from '../store';
import { LanguagePick, ExamplePick } from './LanguagePick';
import { voice } from '../voice/voice';
import { useLanes } from '../voice/hooks';
import { Slider, Section, Toggle } from './controls';
import { C } from '../canvas';
import { textToPhones, Phone, ipaKind } from '../../dsp/speech/g2p';
import { NaturalnessOptions, NATURAL_ALL } from '../../dsp/speech/sequencer';
import { notesForIpa, SoundNote } from '../../dsp/speech/derive';
import type { ApproxCode } from '../../dsp/speech/phonemes';
import { speechLanguage, SpeechLanguage } from '../../dsp/speech/languages';
import { phonemize, dictionaryFailed, Phonemized } from '../../dsp/speech/phonemizer';
import type { UiState } from '../store';
import { SpeaksAs } from './SpeaksAs';

/** What each approximation of a sound made from the IPA chart means. */
const APPROX: Record<ApproxCode, string> = {
  degree: 'the model cannot narrow this place as much as the symbol asks',
  click: 'palatal click: the model’s tongue is one body and cannot make the palatal and the velar closure at once, so it makes one and rarefies no air',
  anatomy: 'with the mouth of this voice (its palate, arch, pharynx) the tongue cannot make this sound as it does in the reference head',
};

const noteText = (n: SoundNote): string =>
  n.kind === 'approximate' && n.code ? APPROX[n.code]
    : n.kind === 'ignored' ? 'read, without an effect on the sound'
      : 'not an IPA symbol: skipped';

/** single words, to hear one sound in them (the sentences, in many languages, are in the examples menu) */
const WORDS: { text: string; lang: string }[] = [
  { text: 'heed', lang: 'en' }, { text: 'father', lang: 'en' }, { text: 'hiss', lang: 'en' }, { text: 'this', lang: 'en' },
  { text: 'sasso', lang: 'it' }, { text: 'mamma', lang: 'it' }, { text: 'voce', lang: 'it' }, { text: 'gnocchi', lang: 'it' },
];

/** The ingredients of natural speech, each with a plain explanation. */
const INGREDIENTS: { key: keyof NaturalnessOptions; name: string; what: string }[] = [
  {
    key: 'timing', name: 'Timing',
    what: 'Every sound has a length that depends on its context: stressed vowels stretch, unstressed ones shrink, and speech slows down at the end of a phrase. Off: every sound always lasts the same.',
  },
  {
    key: 'intonation', name: 'Intonation',
    what: 'The melody of the sentence: it rises on stressed syllables, drifts down through the phrase, falls at the end of a statement and rises in a question. Off: a single note, like a robot.',
  },
  {
    key: 'micro', name: 'Micro-variation',
    what: 'Small pitch nudges nobody plans: closed vowels (ee, oo) sit slightly higher, the pitch starts higher after a voiceless consonant, and the voice wavers a little. Off: everything perfectly smooth.',
  },
  {
    key: 'voiceQuality', name: 'Voice quality',
    what: 'On stressed syllables the lungs push harder and the folds close more firmly; at the end of a phrase the push fades and the voice turns breathier. Off: the same force and color from start to end.',
  },
  {
    key: 'coarticulation', name: 'Coarticulation',
    what: 'Movements overlap: a consonant only moves what it needs while the rest already prepares the next vowel (the lips round before an “oo”). Off: every sound resets the whole mouth.',
  },
];

const pct = (p: number) => (p > 0 && p < 1 ? ` ${Math.round(p * 100)} %` : '');
const quoted = (ws: string[]) => ws.map((w) => `«${w}»`).join(', ');

/** What the phonemizer is doing with a text in a language without rules of its own, and where its words came from. */
function phonemizerNotes(lang: SpeechLanguage, ph: Phonemized, st: UiState['phonemizer']): string[] {
  if (st.stage === 'dictionary') return [`loading the pronunciation dictionary…${pct(st.progress)}`];
  if (st.stage === 'model') {
    return [st.progress > 0 && st.progress < 1
      ? `downloading the neural model (about 33 MB, only the first time)…${pct(st.progress)}`
      : 'the neural model is reading the words…'];
  }
  const out: string[] = [];
  if (st.stage === 'error') out.push(`neural model unavailable (${st.error}): the words the dictionary lacks stay silent`);
  else if (ph.missing.length) {
    out.push(`${quoted(ph.missing)}: not in the dictionary. Press “Speak”: a neural model reads ${ph.missing.length > 1 ? 'them' : 'it'}, downloaded the first time (about 33 MB).`);
  }
  if (!lang.dict) out.push('this language has no open dictionary: the neural model reads every word, and it can be wrong');
  else if (dictionaryFailed(lang)) out.push('dictionary unreachable: the neural model reads every word');
  else if (ph.dictionaryWords) out.push(`from the ipa-dict dictionary: ${ph.dictionaryWords} word${ph.dictionaryWords > 1 ? 's' : ''}`);
  if (lang.dict && ph.modelWords.length) out.push(`from the neural model, which can be wrong: ${quoted(ph.modelWords)}`);
  if (ph.numbers.length) out.push(`${quoted(ph.numbers)}: numbers are read out only in Italian and English, write them in words`);
  return out;
}

/** tone levels 1 (extra low) .. 5 (extra high) as tone letters */
const TONE_LETTERS = '˩˨˧˦˥';

const showIpa = (phones: Phone[]) => phones.map((p) =>
  (p.stress ? 'ˈ' : p.stress2 ? 'ˌ' : '') + p.ipa + (p.long ? 'ː' : '') + (p.tone ? p.tone.map((l) => TONE_LETTERS[l - 1] ?? '').join('') : '')
  + (p.wordEnd ? ' ' : '') + (p.pause ? (p.question ? '? ' : '| ') : '')).join('');

/**
 * Text to speech with the articulatory model: spelling -> phonemes ->
 * gestural score (targets that overlap in time) -> the same physical engine.
 */
export function SpeakPanel() {
  const ui = useUi();
  const sp = ui.speech;
  const { text, lang, rate, accent, natural } = sp;
  const perf = useLanes().performer;
  const sc = perf.kind === 'sentence' ? perf.score : null;
  useTick(sc ? 20 : 0);
  useEffect(() => { if (lang === 'en') void store.ensureLexicon(); }, [lang]);
  const kind = ipaKind(text);
  const other = speechLanguage(lang);
  // another language: its dictionary as soon as it is chosen, the words it lacks once the model is here
  useEffect(() => {
    if (!other || ipaKind(text)) return;
    const id = setTimeout(() => void store.ensurePhonemes(text, lang), 400);
    return () => clearTimeout(id);
  }, [text, lang, other]);
  let phones: Phone[] = [];
  try { phones = textToPhones(text, lang); } catch { phones = []; }
  const otherNotes = other && !kind ? phonemizerNotes(other, phonemize(text, lang), ui.phonemizer) : [];
  let notes: SoundNote[] = [];
  if (kind) try { notes = notesForIpa(text.trim().slice(1, -1)); } catch { notes = []; }
  const speak = async (t = text, lg = lang) => {
    if (lg === 'en') await store.ensureLexicon();
    if (speechLanguage(lg) && !ipaKind(t)) await store.ensurePhonemes(t, lg, true);
    const ph = textToPhones(t, lg);
    if (!ph.length) return;
    // the voice that speaks, with its habits and style; the panel's rate, accent and ingredients
    const score = await voice.plan(ph, lg, { rate, accent, natural });
    void voice.speak(score, t);
  };
  const setNatural = (n: Partial<NaturalnessOptions>) => store.setSpeech({ natural: { ...natural, ...n } });
  const robot = INGREDIENTS.every((g) => !natural[g.key]);
  const all = INGREDIENTS.every((g) => natural[g.key]);
  const now = voice.progress()?.t ?? 0;
  const lexNote: string | null = lang !== 'en' ? null
    : ui.lexicon === 'ready' ? 'American dictionary: 89 thousand words'
      : ui.lexicon === 'error' ? 'dictionary unavailable: using spelling rules'
        : 'loading the dictionary…';
  return (
    <div className="panel-body">
      <Section title="Make the head speak" accent={C.amber}
        info={'The text becomes phonemes. Italian uses its spelling rules (an “s” between vowels is voiced, as in the North); English uses an American dictionary of 89 thousand words, rules for plurals, past tenses and compounds, and letter-to-sound rules for words it does not know; in both, numbers are read out. Other languages: each word is looked up in an open pronunciation dictionary (ipa-dict) when the language has one, and the words it lacks are transcribed by a small neural model trained on about 100 languages (CharsiuG2P), downloaded the first time (about 33 MB); the transcription is said as written, like IPA between brackets. Each phoneme is a target for tongue, lips, jaw, velum and glottis; everything else is physics: the same head you move by hand. Write /IPA/ between slashes to give phonemes said with the rules of English or Italian, or [IPA] between brackets to have any language said as written: every symbol of the IPA chart, with its diacritics, length, stress and tones. A sound with no measurements to fit it to is made from rules: its place, its manner, its diacritics.'}>
        <div className="row">
          <input className="text-input" value={text} onChange={(e) => store.setSpeech({ text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void speak(); }} />
          <LanguagePick value={lang} label="Language of the text" onChange={(l) => store.setSpeech({ lang: l })} />
        </div>
        <div className="ipa-line">{showIpa(phones) || '—'}</div>
        {kind === 'phonetic' && <p className="small muted">Said as written, with no language’s rules.</p>}
        {notes.map((n) => <p key={n.symbol + n.kind} className="small muted"><b>{n.symbol}</b> · {noteText(n)}</p>)}
        {lexNote && !kind && <p className="small muted">{lexNote}</p>}
        {otherNotes.map((n) => <p key={n} className="small muted">{n}</p>)}
        <div className="row">
          <button className="btn primary" onClick={() => void speak()}>Speak</button>
          <button className="btn" onClick={() => voice.stop()}>Stop</button>
          <ExamplePick now={lang} onPick={(t, l) => { store.setSpeech({ text: t, lang: l }); void speak(t, l); }} />
        </div>
        <div className="chips">
          {WORDS.map((e) => (
            <button key={e.text} className="chip" onClick={() => { store.setSpeech({ text: e.text, lang: e.lang }); void speak(e.text, e.lang); }}>{e.text}<small> {e.lang}</small></button>
          ))}
        </div>
        <Slider label="Rate" value={rate} min={0.4} max={1.8} onChange={(v) => store.setSpeech({ rate: v })} format={(v) => `×${v.toFixed(2)}`} />
        <Slider label={'Pitch accent'} value={accent} min={0} max={8} step={0.5} onChange={(v) => store.setSpeech({ accent: v })} format={(v) => `${v.toFixed(1)} st`} />
        <SpeaksAs />
        <p className="small muted">The voice speaks with its habits and its melody; the base pitch and the lung pressure come from the “Source” tab.</p>
      </Section>
      <Section title={'What makes it sound natural'} accent={C.teal}
        info={'A synthetic voice sounds mechanical when one of these ingredients is missing. Switch them off one at a time and play the same sentence again: you hear what each one brings. The rules come from phonetics: English durations from Klatt (1979), the melody from the Fujisaki model (phrase commands for the slow drift down, accent commands on stressed syllables).'}>
        {INGREDIENTS.map((g) => (
          <div key={g.key} className="ingredient">
            <Toggle label={g.name} value={natural[g.key]} onChange={(v) => setNatural({ [g.key]: v })} />
            <p className="small muted">{g.what}</p>
          </div>
        ))}
        <div className="row">
          <button className={all ? 'chip on' : 'chip'} onClick={() => { store.setSpeech({ natural: { ...NATURAL_ALL } }); }}>All on</button>
          <button className={robot ? 'chip on' : 'chip'} onClick={() => { store.setSpeech({ natural: { timing: false, intonation: false, micro: false, voiceQuality: false, coarticulation: false } }); }}>Robot (all off)</button>
          <button className="btn" onClick={() => void speak()}>▶ Play again</button>
        </div>
      </Section>
      {sc && (
        <div className="timeline">
          {sc.phones.map((ph, i) => {
            const active = now >= ph.t0 && now < ph.t1;
            return <span key={i} className={active ? 'ph on' : 'ph'} style={{ flexGrow: Math.max(0.3, (ph.t1 - ph.t0) * 20) }}>{ph.ipa}</span>;
          })}
        </div>
      )}
    </div>
  );
}
