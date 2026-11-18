import type { Telemetry } from '../../dsp/engine/engine';
import type { EngineParams } from '../../dsp/engine/params';
import type { Program, EndReason } from '../../audio/programRunner';

export type { Program, EndReason };

export interface StreamBlock { out: Float32Array; flow: Float32Array; noise: Float32Array }

/**
 * Where the voice goes: the audio thread in the browser (AudioBridge), a fake
 * in the tests. Only the voice controller talks to it.
 */
export interface VoiceSink {
  readonly running: boolean;
  readonly sampleRate: number;
  /** starts or resumes the audio; `params` are the first ones the engine gets */
  start(params: EngineParams): Promise<void>;
  suspend(): Promise<void>;
  /** parameters to sound now and once the running program (id, 0 = none) is over */
  params(params: EngineParams, after: EngineParams, program: number): void;
  program(p: Program): void;
  stop(id: number): void;
  /** new samples for a looping program that plays (see Program.loop) */
  swap(id: number, samples: Float32Array): void;
  /** more samples for a program that streams (see Program.stream); `last`: no more come */
  append(id: number, samples: Float32Array, last?: boolean): void;
  /** `at`: where a looping program is in its samples, s */
  onTelemetry: (t: Telemetry, program: number, at?: number) => void;
  onStream: (s: StreamBlock) => void;
  onEnded: (id: number, reason: EndReason, captured?: Float32Array) => void;
  onState: (running: boolean) => void;
  readonly micAnalyser: AnalyserNode | null;
  enableMic(): Promise<AnalyserNode>;
  disableMic(): void;
}
