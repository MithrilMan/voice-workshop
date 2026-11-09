import { useId, useState } from 'react';
import { useL } from '../i18n';
import { Seg } from './controls';
import type { Field } from '../../dsp/voice/design';

type Value = number | boolean | string;

const decimals = (step = 0.01) => Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

/** whether two values of a field are the same (numbers: within half a step) */
export const sameValue = (f: Field, a: Value, b: Value): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < (f.step ?? 0.01) / 2 : a === b;

/** The number of a field, to read and to type: arrows step it, Enter or leaving it keeps it. */
function NumberBox({ f, value, label, onCommit }: { f: Field; value: number; label: string; onCommit: (v: number) => void }) {
  const d = decimals(f.step);
  /** what is being typed (null: showing the value) */
  const [typed, setTyped] = useState<string | null>(null);
  const parse = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
  const clamp = (x: number) => Math.max(f.min!, Math.min(f.max!, x));
  return (
    <span className="fld-num">
      <input type="text" inputMode="decimal" aria-label={label} value={typed ?? value.toFixed(d)}
        onFocus={(e) => { setTyped(value.toFixed(d)); e.target.select(); }}
        onChange={(e) => {
          setTyped(e.target.value);
          const x = parse(e.target.value);
          if (Number.isFinite(x) && x >= f.min! && x <= f.max!) onCommit(x);
        }}
        onBlur={() => { const x = parse(typed ?? ''); if (Number.isFinite(x)) onCommit(clamp(x)); setTyped(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const x = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * f.step!);
            onCommit(x); setTyped(x.toFixed(d));
          }
        }} />
      {f.unit && <small>{f.unit}</small>}
    </span>
  );
}

/**
 * One field of a voice on one line: its name (a click unfolds what it does),
 * its control, its number to read or type, and a way back to the value it
 * had (`was`), which the slider marks while the field differs from it.
 */
export function VoiceField({ f, value, was, hints, onChange }: { f: Field; value: Value; was: Value; hints: boolean; onChange: (path: string, v: Value) => void }) {
  const L = useL();
  const id = useId();
  const [own, setOwn] = useState(false);
  const open = hints || own;
  const changed = !sameValue(f, value, was);
  const label = L(f.label);
  const snap = (x: number) => Math.round(x / f.step!) * f.step!;
  const wasText = typeof was === 'number' ? `${was.toFixed(decimals(f.step))}${f.unit ? ` ${f.unit}` : ''}`
    : typeof was === 'boolean' ? L(was ? { it: 'sì', en: 'on' } : { it: 'no', en: 'off' })
      : L(f.options?.find((o) => o.value === was)?.label ?? { it: String(was), en: String(was) });
  return (
    <div className={changed ? 'fld changed' : 'fld'}>
      <div className="fld-row">
        <button type="button" className="fld-name" aria-expanded={open} aria-controls={id} title={L(f.hint)} onClick={() => setOwn(!own)}>
          <span className="fld-dot" aria-hidden />{label}
        </button>
        {f.kind === 'number' && (
          <>
            <span className="fld-track" style={{ ['--was' as string]: ((was as number) - f.min!) / (f.max! - f.min!) }}>
              <input type="range" aria-label={label} min={f.min} max={f.max} step={f.step} value={value as number}
                onChange={(e) => onChange(f.path, snap(Number(e.target.value)))} onDoubleClick={() => onChange(f.path, was)} />
              {changed && <i className="fld-was" aria-hidden />}
            </span>
            <NumberBox f={f} value={value as number} label={`${label}: ${L({ it: 'valore', en: 'value' })}`} onCommit={(x) => onChange(f.path, x)} />
          </>
        )}
        {f.kind === 'boolean' && (
          <label className="toggle fld-wide">
            <input type="checkbox" aria-label={label} checked={value as boolean} onChange={(e) => onChange(f.path, e.target.checked)} />
            <span className="track"><span className="knob" /></span>
          </label>
        )}
        {f.kind === 'enum' && (
          <span className="fld-wide"><Seg value={value as string} options={f.options!.map((o) => [o.value, L(o.label)] as [string, string])} onChange={(x) => onChange(f.path, x)} /></span>
        )}
        <button type="button" className="fld-reset" disabled={!changed} onClick={() => onChange(f.path, was)}
          title={L({ it: `Torna a com’era: ${wasText}`, en: `Back to what it was: ${wasText}` })} aria-label={L({ it: `${label}: torna a com’era (${wasText})`, en: `${label}: back to what it was (${wasText})` })}>↺</button>
      </div>
      {open && <p id={id} className="field-hint">{L(f.hint)}</p>}
    </div>
  );
}
