import { SPEECH_LANGUAGES } from '../../dsp/speech/languages';
import { EXAMPLES, examplesByLanguage, exampleLang, languageName } from '../examples';

/** The languages a text can be said in: Italian and English (read by rules), then the others by name. */
export function LanguagePick(props: { value: string; onChange: (lang: string) => void; label?: string; disabled?: boolean }) {
  return (
    <select className="lang-pick" value={props.value} aria-label={props.label ?? 'Language'} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
      <option value="it">Italian</option>
      <option value="en">English (American)</option>
      {[...SPEECH_LANGUAGES].sort((a, b) => a.name.localeCompare(b.name)).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
}

/** Example sentences in many languages, by language: picking one gives its text and its language (`now` for IPA). */
export function ExamplePick(props: { now: string; onPick: (text: string, lang: string) => void }) {
  return (
    <select className="lang-pick" value="" aria-label="Example sentences, in many languages" onChange={(e) => {
      const ex = EXAMPLES[Number(e.target.value)];
      if (ex) props.onPick(ex.text, exampleLang(ex, props.now));
    }}>
      <option value="">Examples…</option>
      {examplesByLanguage().map(([code, list]) => (
        <optgroup key={code} label={languageName(code)}>
          {list.map((ex) => <option key={ex.text} value={EXAMPLES.indexOf(ex)}>{ex.text} ({ex.shows})</option>)}
        </optgroup>
      ))}
    </select>
  );
}
