import React, { useEffect } from 'react';
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

// Esconde splash nativo IMEDIATAMENTE — app vai direto pra tela de login.
SplashScreen.hideAsync().catch(() => {});

// ── OTA em BACKGROUND, 100% silencioso, SEM bloquear UI, SEM reload ──
// Expo padrão já baixa em background; aqui só reforçamos se alguma lib
// estiver configurada diferente. NUNCA chamar reloadAsync aqui.
function kickBackgroundOtaCheck() {
  (async () => {
    try {
      if (!Updates.isEnabled) return;
      // @ts-ignore
      if (typeof __DEV__ !== 'undefined' && __DEV__) return;
      const res = await Updates.checkForUpdateAsync();
      if (res?.isAvailable) {
        // Só baixa. Será aplicado NA PRÓXIMA abertura do app.
        await Updates.fetchUpdateAsync();
      }
    } catch {
      /* silencioso — ignora falhas de rede */
    }
  })();
}

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

  useEffect(() => {
    // Garante splash escondido
    SplashScreen.hideAsync().catch(() => {});
    // Dispara checagem de OTA em segundo plano após 1s (não bloqueia)
    const t = setTimeout(kickBackgroundOtaCheck, 1000);
    return () => clearTimeout(t);
  }, []);

  // Enquanto fontes NÃO carregaram: só um fundo preto (SEM logo, SEM texto,
  // SEM loading screen). Frações de segundo — quase imperceptível.
  if (!fontsLoaded && !fontError) {
    return <View style={ss.bgBlack} />;
  }

  // App normal — vai DIRETO pra ActivationScreen ou conteúdo autenticado
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#000000" />
      <View style={ss.bgBlack} />
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
