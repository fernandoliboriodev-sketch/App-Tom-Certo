// NATIVE (iOS/Android) pitch engine using @siteed/audio-studio for real PCM streaming.
// Feeds Float32 samples to the YIN algorithm frame-by-frame.

import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  AudioStudioModule,
  AudioDataEvent,
} from '@siteed/audio-studio';

import { yinPitch } from './yin';
import { frequencyToMidi, midiToPitchClass } from '../utils/noteUtils';
import * as storage from '../auth/storage';
import type {
  PitchCallback,
  ErrorCallback,
  PitchEngineHandle,
  PitchErrorReason,
} from './types';

// ─── Audio capture parameters ────────────────────────────────────────────────
// Lower sample rate = less CPU, still plenty for pitch (vocals/instruments up to ~1500Hz).
// 16kHz Nyquist=8kHz which covers far more than needed.
const SAMPLE_RATE = 16000;
// YIN window: 2048 samples at 16kHz = 128ms frame.
// Gives good resolution down to ~60Hz while staying responsive.
const FRAME_SIZE = 2048;
// Chunk interval from the native side (ms). Smaller = more frequent updates.
const STREAM_INTERVAL_MS = 100;

const PERM_KEY = 'tc_mic_granted_v1';

async function ensureMicPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    // The module uses the same permission pattern as expo-modules.
    const current = await AudioStudioModule.getPermissionsAsync?.().catch(() => null);
    if (current && (current as any).granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if (current && (current as any).canAskAgain === false) return 'blocked';
    const next = await AudioStudioModule.requestPermissionsAsync();
    if ((next as any).granted) {
      await storage.setItem(PERM_KEY, '1');
      return 'granted';
    }
    if ((next as any).canAskAgain === false) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

export function usePitchEngine(): PitchEngineHandle {
  const recorder = useAudioRecorder();

  const onPitchRef = useRef<PitchCallback | null>(null);
  const onErrorRef = useRef<ErrorCallback | null>(null);
  const softInfoRef = useRef<((msg: string) => void) | null>(null);
  const activeRef = useRef(false);
  // Rolling buffer of Float32 samples waiting to fill a YIN frame.
  const accumRef = useRef<Float32Array>(new Float32Array(0));

  const runYinOnFrame = useCallback((frame: Float32Array, sampleRate: number) => {
    const result = yinPitch(frame, { sampleRate });
    if (result.frequency > 0 && onPitchRef.current) {
      const midi = frequencyToMidi(result.frequency);
      const pc = midiToPitchClass(midi);
      onPitchRef.current({
        pitchClass: pc,
        frequency: result.frequency,
        rms: result.rms,
        clarity: result.probability,
      });
    }
  }, []);

  const handleAudioStream = useCallback(
    async (event: AudioDataEvent) => {
      if (!activeRef.current) return;
      const data = event.data;
      if (!(data instanceof Float32Array)) return; // streamFormat:'float32' ensures Float32Array

      // Append new samples to accumulator.
      const prev = accumRef.current;
      const merged = new Float32Array(prev.length + data.length);
      merged.set(prev, 0);
      merged.set(data, prev.length);

      // Process as many full YIN frames as we have.
      let offset = 0;
      const sr = event.sampleRate || SAMPLE_RATE;
      while (merged.length - offset >= FRAME_SIZE) {
        const frame = merged.subarray(offset, offset + FRAME_SIZE);
        runYinOnFrame(frame, sr);
        // Advance by half the frame for 50% overlap → smoother, faster updates.
        offset += FRAME_SIZE / 2;
      }

      // Keep the leftover tail for next chunk.
      accumRef.current = merged.slice(offset);
    },
    [runYinOnFrame]
  );

  const start = useCallback(
    async (onPitch: PitchCallback, onError: ErrorCallback): Promise<boolean> => {
      onPitchRef.current = onPitch;
      onErrorRef.current = onError;
      accumRef.current = new Float32Array(0);

      // Permission flow.
      const perm = await ensureMicPermission();
      if (perm === 'blocked') {
        onError(
          'Permita o acesso ao microfone nas configurações do aparelho para detectar o tom.',
          'permission_blocked'
        );
        return false;
      }
      if (perm === 'denied') {
        onError('Permita o acesso ao microfone para detectar o tom.', 'permission_denied');
        return false;
      }

      try {
        activeRef.current = true;
        await recorder.startRecording({
          sampleRate: SAMPLE_RATE,
          channels: 1,
          encoding: 'pcm_32bit',
          streamFormat: 'float32',
          interval: STREAM_INTERVAL_MS,
          // Avoid DSP that alters the pitch.
          android: {
            audioSource: 'unprocessed',
          } as any,
          ios: {
            audioSession: {
              category: 'PlayAndRecord',
              mode: 'measurement',
            },
          } as any,
          onAudioStream: handleAudioStream,
        } as any);
        return true;
      } catch (err: any) {
        activeRef.current = false;
        const msg = String(err?.message || err || '');
        let reason: PitchErrorReason = 'unknown';
        if (/permission|denied|NotAllowed/i.test(msg)) reason = 'permission_denied';
        else if (/not.*support|native module|unavailable|TurboModule/i.test(msg)) {
          reason = 'platform_limit';
          if (Platform.OS !== 'web') {
            softInfoRef.current?.(
              'Este recurso requer o aplicativo instalado (APK). No Expo Go a captação nativa não está disponível.'
            );
          }
        }
        onError('Não foi possível iniciar o microfone: ' + msg, reason);
        return false;
      }
    },
    [recorder, handleAudioStream]
  );

  const stop = useCallback(async () => {
    activeRef.current = false;
    try {
      await recorder.stopRecording();
    } catch {
      /* already stopped */
    }
    accumRef.current = new Float32Array(0);
  }, [recorder]);

  const setSoftInfoHandler = useCallback((handler: (msg: string) => void) => {
    softInfoRef.current = handler;
  }, []);

  return {
    isSupported: true,
    start,
    stop,
    setSoftInfoHandler,
  };
}
