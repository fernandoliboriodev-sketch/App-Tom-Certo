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
  hasSavedToken: boolean;
  activate: (code?: string) => Promise<{ ok: boolean; reason?: string }>;
  logout: () => Promise<void>;
  forgetDevice: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'tc_session_v1';
const TOKEN_KEY = 'tc_token_v1'; // armazena o código do token pra revalidação com 1 toque

// URL de produção: fallback final caso env var não esteja disponível no APK
const PROD_BACKEND_URL = 'https://tom-certo.preview.emergentagent.com';

function getBackendUrl(): string {
  const url =
    (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
    (Constants.expoConfig?.extra as any)?.backendUrl ||
    PROD_BACKEND_URL;
  return (url || '').replace(/\/+$/g, '');
}

function reasonToMessage(reason?: string | null): string {
  switch (reason) {
    case 'not_found':
      return 'Token inválido. Verifique e tente novamente.';
    case 'revoked':
      return 'Token revogado. Entre em contato com o suporte.';
    case 'expired':
      return 'Token expirado. Solicite um novo acesso.';
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
  // ── Arranca em 'unauthenticated' para EVITAR tela de loading antes do login ──
  // A revalidação acontece em background e só vira 'authenticated' se houver sessão válida.
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSavedToken, setHasSavedToken] = useState<boolean>(false);
  const boot = useRef(false);

  const loadAndRevalidate = async () => {
    try {
      // Verifica se há token salvo (pra UI decidir se mostra input ou só botão)
      const savedToken = await storage.getItem(TOKEN_KEY);
      setHasSavedToken(!!savedToken);

      const raw = await storage.getItem(SESSION_KEY);
      if (!raw) return;

      // Tem sessão salva → revalida em background
      const parsed: SessionInfo = JSON.parse(raw);
      const deviceId = await getDeviceId();
      const base = getBackendUrl();

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
        // Permanece em 'unauthenticated' — ActivationScreen já está visível
        if (data?.reason) {
          setErrorMessage(reasonToMessage(data.reason));
        }
      }
    } catch (err) {
      // Erro de rede na revalidação: mantém 'unauthenticated' silenciosamente
      // (Se a internet voltar, próxima abertura do app resolve)
      await storage.removeItem(SESSION_KEY);
    }
  };

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    loadAndRevalidate();
  }, []);

  const activate = async (code?: string) => {
    setErrorMessage(null);

    // Se não passou código, tenta usar o token salvo
    let clean: string;
    if (code === undefined || code === null || !code.trim()) {
      const saved = await storage.getItem(TOKEN_KEY);
      if (!saved) {
        setErrorMessage('Digite o código do token');
        return { ok: false, reason: 'empty' };
      }
      clean = saved;
    } else {
      clean = code.trim().toUpperCase();
    }

    const base = getBackendUrl();
    if (!base) {
      setErrorMessage('Não foi possível conectar ao servidor. Tente novamente.');
      return { ok: false, reason: 'no_backend' };
    }

    try {
      const deviceId = await getDeviceId();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`${base}/api/auth/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clean, device_id: deviceId }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.valid) {
        const msg = reasonToMessage(data?.reason);
        setErrorMessage(msg);
        // Se o token salvo é inválido, apaga-o para forçar nova digitação
        if (data?.reason === 'not_found' || data?.reason === 'revoked' || data?.reason === 'expired') {
          await storage.removeItem(TOKEN_KEY);
          setHasSavedToken(false);
        }
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
      // Salva o token para re-ativação fácil
      await storage.setItem(TOKEN_KEY, clean);
      setHasSavedToken(true);
      setSession(s);
      setStatus('authenticated');
      return { ok: true };
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      setErrorMessage(
        isAbort
          ? 'Tempo esgotado. Verifique sua internet e tente novamente.'
          : 'Não foi possível conectar ao servidor. Tente novamente.'
      );
      return { ok: false, reason: isAbort ? 'timeout' : 'network' };
    }
  };

  // ── Logout: encerra sessão visual, MAS mantém token salvo ─────────────
  // Usuário volta pra tela de ativação e pode entrar rapidamente
  const logout = async () => {
    await storage.removeItem(SESSION_KEY);
    setSession(null);
    setErrorMessage(null);
    setStatus('unauthenticated');
    // NÃO apaga o token salvo — próxima ativação é rápida
  };

  // ── ForgetDevice: apaga TUDO (token + sessão) ─────────────────────────
  // Exige nova digitação do token na próxima ativação
  const forgetDevice = async () => {
    await storage.removeItem(SESSION_KEY);
    await storage.removeItem(TOKEN_KEY);
    setSession(null);
    setHasSavedToken(false);
    setErrorMessage(null);
    setStatus('unauthenticated');
  };

  const clearError = () => setErrorMessage(null);

  const value: AuthContextValue = {
    status,
    session,
    errorMessage,
    hasSavedToken,
    activate,
    logout,
    forgetDevice,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
