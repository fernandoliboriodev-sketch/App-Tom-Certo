import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useFonts,
  Outfit_800ExtraBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import { useAuth } from './AuthContext';

const { width: SW } = Dimensions.get('window');

const C = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceHigh: '#1C1C1C',
  amber: '#FFB020',
  amberSoft: '#E6A010',
  amberMuted: 'rgba(255,176,32,0.10)',
  amberBorder: 'rgba(255,176,32,0.35)',
  white: '#FFFFFF',
  text2: '#A1A1AA',
  text3: '#52525B',
  border: '#1F1F1F',
  red: '#EF4444',
  redMuted: 'rgba(239,68,68,0.12)',
  redBorder: 'rgba(239,68,68,0.35)',
};

export default function ActivationScreen() {
  const [fontsLoaded] = useFonts({
    Outfit_800ExtraBold,
    Outfit_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });

  const { activate, errorMessage, clearError } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(22)).current;
  const ringPulse = useRef(new Animated.Value(1)).current;
  const errorShake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1.15,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (errorMessage) {
      Animated.sequence([
        Animated.timing(errorShake, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 6, duration: 50, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: -6, duration: 50, useNativeDriver: true }),
        Animated.timing(errorShake, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [errorMessage]);

  const onChangeCode = (t: string) => {
    if (errorMessage) clearError();
    setCode(t.toUpperCase().replace(/\s+/g, ''));
  };

  const onSubmit = async () => {
    if (busy || !code.trim()) return;
    Keyboard.dismiss();
    setBusy(true);
    await activate(code);
    setBusy(false);
  };

  if (!fontsLoaded) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <Text style={styles.splashText}>Tom Certo</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.container,
              { opacity: fade, transform: [{ translateY: slide }] },
            ]}
          >
            {/* Brand (logo + name, logo always above name) */}
            <View style={styles.brandArea}>
              <Animated.View
                style={[styles.ringOuter, { transform: [{ scale: ringPulse }] }]}
              />
              <View style={styles.ringMid} />
              <View style={styles.logoCircle}>
                <Image
                  source={require('../../assets/images/app-logo.png')}
                  style={styles.logoImg}
                  resizeMode="contain"
                />
              </View>
            </View>
            <Text style={styles.appName}>Tom Certo</Text>
            <Text style={styles.appTagline}>Detector de tonalidade</Text>

            {/* Headline */}
            <View style={styles.headlineArea}>
              <Text style={styles.headline}>Ativação de acesso</Text>
              <Text style={styles.sub}>
                Digite o código que você recebeu para liberar o app.
              </Text>
            </View>

            {/* Input card */}
            <Animated.View
              style={[
                styles.inputCard,
                { transform: [{ translateX: errorShake }] },
              ]}
            >
              <Text style={styles.inputLabel}>TOKEN DE ACESSO</Text>
              <TextInput
                testID="activation-token-input"
                value={code}
                onChangeText={onChangeCode}
                placeholder="XXXXX-XXXXXX"
                placeholderTextColor={C.text3}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                style={styles.input}
                onSubmitEditing={onSubmit}
                editable={!busy}
                maxLength={32}
              />
              {errorMessage ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={14} color={C.red} />
                  <Text style={styles.errorTxt}>{errorMessage}</Text>
                </View>
              ) : null}
            </Animated.View>

            {/* Activate button */}
            <TouchableOpacity
              testID="activation-submit-button"
              style={[styles.primaryBtn, (busy || !code) && styles.primaryBtnDisabled]}
              onPress={onSubmit}
              activeOpacity={0.85}
              disabled={busy || !code.trim()}
            >
              {busy ? (
                <ActivityIndicator size="small" color={C.bg} />
              ) : (
                <>
                  <Ionicons name="key" size={18} color={C.bg} />
                  <Text style={styles.primaryBtnTxt}>Ativar acesso</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.footer}>
              <Ionicons name="shield-checkmark" size={12} color={C.text3} />
              <Text style={styles.footerTxt}>
                Seu acesso fica salvo no dispositivo — você não precisará digitar
                novamente.
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  splash: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: { fontSize: 28, fontWeight: '800', color: C.amber },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  container: {
    paddingHorizontal: 28,
    alignItems: 'center',
    gap: 0,
  },

  brandArea: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  ringOuter: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: C.amberBorder,
    opacity: 0.3,
  },
  ringMid: {
    position: 'absolute',
    width: 125,
    height: 125,
    borderRadius: 62,
    borderWidth: 1,
    borderColor: C.amberBorder,
    opacity: 0.5,
  },
  logoCircle: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: 96, height: 96 },

  appName: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 30,
    color: C.white,
    letterSpacing: -0.8,
    marginTop: 6,
  },
  appTagline: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  headlineArea: { alignItems: 'center', marginTop: 28, marginBottom: 16, paddingHorizontal: 8 },
  headline: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 22,
    color: C.white,
    letterSpacing: -0.4,
  },
  sub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    maxWidth: SW - 80,
  },

  inputCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  inputLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.amber,
    letterSpacing: 2.4,
    marginBottom: 8,
  },
  input: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 22,
    color: C.white,
    letterSpacing: 3,
    paddingVertical: 10,
    paddingHorizontal: 4,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.redMuted,
    borderWidth: 1,
    borderColor: C.redBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  errorTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.red,
    lineHeight: 16,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    height: 56,
    borderRadius: 99,
    backgroundColor: C.amber,
    ...Platform.select({
      ios: {
        shadowColor: C.amber,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
    color: C.bg,
    letterSpacing: 0.3,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 12,
  },
  footerTxt: {
    flex: 1,
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: C.text3,
    lineHeight: 16,
    textAlign: 'left',
  },
});
