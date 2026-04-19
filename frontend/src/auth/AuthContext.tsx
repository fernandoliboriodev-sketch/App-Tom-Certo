// Authentication context: handles token activation, persistence and revalidation.
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as storage from './storage';
import { getDeviceId } from './deviceId';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionInfo {
  session: string;
  token_id: string;
  expires_at?: string | null;
  customer_name?: string | null;
  duration_minutes?: number | null;
}

export interface AuthContextValue {
  status: AuthStatus;
  session: SessionInfo | null;
  errorMessage: string | null;
  activate: (code: string) => Promise<{ ok: boolean; reason?: string }>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'tc_session_v1';

function getBackendUrl(): string {
  const url =
    (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    (Constants.expoConfig?.extra as any)?.backendUrl ||
    '';
  return (url || '').replace(/\/+$/g, '');
}

function reasonToMessage(reason?: string | null): string {
  switch (reason) {
    case 'not_found':
      return 'Token inválido. Verifique o código e tente novamente.';
    case 'revoked':
      return 'Este token foi revogado. Entre em contato com o suporte.';
    case 'expired':
      return 'Este token expirou.';
    case 'device_limit':
      return 'Este token já foi usado no limite máximo de dispositivos.';
    case 'session_expired':
    case 'session_invalid':
      return 'Sessão expirada. Digite seu token novamente.';
    case 'device_mismatch':
      return 'Este dispositivo não está autorizado.';
    default:
      return 'Falha ao validar token.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const boot = useRef(false);

  const loadAndRevalidate = async () => {
    try {
      const raw = await storage.getItem(SESSION_KEY);
      if (!raw) {
        setStatus('unauthenticated');
        return;
      }
      const parsed: SessionInfo = JSON.parse(raw);
      const deviceId = await getDeviceId();
      const base = getBackendUrl();
      if (!base) {
        // No backend configured — fail open to unauthenticated
        setStatus('unauthenticated');
        return;
      }

      const res = await fetch(`${base}/api/auth/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: parsed.session,
          device_id: deviceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.valid) {
        setSession({
          ...parsed,
          expires_at: data.expires_at ?? parsed.expires_at,
          customer_name: data.customer_name ?? parsed.customer_name,
          duration_minutes: data.duration_minutes ?? parsed.duration_minutes,
        });
        setStatus('authenticated');
      } else {
        await storage.removeItem(SESSION_KEY);
        setSession(null);
        setStatus('unauthenticated');
        if (data?.reason) {
          setErrorMessage(reasonToMessage(data.reason));
        }
      }
    } catch (err) {
      // Network / offline: keep existing session but go unauthenticated for safety
      await storage.removeItem(SESSION_KEY);
      setStatus('unauthenticated');
    }
  };

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    loadAndRevalidate();
  }, []);

  const activate = async (code: string) => {
    setErrorMessage(null);
    const clean = (code || '').trim().toUpperCase();
    if (!clean) {
      setErrorMessage('Digite o código do token');
      return { ok: false, reason: 'empty' };
    }
    const base = getBackendUrl();
    if (!base) {
      setErrorMessage('Servidor não configurado');
      return { ok: false, reason: 'no_backend' };
    }
    try {
      const deviceId = await getDeviceId();
      const res = await fetch(`${base}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clean, device_id: deviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.valid) {
        const msg = reasonToMessage(data?.reason);
        setErrorMessage(msg);
        return { ok: false, reason: data?.reason };
      }
      const s: SessionInfo = {
        session: data.session,
        token_id: data.token_id,
        expires_at: data.expires_at,
        customer_name: data.customer_name,
        duration_minutes: data.duration_minutes,
      };
      await storage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
      setStatus('authenticated');
      return { ok: true };
    } catch (err: any) {
      setErrorMessage('Erro de conexão. Verifique sua internet.');
      return { ok: false, reason: 'network' };
    }
  };

  const logout = async () => {
    await storage.removeItem(SESSION_KEY);
    setSession(null);
    setErrorMessage(null);
    setStatus('unauthenticated');
  };

  const clearError = () => setErrorMessage(null);

  const value: AuthContextValue = {
    status,
    session,
    errorMessage,
    activate,
    logout,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
