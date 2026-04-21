import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, SplashScreen } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import {
  useFonts,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';
import ActivationScreen from '../src/auth/ActivationScreen';
import LoadingScreen from '../src/components/LoadingScreen';

// Esconde splash nativo IMEDIATAMENTE — o LoadingScreen JS assume a partir daí.
SplashScreen.hideAsync().catch(() => {});

// ── Tempos ────────────────────────────────────────────────────────
const MIN_LOADING_MS = 900;          // tempo mínimo de exibição do LoadingScreen
const FADE_OUT_MS = 280;             // fade-out do loading
const UPDATE_CHECK_TIMEOUT_MS = 3500;// aborta check de update se demorar demais
const UPDATE_TEXT_DELAY_MS = 800;    // só mostra "Verificando atualizações..." após 800ms

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status !== 'authenticated') return <ActivationScreen />;
  return <>{children}</>;
}

// ── Check de OTA com timeout agressivo ──────────────────────────
// Se há update → baixa e reload IMEDIATO (não espera próxima abertura)
// Se não há / timeout → segue com bundle em cache
async function checkAndApplyUpdate(): Promise<boolean> {
  try {
    if (!Updates.isEnabled) return false;
    // @ts-ignore __DEV__ existe em RN global
    if (typeof __DEV__ !== 'undefined' && __DEV__) return false;

    const checkPromise = Updates.checkForUpdateAsync();
    const timeoutPromise = new Promise<null>((_, rej) =>
      setTimeout(() => rej(new Error('update-timeout')), UPDATE_CHECK_TIMEOUT_MS)
    );
    const res: any = await Promise.race([checkPromise, timeoutPromise]);

    if (res?.isAvailable) {
      // Baixa novo bundle (com o resto do timeout)
      await Updates.fetchUpdateAsync();
      // Reload já aplica — retorna true só pra caller saber
      await Updates.reloadAsync();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });

  // Controla quando o LoadingScreen começa a esvanecer e quando some
  const [fadingOut, setFadingOut] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  const [showUpdateHint, setShowUpdateHint] = useState(false);

  const bootedRef = useRef(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});

    if (bootedRef.current) return;
    bootedRef.current = true;

    const startAt = Date.now();

    // ── Dispara checagem de OTA em paralelo com fonts ──
    // Se encontrar update, aplica ANTES de revelar UI
    const updatePromise = checkAndApplyUpdate();

    // Mostra dica "Verificando atualizações…" se a checagem tiver demorado > 800ms
    const hintTimer = setTimeout(() => setShowUpdateHint(true), UPDATE_TEXT_DELAY_MS);

    (async () => {
      // Se a checagem encontrou update, o reload acontece e esse código nem
      // chega ao fim. Se não, continua.
      await updatePromise;
      clearTimeout(hintTimer);
      setShowUpdateHint(false);

      // Aguarda fontes
      const waitFonts = async () => {
        const check = () => !!(fontsLoaded || fontError);
        if (check()) return;
        await new Promise<void>((resolve) => {
          const t = setInterval(() => {
            if (check()) { clearInterval(t); resolve(); }
          }, 80);
        });
      };
      await waitFonts();

      // Garante tempo mínimo de loading
      const elapsed = Date.now() - startAt;
      const wait = Math.max(0, MIN_LOADING_MS - elapsed);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      // Fade-out e remove
      setFadingOut(true);
      setTimeout(() => setLoaderGone(true), FADE_OUT_MS + 40);
    })();

    return () => clearTimeout(hintTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showShellContent = fontsLoaded || fontError;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#000000" />
      <View style={ss.bgBlack} />

      {showShellContent ? (
        <AuthProvider>
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'none',
                contentStyle: { backgroundColor: '#000000' },
              }}
            />
          </AuthGate>
        </AuthProvider>
      ) : null}

      {!loaderGone ? (
        <LoadingScreen fadingOut={fadingOut} hint={showUpdateHint ? 'Verificando atualizações…' : null} />
      ) : null}
    </SafeAreaProvider>
  );
}

const ss = StyleSheet.create({
  bgBlack: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000',
    zIndex: -1,
  },
});
