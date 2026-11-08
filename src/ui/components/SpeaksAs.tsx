import { useL } from '../i18n';
import { store } from '../store';
import { useVoice } from '../voice/hooks';
import { BUILTIN_VOICES } from '../../dsp/voice/builtin';

/** Which voice says the text (its habits and way of speaking), and the way to the studio to change it or make one. */
export function SpeaksAs() {
  const L = useL();
  const active = useVoice((v) => v.active);
  const b = BUILTIN_VOICES.find((x) => x.design.id === active.id);
  const name = b ? L(b.name) : active.id === 'reference' ? L({ it: 'la voce di riferimento', en: 'the reference voice' }) : active.name || L({ it: 'senza nome', en: 'unnamed' });
  return (
    <p className="speaks-as small">
      {L({ it: 'Parla come', en: 'Speaks as' })}: <b>{name}</b>
      <button className="chip" onClick={() => store.setUi({ mode: 'voices' })} title={L({ it: 'Apri lo studio delle voci: cambia questa voce o creane una tua', en: 'Open the voice studio: change this voice or make one of your own' })}>
        {L({ it: 'Cambia voce', en: 'Change voice' })} →
      </button>
    </p>
  );
}
