// Stable device id, kept in SecureStore.
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import * as storage from './storage';

const DEVICE_ID_KEY = 'tc_device_id';

function randomId(): string {
  const hex = (n: number) =>
    Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await storage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cached = stored;
    return stored;
  }
  let seed: string | null = null;
  try {
    if (Platform.OS === 'android') {
      seed = await Application.getAndroidId();
    } else if (Platform.OS === 'ios') {
      seed = await Application.getIosIdForVendorAsync();
    }
  } catch { /* ignore */ }
  const id = (seed && seed.length > 0) ? seed : randomId();
  await storage.setItem(DEVICE_ID_KEY, id);
  cached = id;
  return id;
}
