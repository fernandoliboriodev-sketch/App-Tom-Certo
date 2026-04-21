import React, { useEffect } from 'react';
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

// Esconde splash nativo IMEDIATAMENTE — app abre direto na tela de login.
// As fontes carregam em background; até terminarem, usa fontes de sistema
// (React Native faz fallback automático).
SplashScreen.hideAsync().catch(() => {});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  // Sem tela de loading intermediária: direto para login se não autenticado
  if (status !== 'authenticated') return <ActivationScreen />;
  return <>{children}</>;
}

export default function RootLayout() {
  // ── Carregamento de fontes em background ── (não bloqueia a renderização)
  const [fontsLoaded, fontError] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });

  useEffect(() => {
    // Garante que o splash está escondido (redundância)
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Enquanto fontes NÃO carregaram: render View preto (sem logo, sem texto)
  // para evitar flash de fontes do sistema feias no primeiro frame.
  if (!fontsLoaded && !fontError) {
    return <View style={ss.fallback} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#000000" />
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
  fallback: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
