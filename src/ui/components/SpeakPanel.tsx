import { useEffect } from 'react';
import { store, useUi, useTick } from '../store';
import { voice } from '../voice/voice';
import { useLanes } from '../voice/hooks';
import { useL } from '../i18n';
import { Slider, Section, Toggle } from './controls';
import { C } from '../canvas';
import { textToPhones, Phone, ipaKind } from '../../dsp/speech/g2p';
import { NaturalnessOptions, NATURAL_ALL } from '../../dsp/speech/sequencer';
import { notesForIpa, SoundNote } from '../../dsp/speech/derive';
import type { ApproxCode } from '../../dsp/speech/phonemes';
import { SPEECH_LANGUAGES, speechLanguage, SpeechLanguage } from '../../dsp/speech/languages';
import { phonemize, dictionaryFailed, Phonemized } from '../../dsp/speech/phonemizer';
import type { UiState } from '../store';
import { SpeaksAs } from './SpeaksAs';

type Bi = { it: string; en: string };

/** What each approximation of a sound made from the IPA chart means. */
const APPROX: Record<ApproxCode, Bi> = {
  degree: { it: 'il modello non riesce a stringere questo punto quanto chiede il simbolo', en: 'the model cannot narrow this place as much as the symbol asks' },
  click: { it: 'clic palatale: la lingua del modello è un corpo solo e non fa insieme la chiusura palatale e quella velare, quindi ne fa una e non rarefà l’aria', en: 'palatal click: the model’s tongue is one body and cannot make the palatal and the velar closure at once, so it makes one and rarefies no air' },
  anatomy: { it: 'con la bocca di questa voce (il palato, l’arcata, la faringe) la lingua non arriva a fare questo suono come lo fa nella testa di riferimento', en: 'with the mouth of this voice (its palate, arch, pharynx) the tongue cannot make this sound as it does in the reference head' },
};

const noteText = (n: SoundNote): Bi =>
  n.kind === 'approximate' && n.code ? APPROX[n.code]
    : n.kind === 'ignored' ? { it: 'letto ma senza effetto sul suono', en: 'read, without an effect on the sound' }
      : { it: 'non è un simbolo IPA: saltato', en: 'not an IPA symbol: skipped' };

const EXAMPLES: { text: string; lang: string; ipa?: boolean }[] = [
  { text: 'heed', lang: 'en' }, { text: 'father', lang: 'en' }, { text: 'hiss', lang: 'en' }, { text: 'this', lang: 'en' },
  { text: 'a buzz, a hiss and a filter', lang: 'en' },
  { text: 'Every voice you have ever heard is made of just two ingredients.', lang: 'en' },
  { text: 'Is it raining in the city today?', lang: 'en' },
  { text: 'The little button on the water bottle', lang: 'en' },
  { text: 'sasso', lang: 'it' }, { text: 'mamma', lang: 'it' }, { text: 'voce', lang: 'it' }, { text: 'la voce è fatta di aria', lang: 'it' },
  { text: 'ciao, come stai?', lang: 'it' }, { text: 'il carro corre sulla strada', lang: 'it' }, { text: 'gnocchi e pizza', lang: 'it' },
  // other languages, from their dictionaries
  { text: 'bonjour, comment ça va ?', lang: 'fr' }, { text: '你好，世界', lang: 'zh' }, { text: 'goedemorgen', lang: 'nl' },
  // IPA of other languages, said as written: Czech ř, German ç and x, French front rounded and nasal vowels, Hindi aspirated and murmured stops
  { text: '[ˈr̝ɛka]', lang: 'en', ipa: true }, { text: '[ˈɪç ˈaxt]', lang: 'en', ipa: true }, { text: '[ly bɔ̃ vɛ̃]', lang: 'en', ipa: true },
  { text: '[pʰal bʱaːiː]', lang: 'en', ipa: true },
  // the four tones of Mandarin on one syllable
  { text: '[ma˥ ma˧˥ ma˨˩˦ ma˥˩]', lang: 'en', ipa: true },
];

