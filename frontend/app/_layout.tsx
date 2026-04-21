import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, SplashScreen } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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

// ── Tempo MÍNIMO que o LoadingScreen fica visível ───────────────────
// Suficiente pra UX premium, curto o bastante pra não frustrar.
const MIN_LOADING_MS = 900;
// Tempo da animação de fade-out do loading
const FADE_OUT_MS = 280;

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status !== 'authenticated') return <ActivationScreen />;
  return <>{children}</>;
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

  useEffect(() => {
    // Garante splash nativo escondido
    SplashScreen.hideAsync().catch(() => {});

    const startAt = Date.now();
    const readyCheck = () => {
      const fontsReady = !!(fontsLoaded || fontError);
      const elapsed = Date.now() - startAt;
      const wait = Math.max(0, MIN_LOADING_MS - elapsed);

      if (!fontsReady) {
        // Re-agenda checagem em 80ms até fontes prontas
        setTimeout(readyCheck, 80);
        return;
      }
      // Fontes prontas + tempo mínimo passado → inicia fade-out
      setTimeout(() => {
        setFadingOut(true);
        setTimeout(() => setLoaderGone(true), FADE_OUT_MS + 40);
      }, wait);
    };
    readyCheck();
  }, [fontsLoaded, fontError]);

  const showShellContent = fontsLoaded || fontError;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#000000" />
      {/* Fundo preto permanente — evita qualquer flash branco */}
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

      {/* LoadingScreen por cima de tudo até o loaderGone */}
      {!loaderGone ? <LoadingScreen fadingOut={fadingOut} /> : null}
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
