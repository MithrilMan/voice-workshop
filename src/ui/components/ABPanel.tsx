import { useRef, useState } from 'react';
import { Section } from './controls';
import { useAnimatedCanvas, C } from '../canvas';
import { EngineParams } from '../../dsp/engine/params';
import { voice } from '../voice/voice';
import { cloneParams } from '../voice/controls';
import { useLanes } from '../voice/hooks';
import { welch } from '../../dsp/util/fft';
import { applyPhoneme, VOICE_PRESETS, TIMBRE_PRESETS } from '../presets';
interface Experiment { id: string; title: string; question: string; a: string; b: string; setA: (p: EngineParams) => void; setB: (p: EngineParams) => void; answer: string }

const vowelAt = (v: string, f0: number) => (p: EngineParams) => { applyPhoneme(v, p); p.source.f0 = f0; };
const preset = (list: typeof VOICE_PRESETS, id: string) => list.find((x) => x.id === id)!.apply;

const EXPERIMENTS: Experiment[] = [
  {
    id: 'pitch', title: 'Same filter, different pitch',
    question: 'Does the vowel change if I raise the pitch?',
    a: '“ah” at 110 Hz', b: '“ah” at 220 Hz',
    setA: vowelAt('a', 110), setB: vowelAt('a', 220),
    answer: 'The harmonics spread apart and slide under the same envelope: the vowel stays “ah” and the voice stays recognizable.',
  },
  {
    id: 'vowel', title: 'Same pitch, different filter',
    question: 'What changes between “ah” and “ee” on the same note?',
    a: '“ah” at 150 Hz', b: '“ee” at 150 Hz',
    setA: vowelAt('a', 150), setB: vowelAt('i', 150),
    answer: 'The harmonics stay at the same multiples of 150 Hz; the envelope changes: in “ee” F1 drops and F2 rises.',
  },
  {
    id: 'size', title: 'Same vowel, different body',
    question: 'A shorter tract, with the same pitch?',
    a: 'adult tract', b: 'child tract',
    setA: (p) => { vowelAt('a', 180)(p); p.anatomy.scale = 1; }, setB: (p) => { vowelAt('a', 180)(p); p.anatomy.scale = 0.74; p.anatomy.pharynx = 0.82; },
    answer: 'All formants rise by about a third: the same “ah”, from a smaller person.',
  },
  {
    id: 'timbre', title: 'Dark versus bright',
    question: 'What does the shape of the throat do?',
    a: 'low larynx, wide pharynx', b: 'high larynx, narrow pharynx',
    setA: (p) => { vowelAt('ə', 130)(p); preset(TIMBRE_PRESETS, 'dark')(p); }, setB: (p) => { vowelAt('ə', 130)(p); preset(TIMBRE_PRESETS, 'bright')(p); },
    answer: 'Same vowel and pitch, but the envelope shifts: a part of timbre that belongs to the person.',
  },
  {
    id: 'nasal', title: 'Velum closed versus open',
    question: 'What does the nose add?',
    a: 'oral “ah”', b: 'nasalized “ah”',
    setA: vowelAt('a', 130), setB: (p) => { vowelAt('a', 130)(p); p.articulators.velum = 0.7; },
    answer: 'The nasal branch adds resonances and anti-resonances: F1 broadens and drops, valleys appear in the spectrum.',
  },
  {
    id: 'nostril', title: 'One nostril pinched',
    question: 'The nose has two passages: what happens if I close one?',
    a: '“m” with a free nose', b: '“m” with the left nostril pinched',
    setA: vowelAt('m', 130), setB: (p) => { vowelAt('m', 130)(p); p.anatomy.nostrilLeft = 0; },
    answer: 'The pinched passage becomes a closed side branch: it adds an antiresonance near 560 Hz and lowers the first resonance of the hum from about 320 to 240 Hz. Pinch both and the air has no way out: the hum dies.',
  },
  {
    id: 'pulse', title: 'Steady versus pulsed hiss',
    question: 'Is the hiss of a breathy voice steady?',
    a: 'steady hiss', b: 'pulsed hiss (physical)',
    setA: (p) => { vowelAt('a', 110)(p); preset(VOICE_PRESETS, 'breathy')(p); p.noise.aspirationPulse = 0; p.noise.aspiration = 8; },
    setB: (p) => { vowelAt('a', 110)(p); preset(VOICE_PRESETS, 'breathy')(p); p.noise.aspirationPulse = 1; p.noise.aspiration = 8; },
    answer: 'In a real voice the hiss pulses with every cycle of the folds, strongest while they are open: it sounds more natural and fuses with the buzz.',
  },
  {
    id: 'whisper', title: 'Voice versus whisper',
    question: 'Without the buzz, is the vowel still there?',
    a: 'voiced “ee”', b: 'whispered “ee”',
    setA: vowelAt('i', 120), setB: (p) => { vowelAt('i', 120)(p); preset(VOICE_PRESETS, 'whisper')(p); },
    answer: 'The filter is the same: the formants show in the hiss too, but there are no harmonics and no pitch.',
  },
  {
    id: 'model', title: 'Two fold models',
    question: 'Drawn puffs or folds that oscillate on their own?',
    a: 'LF model', b: 'two-mass model',
    setA: vowelAt('a', 120), setB: (p) => { vowelAt('a', 120)(p); p.source.model = 'twomass'; },
    answer: 'The second comes from the physics of the folds: the shape of the puff changes with pressure and with the tract (interaction).',
  },
];

