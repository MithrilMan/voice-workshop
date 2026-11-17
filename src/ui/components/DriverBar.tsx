
import { useTick } from '../store';
import { voice } from '../voice/voice';
import { useLanes, useVoice } from '../voice/hooks';
import type { Lock, Performer } from '../voice/drivers';

type Busy = Exclude<Performer, { kind: 'hands' }>['kind'];

const PERFORMER: Record<Busy, string> = {
  sentence: 'Sentence',
  melody: 'Melody',
  glide: 'Pitch glide',
  clip: 'Playing',
};

/** What each performer takes from the hands while it plays. */
const OWNS: Record<Busy, string> = {
  sentence: 'moves the tongue, lips, jaw, velum, pitch, lungs and glottis',
  melody: 'plays the pitch, lungs and glottis: the mouth stays yours',
  glide: 'moves the pitch',
  clip: 'plays on its own: the controls wait',
};

/** Why a control (or the whole head) is locked, and how to get it back. */
export function lockText(l: Lock, what: 'control' | 'head' = 'control'): string {
  const head = what === 'head';
  const drives: string = head ? 'moves the head' : 'drives this control';
  const use: string = head ? 'to move it by hand' : 'to use this control';
  switch (l.by) {
    case 'sentence': return `The sentence “${l.label}” ${drives}. Stop it or take over.`;
    case 'melody': return `The melody ${drives}. Stop it or take over.`;
    case 'glide': return 'The pitch is gliding by itself: wait a moment or stop it.';
    case 'clip': return `“${l.label}” is playing: wait for it to end or stop it.`;
    case 'tube': return `The filter is the ${l.label}: the head is not used. Go back to the head ${use}.`;
    case 'bypass': return `No filter: you hear the raw source and the head is not used. Go back to the head ${use}.`;
  }
}

/** Who holds a control, in a few words (for badges). */
export function lockShort(l: Lock): string {
  switch (l.by) {
    case 'sentence': return `sentence “${l.label}”`;
    case 'melody': return 'melody';
    case 'glide': return 'pitch glide';
    case 'clip': return l.label;
    case 'tube': return l.label;
    case 'bypass': return 'filter: none';
  }
}

/** Who drives the voice right now, what that locks, and the way back to the hands. */
export function DriverBar() {
  const lanes = useLanes();
  const sound = useVoice((v) => v.soundOn);
  const running = useVoice((v) => v.running);
  const p = lanes.performer, f = lanes.filter;
  useTick(p.kind !== 'hands' ? 12 : 0);
  const pr = voice.progress();
  return (
    <div className="driver-bar" role="status">
      {p.kind === 'hands' ? (
        <span className="driver hands">
          <span aria-hidden>✋</span> Your hands drive the voice
          {!sound && <em> · {running ? 'lungs off: press “Sound” to hear it' : 'sound off: press “Sound” to hear it'}</em>}
        </span>
      ) : (
        <span className="driver busy">
          <b>{PERFORMER[p.kind]}</b> <span className="driver-label">{p.label}</span>
          {pr && pr.seconds > 0 && <span className="progress" aria-hidden><span style={{ width: `${100 * Math.min(1, pr.t / pr.seconds)}%` }} /></span>}
          <span className="small muted">{p.kind === 'melody' && p.buzz ? 'plays the pitch, lungs and glottis with no filter' : OWNS[p.kind]}</span>
          <button className="chip" onClick={() => voice.stop()}>■ Stop</button>
          {p.kind !== 'glide' && !(p.kind === 'clip' && p.samples) && (
            <button className="chip on teal" title={'Stop here and keep the posture and pitch sounding now'} onClick={() => voice.takeOver()}>
              ✋ Take over
            </button>
          )}
        </span>
      )}
      {f.kind !== 'head' && (
        <span className="driver filter">
          <b>Filter:</b> {f.kind === 'tube' ? f.label : 'none, you hear the raw source'}
          <span className="small muted">the head is not used</span>
          <button className="chip" onClick={() => voice.setFilter('head', { takeOver: true })}>Back to the head</button>
        </span>
      )}
    </div>
  );
}
