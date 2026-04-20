import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from './AuthContext';

const { height: SH } = Dimensions.get('window');

// ─── Design tokens (OLED premium) ────────────────────────────────────────────
const C = {
  bg:           '#000000',
  amber:        '#FFB020',
  amberLight:   '#FFC543',   // destaque superior do gradiente
  amberDeep:    '#E69A0F',   // sombra inferior do gradiente
  amberSoft:    '#CFA14A',   // secundário (link WhatsApp)
  amberSoftDim: 'rgba(207,161,74,0.5)',
  amberDim:     'rgba(255,176,32,0.35)',
  amberGlow:    'rgba(255,176,32,0.55)',
  white:        '#FFFFFF',
  text2:        '#A0A0A0',
  text3:        '#555555',
  text4:        '#3A3A3A',
  red:          '#EF4444',
};

// ─── Link de solicitação de token ────────────────────────────────────────────
const WHATSAPP_URL =
  'https://wa.me/5563992029322?text=Ol%C3%A1.%20Quero%20Token%20de%20acesso%20do%20aplicativo';

export default function ActivationScreen() {
  const { activate, errorMessage, clearError } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  // ── Animações ────────────────────────────────────────────────────────────
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const logoScale = useRef(new Animated.Value(0.92)).current;
  const logoGlow = useRef(new Animated.Value(0.78)).current;
  const errorShake = useRef(new Animated.Value(0)).current;
  const underlineScale = useRef(new Animated.Value(0.6)).current;
  const ctaScale = useRef(new Animated.Value(1)).current;
  const waLinkScale = useRef(new Animated.Value(1)).current;

  // ── Entrada ──────────────────────────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    // Logo breath glow loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoGlow, {
          toValue: 0.78,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // ── Underline animado ao focar ──────────────────────────────────────────
  useEffect(() => {
    Animated.timing(underlineScale, {
      toValue: focused || code.length > 0 ? 1 : 0.6,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, code]);

  // ── Shake no erro ───────────────────────────────────────────────────────
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

  // ── Botão principal: press feedback ─────────────────────────────────────
  const ctaPressIn = () => {
    Animated.spring(ctaScale, { toValue: 0.96, useNativeDriver: true }).start();
  };
  const ctaPressOut = () => {
    Animated.spring(ctaScale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();
  };

  // ── WhatsApp link ───────────────────────────────────────────────────────
  const waPressIn = () => {
    Animated.spring(waLinkScale, { toValue: 0.97, useNativeDriver: true }).start();
  };
  const waPressOut = () => {
    Animated.spring(waLinkScale, {
      toValue: 1,
      friction: 4,
      useNativeDriver: true,
    }).start();
  };
  const openWhatsApp = async () => {
    try {
      await Linking.openURL(WHATSAPP_URL);
    } catch (e) {
      console.warn('[Activation] Não foi possível abrir WhatsApp:', e);
    }
  };

  const canSubmit = !busy && code.trim().length > 0;

  return (
    <SafeAreaView style={ss.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={ss.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[ss.container, { opacity: fade, transform: [{ translateY: slide }] }]}
          >
            {/* ── Brand block ──────────────────────────────────────────── */}
            <View style={ss.brandBlock}>
              <Animated.Image
                source={require('../../assets/images/logo-full.png')}
                style={[
                  ss.logo,
                  {
                    opacity: logoGlow,
                    transform: [{ scale: logoScale }],
                  },
                ]}
                resizeMode="contain"
              />
              <Text style={ss.tagline}>Detector de tonalidade</Text>
            </View>

            {/* ── Input ────────────────────────────────────────────────── */}
            <Animated.View style={[ss.inputBlock, { transform: [{ translateX: errorShake }] }]}>
              <Text style={ss.inputLabel}>TOKEN DE ACESSO</Text>
              <TextInput
                testID="activation-code-input"
                style={ss.input}
                value={code}
                onChangeText={onChangeCode}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={onSubmit}
                placeholder="Digite seu token de acesso"
                placeholderTextColor={C.text3}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={24}
                returnKeyType="done"
                selectionColor={C.amber}
                underlineColorAndroid="transparent"
              />
              {/* Base underline */}
              <View style={ss.underlineBase} />
              {/* Active underline com glow */}
              <Animated.View
                style={[
                  ss.underlineActive,
                  {
                    transform: [{ scaleX: underlineScale }],
                    opacity: focused || code.length > 0 ? 1 : 0.45,
                  },
                ]}
              />

              {errorMessage ? (
                <View style={ss.errorRow}>
                  <Ionicons name="alert-circle" size={15} color={C.red} />
                  <Text style={ss.errorTxt} numberOfLines={3}>{errorMessage}</Text>
                </View>
              ) : null}
            </Animated.View>

            {/* ── Botão principal ─────────────────────────────────────── */}
            <Animated.View style={{ width: '100%', transform: [{ scale: ctaScale }] }}>
              <TouchableOpacity
                testID="activate-btn"
                activeOpacity={0.92}
                onPress={onSubmit}
                onPressIn={ctaPressIn}
                onPressOut={ctaPressOut}
                disabled={!canSubmit}
                style={ss.primaryBtnWrap}
              >
                <LinearGradient
                  colors={
                    canSubmit
                      ? [C.amberLight, C.amber, C.amberDeep]
                      : ['rgba(255,176,32,0.35)', 'rgba(255,176,32,0.22)', 'rgba(255,176,32,0.15)']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={[ss.primaryBtn, !canSubmit && ss.primaryBtnDisabled]}
                >
                  {busy ? (
                    <ActivityIndicator color={C.bg} size="small" />
                  ) : (
                    <Text style={ss.primaryBtnTxt}>Ativar acesso</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            {/* ── Link WhatsApp ──────────────────────────────────────── */}
            <Animated.View style={{ transform: [{ scale: waLinkScale }], marginTop: 22 }}>
              <TouchableOpacity
                testID="request-token-btn"
                onPress={openWhatsApp}
                onPressIn={waPressIn}
                onPressOut={waPressOut}
                activeOpacity={0.75}
                style={ss.waLink}
              >
                <Text style={ss.waLinkTxt}>
                  Não tem token de acesso?{'\n'}
                  <Text style={ss.waLinkTxtStrong}>Solicitar token de acesso</Text>
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* ── Mensagem de confiança ──────────────────────────────── */}
            <View style={ss.trust}>
              <Ionicons name="shield-checkmark-outline" size={12} color={C.text3} />
              <Text style={ss.trustTxt}>
                Seu acesso é seguro e validado instantaneamente
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
const ss = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  splash: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashTxt: {
    fontSize: 28,
    fontFamily: 'Outfit_800ExtraBold',
    color: C.amber,
    letterSpacing: -0.5,
  },

  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  container: {
    paddingHorizontal: 32,
    alignItems: 'center',
  },

  // ── Brand ──────────────────────────────────────────────────────────────
  brandBlock: {
    alignItems: 'center',
    marginBottom: SH * 0.06,
  },
  logo: {
    width: 210,
    height: 210,
    marginBottom: 4,
  },
  tagline: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.text3,
    letterSpacing: 3.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },

  // ── Input minimalista ────────────────────────────────────────────────
  inputBlock: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
  },
  inputLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.amber,
    letterSpacing: 3,
    marginBottom: 14,
  },
  input: {
    width: '100%',
    fontFamily: 'Outfit_700Bold',
    fontSize: 20,
    color: C.white,
    letterSpacing: 2.5,
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    // @ts-ignore – web-only, ignored on native
    ...Platform.select({ web: { outlineWidth: 0 } as any, default: {} }),
  },
  underlineBase: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  underlineActive: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: C.amber,
    ...Platform.select({
      ios: {
        shadowColor: C.amber,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 8,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  errorTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.red,
    lineHeight: 16,
  },

  // ── Botão principal com gradiente ────────────────────────────────────
  primaryBtnWrap: {
    width: '100%',
    borderRadius: 99,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: C.amber,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.5,
        shadowRadius: 22,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  primaryBtn: {
    width: '100%',
    height: 58,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    ...Platform.select({
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
      default: {},
    }),
  },
  primaryBtnTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 16.5,
    color: C.bg,
    letterSpacing: 0.6,
  },

  // ── Link WhatsApp ───────────────────────────────────────────────────
  waLink: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  waLinkTxt: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: C.text2,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  waLinkTxtStrong: {
    fontFamily: 'Manrope_600SemiBold',
    color: C.amberSoft,
    textDecorationLine: 'underline',
    textDecorationColor: C.amberSoftDim,
  },

  // ── Mensagem de confiança ───────────────────────────────────────────
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 28,
    paddingHorizontal: 8,
  },
  trustTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11.5,
    color: C.text3,
    letterSpacing: 0.3,
  },
});
