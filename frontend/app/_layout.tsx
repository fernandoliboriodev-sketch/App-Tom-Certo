import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
import AuthLoadingScreen from '../src/auth/AuthLoadingScreen';

// Manter splash nativo enquanto fontes carregam — UX mais rápida
SplashScreen.preventAutoHideAsync().catch(() => {});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <AuthLoadingScreen />;
  if (status === 'unauthenticated') return <ActivationScreen />;
  return <>{children}</>;
}

export default function RootLayout() {
  // ── Font loading CENTRALIZADO: 1 única vez para todo o app ──
  const [fontsLoaded, fontError] = useFonts({
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Enquanto fontes carregam: splash nativo continua visível (mais rápido que render JS)
  if (!fontsLoaded && !fontError) {
    return (
      <View style={ss.fallback}>
        <Text style={ss.fallbackTxt}>Tom Certo</Text>
      </View>
    );
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackTxt: {
    fontSize: 22,
    color: '#FFB020',
    letterSpacing: -0.5,
    fontWeight: '700',
  },
});
