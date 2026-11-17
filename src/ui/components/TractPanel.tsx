import { store, useStore, useTick } from '../store';
import { Slider, Section, Readout, OneOpen } from './controls';
import { TIMBRE_PRESETS } from '../presets';
import { voice, mriTube } from '../voice/voice';
import { useLock, useManual } from '../voice/hooks';
import { VOWELS, CONSONANTS } from '../../dsp/speech/phonemes';
import { ARTICULATOR_RANGES, Articulators } from '../../dsp/tract/types';
import { MRI_VOWELS } from '../../dsp/data/mri';
import { C } from '../canvas';

const SUSTAINABLE = ['s', 'z', 'ʃ', 'ʒ', 'f', 'v', 'θ', 'ð', 'h', 'm', 'n', 'ɲ', 'ŋ', 'l', 'ʎ', 'r', 'ɹ', 'j', 'w'];

export function TractPanel() {
  const p = useManual();
  const numbers = useStore((s) => s.ui.numbers);
  // locked sliders show the posture that sounds, so they follow it
  const driven = !!useLock('posture');
  useTick(driven ? 15 : numbers ? 4 : 0);
  const a = p.articulators;
  const live = voice.sounding().articulators;
  const setA = (k: keyof Articulators, v: number) => voice.edit((q) => { q.articulators[k] = v; });
  const ctl = (k: keyof Articulators) => (k === 'velum' ? 'velum' : 'posture');
  const names: Record<keyof Articulators, string> = {
    jaw: 'Jaw (opening)',
    tongueX: 'Tongue front/back',
    tongueY: 'Tongue up/down',
    tongueRoot: 'Tongue root forward/back',
    tipX: 'Tip front/back',
    tipY: 'Tip up/down',
    groove: 'Tongue groove',
    tongueSides: 'Tongue sides lowered (l)',
    lipOpen: 'Lip opening',
    lipRound: 'Lip rounding',
    lipProtrude: 'Lip protrusion (below zero: spread)',
    lipTuck: 'Lip under the teeth (f, v)',
    velum: 'Velum lowered (nose)',
    larynx: 'Larynx height',
    epilarynx: 'Sphincter above the folds (epilarynx)',
  };
  const fm = store.derived().formants;
  const af = store.derived().af;
  return (
    <div className="panel-body"><OneOpen>
      <Section title="Vowels" accent={C.teal}
        info={'Each vowel is a shape of the tube. In “ee” the tongue is high and front: low F1, high F2. In “ah” the mouth is open and the tongue low: F1 rises, F2 comes down. In “oo” the lips round and lengthen the tube: all formants drop.'}>
        <div className="chips ipa">
          {Object.keys(VOWELS).map((v) => (
            <button key={v} className="chip ipa" title={VOWELS[v].examples} onClick={() => voice.holdPhoneme(v)}>{v}</button>
          ))}
        </div>
      </Section>
      <Section title="Measured vowels (MRI)" accent={C.teal} open={false}
        info={'These shapes do not come from the drawing of the head: they were measured with magnetic resonance imaging on an adult man holding each vowel (Story 2008), one slice every 4 mm from the glottis to the lips. Load one: the tube becomes the real one, and you hear it. The vowels of the drawing are built to resemble these shapes while keeping the reference formants. Go back to the head from the “The tube” view.'}>
        <div className="chips ipa">
          {MRI_VOWELS.map((v) => (
            <button key={v.ipa} className="chip ipa" title={`${v.areas.length} × ${(10 * v.dx).toFixed(1)} mm`} onClick={() => {
              voice.loadTube(v.areas, v.areas.length * v.dx, mriTube(v.ipa), { takeOver: true });
              store.setUi({ viewTab: 'tube' });
            }}>{v.ipa}</button>
          ))}
        </div>
      </Section>
      <Section title={'Held consonants'} accent={C.violet}>
        <div className="chips ipa">
          {SUSTAINABLE.map((c) => (
            <button key={c} className="chip ipa" title={CONSONANTS[c].examples} onClick={() => voice.holdPhoneme(c)}>{c}</button>
          ))}
        </div>
      </Section>
      <Section title="Articulators" accent={C.teal} open={false}>
        {(Object.keys(names) as (keyof Articulators)[]).map((k) => (
          <Slider key={k} label={names[k]} value={a[k]} live={live[k]} control={ctl(k)} min={ARTICULATOR_RANGES[k][0]} max={ARTICULATOR_RANGES[k][1]} onChange={(v) => setA(k, v)} />
        ))}
      </Section>
      <Section title={'The person: timbre'} accent={C.rose}
        info={'One part of the filter changes with every sound; another belongs to the person: the length of the tract, the shape of the throat, how much sound leaks through the nose. These tint everything a person says: dark or bright, nasal, warm, hollow. A shorter tract (a child) raises all formants in proportion.'}>
        <div className="chips">
          {TIMBRE_PRESETS.map((t) => <button key={t.id} className="chip" title={t.hint} onClick={() => voice.edit(t.apply, { takeOver: true })}>{t.name}</button>)}
        </div>
        <Slider label={'Size (tract length)'} value={p.anatomy.scale} control="body" min={0.62} max={1.18} onChange={(v) => voice.edit((x) => { x.anatomy.scale = v; })} format={() => `${af.length.toFixed(1)} cm`} />
        <Slider label={'Pharynx: length'} value={p.anatomy.pharynx} control="body" min={0.72} max={1.25} onChange={(v) => voice.edit((x) => { x.anatomy.pharynx = v; })} />
        <Slider label={'Pharynx: width'} value={p.anatomy.pharynxWidth} control="body" min={0.55} max={1.6} onChange={(v) => voice.edit((x) => { x.anatomy.pharynxWidth = v; })} />
        <Slider label="Vault of the palate" value={p.anatomy.palateHeight} control="body" min={0.6} max={1.45}
          hint={'How high the palate rises between the ridge and the velum. The consonants the head says (Speak) are made again for this mouth: the same constriction in the same place.'}
          onChange={(v) => voice.edit((x) => { x.anatomy.palateHeight = v; })} />
        <Slider label="Width of the arch" value={p.anatomy.archWidth} control="body" min={0.8} max={1.25} onChange={(v) => voice.edit((x) => { x.anatomy.archWidth = v; })} />
        <Slider label={'Size of the tongue'} value={p.anatomy.tongueSize} control="body" min={0.92} max={1.08} onChange={(v) => voice.edit((x) => { x.anatomy.tongueSize = v; })} />
        <Slider label={'Frenulum of the tongue'} value={p.anatomy.tipReach} control="body" min={0.55} max={1}
          hint={'Short, it holds the tip down (tongue-tie): the jaw has to rise to close a /t/.'}
          onChange={(v) => voice.edit((x) => { x.anatomy.tipReach = v; })} />
        <Slider label="Width of the mouth" value={p.anatomy.mouthWidth} control="body" min={0.8} max={1.2} onChange={(v) => voice.edit((x) => { x.anatomy.mouthWidth = v; })} />
        <Slider label={'Thickness of the lips'} value={p.anatomy.lipThickness} control="body" min={0.7} max={1.4} onChange={(v) => voice.edit((x) => { x.anatomy.lipThickness = v; })} />
        <Slider label="Nasal leak" value={p.anatomy.nasalLeak} control="nose" min={0} max={1} onChange={(v) => voice.edit((x) => { x.anatomy.nasalLeak = v; })} />
        <Slider label={'Nasal cycle (congested side)'} value={p.anatomy.nasalCycle} control="nose" min={-1} max={1}
          hint={'The septum splits the nose into two passages. Every few hours the turbinates of one side swell while the other side’s shrink. Two unequal passages do not sound like one: the two paths interfere and add a resonance with its antiresonance (try an “m”).'}
          onChange={(v) => voice.edit((x) => { x.anatomy.nasalCycle = v; })}
          format={(v) => (Math.abs(v) < 0.05 ? 'equal' : v < 0 ? `left ${Math.round(-100 * v)} %` : `right ${Math.round(100 * v)} %`)} />
        <Slider label={'Left nostril open'} value={p.anatomy.nostrilLeft} control="nose" min={0} max={1} onChange={(v) => voice.edit((x) => { x.anatomy.nostrilLeft = v; })} format={(v) => `${Math.round(100 * v)} %`} />
        <Slider label={'Right nostril open'} value={p.anatomy.nostrilRight} control="nose" min={0} max={1} onChange={(v) => voice.edit((x) => { x.anatomy.nostrilRight = v; })} format={(v) => `${Math.round(100 * v)} %`} />
        <div className="chips">
          <button className={`chip${p.anatomy.nostrilLeft + p.anatomy.nostrilRight === 0 ? ' on' : ''}`}
            title={'With the lips closed and the nose pinched the air of an “m” has no way out: the mouth pressure rises to the lung pressure and the vocal folds stop vibrating.'}
            onClick={() => voice.edit((x) => { const shut = x.anatomy.nostrilLeft + x.anatomy.nostrilRight === 0; x.anatomy.nostrilLeft = shut ? 1 : 0; x.anatomy.nostrilRight = shut ? 1 : 0; })}>
            Pinch the nose
          </button>
        </div>
        <Slider label={'Piriform fossae: air inside'} value={p.anatomy.piriform} control="body" min={0} max={1}
          hint={'Beside the larynx there are two blind pouches, about 2 cm deep. The sound goes in and comes back out of step: around 4-5 kHz it cancels what arrives, and every vowel has a valley there. Filling them (as with water in experiments) shortens the pouches: the valley rises and finally disappears.'}
          onChange={(v) => voice.edit((x) => { x.anatomy.piriform = v; })} format={(v) => `${Math.round(100 * v)} %`} />
        <Slider label={names.larynx} value={a.larynx} live={live.larynx} control="posture" min={-1.5} max={1.2} onChange={(v) => setA('larynx', v)} format={(v) => `${v.toFixed(1)} cm`} />
        <Slider label={names.epilarynx} value={a.epilarynx} live={live.epilarynx} control="posture" min={-0.5} max={1}
          hint={'Above the vocal folds there is a short tube, the epilarynx. A ring of muscles can squeeze it: a little (0.3-0.5) and it rings by itself around 3 kHz, the singers’ “ring” and the “twang”; all the way (1) and it shuts, as in the epiglottal stop [ʡ] of Aghul, in the Caucasus.'}
          onChange={(v) => setA('epilarynx', v)} format={(v) => (v < 0 ? `wider ${Math.round(-100 * v)} %` : `${Math.round(100 * v)} %`)} />
        <Slider label="Wall losses" value={p.losses} control="walls" min={0.3} max={3} onChange={(v) => voice.edit((x) => { x.losses = v; })} format={(v) => `×${v.toFixed(1)}`} />
        <Slider label="Walls heard" value={p.wallRadiation} control="walls" min={0} max={1}
          hint={'The soft walls of the throat and the cheeks yield to the pressure and move with the voice; through the skin the neck sounds too. With the mouth shut on a “b” it is the only sound that comes out: the low hum of voicing. At 0 the closure is silent.'}
          onChange={(v) => voice.edit((x) => { x.wallRadiation = v; })} format={(v) => `${Math.round(100 * v)} %`} />
        <div className="chips">
          <button className={`chip${p.subglottal ? ' on' : ''}`}
            title={'Below the vocal folds there is another tube: the trachea and the bronchi, about 20 cm long. It resonates on its own, near 520, 1320 and 2200 Hz. With the folds shut it is not heard; when they open, in a breathy voice or an aspiration, the two tubes are joined and the spectrum takes small dips at those frequencies.'}
            onClick={() => voice.edit((x) => { x.subglottal = !x.subglottal; })}>
            Trachea and bronchi
          </button>
        </div>
        <Readout items={[
          ['length', `${af.length.toFixed(2)} cm`],
          ...fm.slice(0, 4).map((f, i) => [`F${i + 1}`, `${Math.round(f.f)} Hz (B ${Math.round(f.bw)})`] as [string, string]),
        ]} />
      </Section>
    </OneOpen></div>
  );
}
