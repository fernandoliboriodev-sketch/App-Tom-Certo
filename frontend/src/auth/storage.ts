// Cross-platform secure storage wrapper.
// Native: expo-secure-store (Keychain / Keystore)
// Web: window.localStorage (preview only)
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem(key, value); } catch { /* */ }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  return await SecureStore.getItemAsync(key);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try { window.localStorage.removeItem(key); } catch { /* */ }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
