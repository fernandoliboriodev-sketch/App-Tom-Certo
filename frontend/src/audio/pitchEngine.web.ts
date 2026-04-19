// Web platform implementation using Web Audio API + YIN algorithm.
import { yinPitch } from './yin';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';

export type PitchErrorReason =
  | 'permission_denied'
  | 'permission_blocked'
  | 'platform_limit'
  | 'unknown';

export interface PitchEvent {
  pitchClass: number;
  frequency: number;
  rms: number;
  clarity: number;
}

export type PitchCallback = (e: PitchEvent) => void;
export type ErrorCallback = (msg: string, reason: PitchErrorReason) => void;

export interface PitchEngine {
  isSupported: boolean;
  start(onPitch: PitchCallback, onError: ErrorCallback): Promise<boolean>;
  stop(): void;
}

class WebPitchEngine implements PitchEngine {
  isSupported = true;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private buffer: Float32Array | null = null;

  async start(onPitch: PitchCallback, onError: ErrorCallback): Promise<boolean> {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        onError('Seu navegador não suporta captura de microfone.', 'platform_limit');
        return false;
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const AnyAudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AnyAudioContext();
      if (this.ctx!.state === 'suspended') await this.ctx!.resume();

      this.source = this.ctx!.createMediaStreamSource(this.stream);
      this.analyser = this.ctx!.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.source.connect(this.analyser);

      this.buffer = new Float32Array(this.analyser.fftSize);
      const sr = this.ctx!.sampleRate;

      const loop = () => {
        if (!this.analyser || !this.buffer) return;
        this.analyser.getFloatTimeDomainData(this.buffer);
        const result = yinPitch(this.buffer, { sampleRate: sr });
        if (result.frequency > 0) {
          const midi = frequencyToMidi(result.frequency);
          const pc = midiToPitchClass(midi);
          onPitch({
            pitchClass: pc,
            frequency: result.frequency,
            rms: result.rms,
            clarity: result.probability,
          });
        }
        this.rafId = requestAnimationFrame(loop);
      };
      loop();
      return true;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (/permission|denied|NotAllowed/i.test(msg)) {
        onError('Permita o acesso ao microfone para detectar o tom.', 'permission_denied');
      } else if (/NotFound|DevicesNotFound/i.test(msg)) {
        onError('Nenhum microfone encontrado no dispositivo.', 'unknown');
      } else {
        onError('Erro ao acessar o microfone', 'unknown');
      }
      this.stop();
      return false;
    }
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    try { this.source?.disconnect(); } catch { /* */ }
    try { this.analyser?.disconnect(); } catch { /* */ }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }
}

export function createPitchEngine(): PitchEngine {
  return new WebPitchEngine();
}