/** The ingredients of natural speech, each with a plain explanation. */
const INGREDIENTS: { key: keyof NaturalnessOptions; name: Bi; what: Bi }[] = [
  {
    key: 'timing', name: { it: 'Durate', en: 'Timing' },
    what: {
      it: 'Ogni suono ha una durata che cambia col contesto: le vocali toniche si allungano, quelle atone si accorciano, si rallenta a fine frase. Spento: ogni suono dura sempre uguale.',
      en: 'Every sound has a length that depends on its context: stressed vowels stretch, unstressed ones shrink, and speech slows down at the end of a phrase. Off: every sound always lasts the same.',
    },
  },
  {
    key: 'intonation', name: { it: 'Intonazione', en: 'Intonation' },
    what: {
      it: 'La melodia della frase: sale sulle sillabe accentate, scende piano lungo la frase, cala alla fine di un’affermazione e sale in una domanda. Spento: una nota sola, da robot.',
      en: 'The melody of the sentence: it rises on stressed syllables, drifts down through the phrase, falls at the end of a statement and rises in a question. Off: a single note, like a robot.',
    },
  },
  {
    key: 'micro', name: { it: 'Micro-variazioni', en: 'Micro-variation' },
    what: {
      it: 'Piccole spinte della nota che nessuno decide: le vocali chiuse (i, u) stanno un po’ più in alto, dopo una consonante sorda la nota parte più alta, e la voce trema appena. Spento: tutto perfettamente liscio.',
      en: 'Small pitch nudges nobody plans: closed vowels (ee, oo) sit slightly higher, the pitch starts higher after a voiceless consonant, and the voice wavers a little. Off: everything perfectly smooth.',
    },
  },
  {
    key: 'voiceQuality', name: { it: 'Qualità della voce', en: 'Voice quality' },
    what: {
      it: 'Sulle sillabe accentate i polmoni spingono di più e le corde chiudono più decise; a fine frase la spinta cala e la voce diventa più soffiata. Spento: stessa forza e stesso timbro dall’inizio alla fine.',
      en: 'On stressed syllables the lungs push harder and the folds close more firmly; at the end of a phrase the push fades and the voice turns breathier. Off: the same force and color from start to end.',
    },
  },
  {
    key: 'coarticulation', name: { it: 'Coarticolazione', en: 'Coarticulation' },
    what: {
      it: 'I movimenti si sovrappongono: una consonante muove solo ciò che le serve e il resto prepara già la vocale dopo (le labbra si arrotondano prima della «u»). Spento: ogni suono riparte da zero con tutta la bocca.',
      en: 'Movements overlap: a consonant only moves what it needs while the rest already prepares the next vowel (the lips round before an “oo”). Off: every sound resets the whole mouth.',
    },
  },
];

const pct = (p: number) => (p > 0 && p < 1 ? ` ${Math.round(p * 100)} %` : '');
const quoted = (ws: string[]) => ws.map((w) => `«${w}»`).join(', ');