/** Long-term spectrum of a clip as heard, from 0.2 s on (after the onset). */
interface Clip { spec: Float64Array; fs: number }
const CLIP_SECONDS = 1.5;

/** `start`: the experiment shown first (by id). */
export function ABPanel({ start }: { start?: string } = {}) {
  const [exp, setExp] = useState(EXPERIMENTS.find((x) => x.id === start) ?? EXPERIMENTS[0]);
  const [clips, setClips] = useState<{ a: Clip | null; b: Clip | null }>({ a: null, b: null });
  const perf = useLanes().performer;
  const [showAnswer, setShowAnswer] = useState(false);
  const custom = useRef<{ a: EngineParams | null; b: EngineParams | null }>({ a: null, b: null });

  /** The experiments start from the hands' voice, on the head. */
  const base = (): EngineParams => { const p = cloneParams(voice.manual); p.tubeMode = false; p.bypassTract = false; return p; };
  const clipLabel = (which: 'a' | 'b') => {
    const l = which === 'a' ? exp.a : exp.b, k = which.toUpperCase();
    return `${k} · ${l}`;
  };
  const run = async (which: 'a' | 'b') => {
    let p: EngineParams;
    if (exp.id === 'custom') {
      const c = custom.current[which];
      if (!c) return;
      p = cloneParams(c);
    } else { p = base(); (which === 'a' ? exp.setA : exp.setB)(p); }
    p.phonate = true;
    // the voice plays the state live (the head and the views show it); the spectrum comes from the samples heard
    const { samples } = await voice.playClip(p, CLIP_SECONDS, clipLabel(which));
    const fs = voice.sampleRate;
    if (samples && samples.length > 0.6 * fs) setClips((c) => ({ ...c, [which]: { spec: welch(samples.subarray(Math.round(0.2 * fs)), 4096), fs } }));
  };
  const playing = (which: 'a' | 'b') => perf.kind === 'clip' && perf.label === clipLabel(which);

  const ref = useAnimatedCanvas(({ ctx, w, h }) => {
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
    const fmax = 5000;
    const X = (f: number) => 30 + (f / fmax) * (w - 40);
    const Y = (db: number) => 8 + (-db / 80) * (h - 26);
    ctx.strokeStyle = C.grid; ctx.fillStyle = C.muted; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let f = 0; f <= fmax; f += 1000) { ctx.beginPath(); ctx.moveTo(X(f), 8); ctx.lineTo(X(f), h - 18); ctx.stroke(); ctx.fillText(f ? f / 1000 + 'k' : '0', X(f), h - 15); }
    const all = [clips.a, clips.b].filter(Boolean) as Clip[];
    let mx = -200;
    for (const c of all) for (let k = 1; k < c.spec.length; k++) { const f = (k * c.fs) / 4096; if (f > fmax) break; mx = Math.max(mx, 10 * Math.log10(c.spec[k] + 1e-20)); }
    const draw = (c: Clip | null, col: string) => {
      if (!c) return;
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 1; k < c.spec.length; k++) { const f = (k * c.fs) / 4096; if (f > fmax) break; const y = Y(Math.max(-80, 10 * Math.log10(c.spec[k] + 1e-20) - mx)); if (k === 1) ctx.moveTo(X(f), y); else ctx.lineTo(X(f), y); }
      ctx.stroke();
    };
    draw(clips.a, C.amber); draw(clips.b, C.teal);
    if (!all.length) { ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText('listen to A and B to compare their spectra', w / 2, h / 2); }
  });

  return (
    <div className="panel-body">
      <Section title={'A/B experiment'} accent={C.teal}
        info={'The key idea: buzz and filter are controlled almost independently. Each experiment changes one thing between A and B; listen and watch how the harmonics and the envelope move. With “My A and B” you compare two lab states you captured.'}>
        <select value={exp.id} onChange={(e) => { setExp(e.target.value === 'custom' ? { ...EXPERIMENTS[0], id: 'custom', title: 'My A and B', question: 'Capture two states and compare them.', a: 'A', b: 'B', answer: '' } : EXPERIMENTS.find((x) => x.id === e.target.value)!); setClips({ a: null, b: null }); setShowAnswer(false); }}>
          {EXPERIMENTS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          <option value="custom">My A and B</option>
        </select>
        <p className="question">{exp.question}</p>
        {exp.id === 'custom' && (
          <div className="row">
            <button className="chip" onClick={() => { custom.current.a = cloneParams(voice.manual); setClips((c) => ({ ...c, a: null })); }}>Capture A from the lab{custom.current.a ? ' ✓' : ''}</button>
            <button className="chip" onClick={() => { custom.current.b = cloneParams(voice.manual); setClips((c) => ({ ...c, b: null })); }}>Capture B from the lab{custom.current.b ? ' ✓' : ''}</button>
          </div>
        )}
        <div className="ab-buttons">
          <button className={playing('a') ? 'btn ab a on' : 'btn ab a'} onClick={() => void run('a')}><b>A</b> {exp.a}</button>
          <button className={playing('b') ? 'btn ab b on' : 'btn ab b'} onClick={() => void run('b')}><b>B</b> {exp.b}</button>
        </div>
        <canvas ref={ref} className="ab-canvas" />
        {exp.id !== 'custom' && (
          showAnswer ? <p className="answer">{exp.answer}</p> : <button className="chip" onClick={() => setShowAnswer(true)}>What happens?</button>
        )}
      </Section>
    </div>
  );
}
