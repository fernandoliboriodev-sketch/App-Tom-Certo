// Shared types for pitch engine across platforms.

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

export interface PitchEngineHandle {
  isSupported: boolean;
  start: (onPitch: PitchCallback, onError: ErrorCallback) => Promise<boolean>;
  stop: () => Promise<void>;
  setSoftInfoHandler?: (handler: (msg: string) => void) => void;
}
