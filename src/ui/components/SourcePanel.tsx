import { store, useStore, useTick } from '../store';
import { voice } from '../voice/voice';
import { useLock, useManual } from '../voice/hooks';
import { Slider, Toggle, Seg, Section, Readout, OneOpen } from './controls';
import { VOICE_PRESETS } from '../presets';
import { noteName, C } from '../canvas';
import { quotients, rdToTiming } from '../../dsp/glottis/lf';
import type { EngineParams } from '../../dsp/engine/params';

export function SourcePanel() {
  const p = useManual();
  const s = p.source;
  const numbers = useStore((st) => st.ui.numbers);
  // locked sliders show what sounds, so they follow it
  const driven = !!useLock('pitch') || !!useLock('lungs');
  useTick(driven ? 15 : numbers ? 4 : 0);
  const t = store.telemetry;
  const live = voice.sounding();
  const set = (f: (q: EngineParams) => void) => voice.edit(f);
  const q = quotients(rdToTiming(s.rd));
  return (
    <div className="panel-body"><OneOpen>
      <Section title={'Lungs and vocal folds'} accent={C.amber}
        info={'Air from the lungs pushes the vocal folds apart; their elasticity and the suction of the fast air pull them back. Each cycle lets out a puff of air: many puffs per second make the buzz. The rate of the cycles is the pitch (F0). Below about 2-3 cm of water of pressure the folds stop vibrating.'}>
        <div className="row wrap">
          <Toggle label={'Blow (lungs)'} value={p.phonate} control="lungs" onChange={(v) => { if (v) void voice.ensureAudio(); set((x) => { x.phonate = v; }); }} />
          <Toggle label="Folds vibrate" value={p.voicing} control="quality" onChange={(v) => set((x) => { x.voicing = v; })} />
          <Toggle label={'Filter: none (hear the raw buzz)'} value={p.bypassTract} control="filter" onChange={(v) => voice.setFilter(v ? 'bypass' : 'head')} />
        </div>
        <Slider label="Pitch F0" value={s.f0} live={live.source.f0} control="pitch" min={40} max={900} log onChange={(v) => set((x) => { x.source.f0 = v; })} format={(v) => `${Math.round(v)} Hz · ${noteName(v)}`} color={C.amber}
          hint={'Stretching the folds makes them vibrate faster: the fundamental rises and every harmonic with it.'} />
        <Slider label={'Lung pressure'} value={s.ps} live={live.source.ps} control="lungs" min={0} max={20} step={0.1} onChange={(v) => set((x) => { x.source.ps = v; })} format={(v) => `${v.toFixed(1)} cmH₂O`} />
        <Slider label={'Glottal opening'} value={p.abduction} live={live.abduction} control="glottis" min={0} max={1} onChange={(v) => set((x) => { x.abduction = v; })} format={(v) => (v < 0.15 ? 'closed (voice)' : v < 0.4 ? 'half open' : 'open (breath)')} />
        <Slider label={'Vibrato (cents)'} value={s.vibratoDepth} control="pitch" min={0} max={120} step={1} onChange={(v) => set((x) => { x.source.vibratoDepth = v; })} format={(v) => `${v.toFixed(0)} · ${s.vibratoRate.toFixed(1)} Hz`} />
      </Section>

      <Section title="Voice types" accent={C.amber}>
        <div className="chips">
          {VOICE_PRESETS.map((v) => (
            <button key={v.id} className="chip" title={v.hint} onClick={() => { voice.edit((x) => { v.apply(x); x.phonate = true; }, { takeOver: true }); void voice.ensureAudio(); }}>{v.name}</button>
          ))}
        </div>
      </Section>

      <Section title="Vocal fold model" accent={C.amber}
        info={'Liljencrants-Fant (LF): the shape of each puff is described by a few numbers. Rd goes from pressed (0.3) to breathy (2.7) voice: with a high Rd the closure is gentler and the high harmonics drop. “Two-mass”: each fold is two elastic masses that oscillate on their own, driven by the air; the pitch comes from the tension.'}>
        <Seg value={s.model} control="quality" options={[['lf', 'LF (Fant 1985)'], ['twomass', 'Two-mass (self-oscillating)'], ['areas', 'Areas (Titze 1984)']]} onChange={(v) => set((x) => { x.source.model = v; })} />
        {s.model === 'areas' && <>
          <Slider label="Rest gap, lower edge" value={s.gapLow} control="quality" min={0} max={0.2} step={0.001} onChange={(v) => set((x) => { x.source.gapLow = v; })} format={(v) => `${(v * 10).toFixed(2)} mm`}
            hint={'Before they vibrate the folds stay apart at the back: wider, they close less, the voice is softer and breathier.'} />
          <Slider label="Rest gap, upper edge" value={s.gapHigh} control="quality" min={0} max={0.2} step={0.001} onChange={(v) => set((x) => { x.source.gapHigh = v; })} format={(v) => `${(v * 10).toFixed(2)} mm`} />
          <Slider label="Lag of the upper edge" value={s.edgeLag} control="quality" min={0} max={120} step={1} onChange={(v) => set((x) => { x.source.edgeLag = v; })} format={(v) => `${v.toFixed(0)}°`}
            hint={'The upper edge follows the lower one like a wave: more lag, a faster closing and more harmonics.'} />
          <Slider label={'Slow opening, fast closing'} value={s.areaSkew} control="quality" min={-0.8} max={0.8} step={0.01} onChange={(v) => set((x) => { x.source.areaSkew = v; })} />
          <Slider label={'Size of the swing'} value={s.swing} control="quality" min={0.3} max={2} step={0.01} onChange={(v) => set((x) => { x.source.swing = v; })} />
          <Slider label={'Vibrating length'} value={s.vibLength} control="quality" min={0.6} max={2} step={0.01} onChange={(v) => set((x) => { x.source.vibLength = v; })} format={(v) => `${v.toFixed(2)} cm`} />
        </>}
        {s.model === 'lf' ? <>
          <Toggle label="Separate parameters (Oq, αm, Ra)" value={s.advanced} control="quality" onChange={(v) => set((x) => { x.source.advanced = v; })} />
          {!s.advanced ? (
            <Slider label="Rd" value={s.rd} control="quality" min={0.3} max={2.7} onChange={(v) => set((x) => { x.source.rd = v; })} format={(v) => `${v.toFixed(2)} · ${v < 0.7 ? 'pressed' : v < 1.4 ? 'modal' : 'breathy'}`} />
          ) : <>
            <Slider label={'Open quotient Oq'} value={s.oq} control="quality" min={0.3} max={0.95} onChange={(v) => set((x) => { x.source.oq = v; })} />
            <Slider label="Asymmetry αm" value={s.alphaM} control="quality" min={0.55} max={0.9} onChange={(v) => set((x) => { x.source.alphaM = v; })} />
            <Slider label={'Return phase Ra'} value={s.ra} control="quality" min={0.005} max={0.2} step={0.001} onChange={(v) => set((x) => { x.source.ra = v; })} format={(v) => v.toFixed(3)} />
          </>}
          <Slider label={'Peak opening'} value={s.peakArea} control="quality" min={0.02} max={0.3} step={0.005} onChange={(v) => set((x) => { x.source.peakArea = v; })} format={(v) => `${v.toFixed(3)} cm²`} />
          <Slider label={'Source-tract interaction'} value={s.interaction} control="quality" min={0} max={1} onChange={(v) => set((x) => { x.source.interaction = v; })} />
        </> : s.model === 'twomass' && <>
          <Toggle label={'Automatic tension (follows the pitch)'} value={s.tensionAuto} control="quality" onChange={(v) => set((x) => { x.source.tensionAuto = v; })} />
          {!s.tensionAuto && <Slider label={'Tension Q'} value={s.q} control="quality" min={0.4} max={4} onChange={(v) => set((x) => { x.source.q = v; })} />}
          <Slider label="Left/right asymmetry" value={s.asym} control="quality" min={0} max={0.8} onChange={(v) => set((x) => { x.source.asym = v; })} />
          <Slider label={'Rest opening'} value={s.restArea} control="quality" min={0} max={0.12} step={0.002} onChange={(v) => set((x) => { x.source.restArea = v; })} format={(v) => `${v.toFixed(3)} cm²`} />
        </>}
        <Slider label={'Fold thickness'} value={s.thickness} control="quality" min={0.2} max={1.2}
          hint={'How much of the folds vibrates top to bottom: 1 the chest voice, below 0.5 falsetto (only the thin edge vibrates, it barely closes, the fundamental dominates).'}
          onChange={(v) => set((x) => { x.source.thickness = v; })} format={(v) => `${v.toFixed(2)} · ${v < 0.5 ? 'falsetto' : v < 0.85 ? 'mixed' : 'chest'}`} />
        <Slider label={'Posterior chink (leak)'} value={s.chink} control="quality" min={0} max={0.2} step={0.002} onChange={(v) => set((x) => { x.source.chink = v; })} format={(v) => `${v.toFixed(3)} cm²`} />
        <Readout items={[
          ['Oq', q.oq.toFixed(2)], ['αm', q.alphaM.toFixed(2)], ['Ra', q.ra.toFixed(3)],
          ['F0', t?.f0 ? `${t.f0.toFixed(1)} Hz` : '–'], ['glottal Re', t ? t.glottalRe.toFixed(0) : '–'],
          ['Po', t ? `${(t.po / 980.665).toFixed(2)} cmH₂O` : '–'], ['Ug', t ? `${t.ug.toFixed(0)} cm³/s` : '–'],
        ]} />
      </Section>

      <Section title="Irregularities" accent={C.amber} open={false}
        info={'Jitter and shimmer: small cycle-to-cycle variations of period and amplitude. Diplophonia: every other cycle weaker, typical of creaky voice.'}>
        <Slider label="Jitter" value={s.jitter} control="quality" min={0} max={8} step={0.1} onChange={(v) => set((x) => { x.source.jitter = v; })} format={(v) => `${v.toFixed(1)} %`} />
        <Slider label="Shimmer" value={s.shimmer} control="quality" min={0} max={20} step={0.1} onChange={(v) => set((x) => { x.source.shimmer = v; })} format={(v) => `${v.toFixed(1)} %`} />
        <Slider label={'Diplophonia'} value={s.diplophonia} control="quality" min={0} max={1} onChange={(v) => set((x) => { x.source.diplophonia = v; })} />
        <Slider label="Vibrato rate" value={s.vibratoRate} control="pitch" min={3} max={8} step={0.1} onChange={(v) => set((x) => { x.source.vibratoRate = v; })} format={(v) => `${v.toFixed(1)} Hz`} />
      </Section>
    </OneOpen></div>
  );
}
