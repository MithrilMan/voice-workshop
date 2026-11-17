
import { store } from '../store';
import { useVoice } from '../voice/hooks';
import { BUILTIN_VOICES } from '../../dsp/voice/builtin';

/** Which voice says the text (its habits and way of speaking), and the way to the studio to change it or make one. */
export function SpeaksAs() {
  const active = useVoice((v) => v.active);
  const b = BUILTIN_VOICES.find((x) => x.design.id === active.id);
  const name = b ? b.name : active.id === 'reference' ? 'the reference voice' : active.name || 'unnamed';
  return (
    <p className="speaks-as small">
      Speaks as: <b>{name}</b>
      <button className="chip" onClick={() => store.setUi({ mode: 'voices' })} title={'Open the voice studio: change this voice or make one of your own'}>
        Change voice →
      </button>
    </p>
  );
}