/** What the phonemizer is doing with a text in a language without rules of its own, and where its words came from. */
function phonemizerNotes(lang: SpeechLanguage, ph: Phonemized, st: UiState['phonemizer']): Bi[] {
  if (st.stage === 'dictionary') return [{ it: `carico il dizionario di pronuncia…${pct(st.progress)}`, en: `loading the pronunciation dictionary…${pct(st.progress)}` }];
  if (st.stage === 'model') {
    return [st.progress > 0 && st.progress < 1
      ? { it: `scarico la rete neurale (circa 33 MB, solo la prima volta)…${pct(st.progress)}`, en: `downloading the neural model (about 33 MB, only the first time)…${pct(st.progress)}` }
      : { it: 'la rete neurale legge le parole…', en: 'the neural model is reading the words…' }];
  }
  const out: Bi[] = [];
  if (st.stage === 'error') out.push({ it: `rete neurale non disponibile (${st.error}): le parole che il dizionario non ha restano mute`, en: `neural model unavailable (${st.error}): the words the dictionary lacks stay silent` });
  else if (ph.missing.length) {
    out.push({
      it: `${quoted(ph.missing)}: ${ph.missing.length > 1 ? 'non sono' : 'non è'} nel dizionario. Premi «Parla»: le legge una rete neurale, scaricata la prima volta (about 33 MB).`,
      en: `${quoted(ph.missing)}: not in the dictionary. Press “Speak”: a neural model reads ${ph.missing.length > 1 ? 'them' : 'it'}, downloaded the first time (about 33 MB).`,
    });
  }
  if (!lang.dict) out.push({ it: 'questa lingua non ha un dizionario aperto: ogni parola la legge la rete neurale, che può sbagliare', en: 'this language has no open dictionary: the neural model reads every word, and it can be wrong' });
  else if (dictionaryFailed(lang)) out.push({ it: 'dizionario non raggiungibile: ogni parola la legge la rete neurale', en: 'dictionary unreachable: the neural model reads every word' });
  else if (ph.dictionaryWords) out.push({ it: `dal dizionario ipa-dict: ${ph.dictionaryWords} ${ph.dictionaryWords > 1 ? 'parole' : 'parola'}`, en: `from the ipa-dict dictionary: ${ph.dictionaryWords} word${ph.dictionaryWords > 1 ? 's' : ''}` });
  if (lang.dict && ph.modelWords.length) out.push({ it: `dalla rete neurale, che può sbagliare: ${quoted(ph.modelWords)}`, en: `from the neural model, which can be wrong: ${quoted(ph.modelWords)}` });
  if (ph.numbers.length) out.push({ it: `${quoted(ph.numbers)}: i numeri si leggono solo in italiano e in inglese, scrivili in lettere`, en: `${quoted(ph.numbers)}: numbers are read out only in Italian and English, write them in words` });
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
  const L = useL();
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
    void voice.speak(score, { it: t, en: t });
  };
  const setNatural = (n: Partial<NaturalnessOptions>) => store.setSpeech({ natural: { ...natural, ...n } });
  const robot = INGREDIENTS.every((g) => !natural[g.key]);
  const all = INGREDIENTS.every((g) => natural[g.key]);
  const now = voice.progress()?.t ?? 0;
  const lexNote: Bi | null = lang !== 'en' ? null
    : ui.lexicon === 'ready' ? { it: 'dizionario americano: 89 mila parole', en: 'American dictionary: 89 thousand words' }
      : ui.lexicon === 'error' ? { it: 'dizionario non disponibile: uso le regole di lettura', en: 'dictionary unavailable: using spelling rules' }
        : { it: 'carico il dizionario…', en: 'loading the dictionary…' };
  return (
    <div className="panel-body">
      <Section title={L({ it: 'Fai parlare la testa', en: 'Make the head speak' })} accent={C.amber}
        info={L({
          it: 'Il testo diventa fonemi. In italiano con le regole dell’ortografia (la «s» tra vocali è sonora, come al Nord); in inglese con un dizionario americano di 89 mila parole, regole per plurali, passati e parole composte, e regole di lettura per le parole che non conosce; in entrambe i numeri vengono letti. Le altre lingue: ogni parola viene cercata in un dizionario di pronuncia aperto (ipa-dict), quando la lingua ne ha uno, e quelle che mancano le trascrive una piccola rete neurale addestrata su circa 100 lingue (CharsiuG2P), scaricata la prima volta (about 33 MB); la trascrizione viene detta così come è scritta, come l’IPA tra parentesi quadre. Ogni fonema è un bersaglio per lingua, labbra, mascella, velo e glottide; il resto lo fa la fisica: la stessa testa che muovi a mano. Scrivi /IPA/ tra barre per dare i fonemi, detti con le regole dell’italiano o dell’inglese, oppure [IPA] tra parentesi quadre per far dire qualunque lingua così come è scritta: ogni simbolo della tabella IPA, con diacritici, lunghezze, accenti e toni. Un suono che non ha misure su cui tararlo nasce da regole: il suo luogo, il suo modo, i suoi diacritici.',
          en: 'The text becomes phonemes. Italian uses its spelling rules (an “s” between vowels is voiced, as in the North); English uses an American dictionary of 89 thousand words, rules for plurals, past tenses and compounds, and letter-to-sound rules for words it does not know; in both, numbers are read out. Other languages: each word is looked up in an open pronunciation dictionary (ipa-dict) when the language has one, and the words it lacks are transcribed by a small neural model trained on about 100 languages (CharsiuG2P), downloaded the first time (about 33 MB); the transcription is said as written, like IPA between brackets. Each phoneme is a target for tongue, lips, jaw, velum and glottis; everything else is physics: the same head you move by hand. Write /IPA/ between slashes to give phonemes said with the rules of English or Italian, or [IPA] between brackets to have any language said as written: every symbol of the IPA chart, with its diacritics, length, stress and tones. A sound with no measurements to fit it to is made from rules: its place, its manner, its diacritics.',
        })}>
        <div className="row">
          <input className="text-input" value={text} onChange={(e) => store.setSpeech({ text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void speak(); }} />
          <select className="lang-pick" value={lang} aria-label={L({ it: 'Lingua del testo', en: 'Language of the text' })} onChange={(e) => store.setSpeech({ lang: e.target.value })}>
            <option value="it">{L({ it: 'Italiano', en: 'Italian' })}</option>
            <option value="en">{L({ it: 'Inglese (americano)', en: 'English (American)' })}</option>
            {[...SPEECH_LANGUAGES].sort((a, b) => L(a.name).localeCompare(L(b.name))).map((l) => <option key={l.code} value={l.code}>{L(l.name)}</option>)}
          </select>
        </div>
        <div className="ipa-line">{showIpa(phones) || '—'}</div>
        {kind === 'phonetic' && <p className="small muted">{L({ it: 'Detto così come è scritto, senza le regole di una lingua.', en: 'Said as written, with no language’s rules.' })}</p>}
        {notes.map((n) => <p key={n.symbol + n.kind} className="small muted"><b>{n.symbol}</b> · {L(noteText(n))}</p>)}
        {lexNote && !kind && <p className="small muted">{L(lexNote)}</p>}
        {otherNotes.map((n) => <p key={n.en} className="small muted">{L(n)}</p>)}
        <div className="row">
          <button className="btn primary" onClick={() => void speak()}>{L({ it: 'Parla', en: 'Speak' })}</button>
          <button className="btn" onClick={() => voice.stop()}>{L({ it: 'Ferma', en: 'Stop' })}</button>
        </div>
        <div className="chips">
          {[...EXAMPLES.filter((e) => !e.ipa && e.lang === ui.lang), ...EXAMPLES.filter((e) => !e.ipa && e.lang !== ui.lang), ...EXAMPLES.filter((e) => e.ipa)].map((e) => (
            <button key={e.text} className="chip" onClick={() => { const lg = e.ipa ? lang : e.lang; store.setSpeech({ text: e.text, lang: lg }); void speak(e.text, lg); }}>{e.text}<small> {e.ipa ? 'IPA' : e.lang}</small></button>
          ))}
        </div>
        <Slider label={L({ it: 'Velocità', en: 'Rate' })} value={rate} min={0.4} max={1.8} onChange={(v) => store.setSpeech({ rate: v })} format={(v) => `×${v.toFixed(2)}`} />
        <Slider label={L({ it: 'Accento melodico', en: 'Pitch accent' })} value={accent} min={0} max={8} step={0.5} onChange={(v) => store.setSpeech({ accent: v })} format={(v) => `${v.toFixed(1)} st`} />
        <SpeaksAs />
        <p className="small muted">{L({ it: 'La voce parla con le sue abitudini e la sua melodia; la nota di base e la pressione dei polmoni sono quelle della scheda «Sorgente».', en: 'The voice speaks with its habits and its melody; the base pitch and the lung pressure come from the “Source” tab.' })}</p>
      </Section>
      <Section title={L({ it: 'Cosa la rende naturale', en: 'What makes it sound natural' })} accent={C.teal}
        info={L({
          it: 'Una voce sintetica suona meccanica quando le manca qualcuno di questi ingredienti. Spegnili uno alla volta e riascolta la stessa frase: senti cosa porta ciascuno. Le regole vengono dalla fonetica: le durate dell’inglese da Klatt (1979), la melodia dal modello di Fujisaki (comandi di frase per la discesa lenta, comandi d’accento sulle sillabe toniche).',
          en: 'A synthetic voice sounds mechanical when one of these ingredients is missing. Switch them off one at a time and play the same sentence again: you hear what each one brings. The rules come from phonetics: English durations from Klatt (1979), the melody from the Fujisaki model (phrase commands for the slow drift down, accent commands on stressed syllables).',
        })}>
        {INGREDIENTS.map((g) => (
          <div key={g.key} className="ingredient">
            <Toggle label={L(g.name)} value={natural[g.key]} onChange={(v) => setNatural({ [g.key]: v })} />
            <p className="small muted">{L(g.what)}</p>
          </div>
        ))}
        <div className="row">
          <button className={all ? 'chip on' : 'chip'} onClick={() => { store.setSpeech({ natural: { ...NATURAL_ALL } }); }}>{L({ it: 'Tutti accesi', en: 'All on' })}</button>
          <button className={robot ? 'chip on' : 'chip'} onClick={() => { store.setSpeech({ natural: { timing: false, intonation: false, micro: false, voiceQuality: false, coarticulation: false } }); }}>{L({ it: 'Robot (tutti spenti)', en: 'Robot (all off)' })}</button>
          <button className="btn" onClick={() => void speak()}>▶ {L({ it: 'Riascolta', en: 'Play again' })}</button>
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
