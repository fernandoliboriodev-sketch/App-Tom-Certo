// Native platform pitch engine for Android/iOS.
import Constants from 'expo-constants';
import * as ExpoAudio from 'expo-audio';
import * as storage from '../auth/storage';

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
  onSoftInfo?: (msg: string) => void;
}

const PERM_KEY = 'tc_mic_granted_v1';

async function ensureMicPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    const current = await ExpoAudio.getRecordingPermissionsAsync().catch(() => null);
    if (current && current.granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if (current && (current as any).canAskAgain === false) return 'blocked';
    const next = await ExpoAudio.requestRecordingPermissionsAsync();
    if (next.granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if ((next as any).canAskAgain === false) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

class NativePitchEngine implements PitchEngine {
  private running = false;
  private softInfoTimer: ReturnType<typeof setTimeout> | null = null;
  onSoftInfo?: (msg: string) => void;

  isSupported = true;

  async start(
    _onPitch: PitchCallback,
    onError: ErrorCallback
  ): Promise<boolean> {
    const perm = await ensureMicPermission();
    if (perm === 'blocked') {
      onError(
        'Permita o acesso ao microfone nas configurações do app para detectar o tom.',
        'permission_blocked'
      );
      return false;
    }
    if (perm === 'denied') {
      onError(
        'Permita o acesso ao microfone para detectar o tom.',
        'permission_denied'
      );
      return false;
    }

    try {
      try {
        await ExpoAudio.setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        } as any);
      } catch { /* audio mode might not be supported in some runtimes */ }

      this.running = true;

      const isExpoGo = Constants.executionEnvironment === 'storeClient';
      if (isExpoGo) {
        this.softInfoTimer = setTimeout(() => {
          if (this.running && this.onSoftInfo) {
            this.onSoftInfo(
              'Detecção avançada chega em breve nesta versão. Para o tom em tempo real, abra pelo navegador do celular.'
            );
          }
        }, 4500);
      }

      return true;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      onError('Não foi possível iniciar o microfone: ' + msg, 'unknown');
      this.running = false;
      return false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.softInfoTimer) {
      clearTimeout(this.softInfoTimer);
      this.softInfoTimer = null;
    }
  }
}

export function createPitchEngine(): PitchEngine {
  return new NativePitchEngine();
}
