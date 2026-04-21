/**
 * LoadingScreen — tela premium exibida brevemente após a splash nativa
 * sumir, enquanto o app inicializa (fontes, auth context, etc).
 *
 * Design:
 *  - Fundo OLED preto puro
 *  - Logo centralizada com fade-in + leve pulse
 *  - Anel de progresso discreto girando ao redor (âmbar)
 *  - Transição suave pra próxima tela (fade-out controlado pelo pai)
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  Image,
  Dimensions,
  Platform,
} from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

const C = {
  bg: '#000000',
  amber: '#FFB020',
  amberGlow: 'rgba(255,176,32,0.32)',
  amberDim: 'rgba(255,176,32,0.18)',
};

export default function LoadingScreen({
  fadingOut = false,
  hint = null,
}: {
  fadingOut?: boolean;
  hint?: string | null;
}) {
  // Fade-in geral da tela
  const fade = useRef(new Animated.Value(0)).current;
  // Pulse sutil da logo (opacidade + escala)
  const logoScale = useRef(new Animated.Value(0.96)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  // Rotação do anel de progresso
  const spin = useRef(new Animated.Value(0)).current;
  // Breath do ring (opacidade pulsante)
  const ringPulse = useRef(new Animated.Value(0.5)).current;
  // Fade-out controlado externamente
  const outFade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entrada: fade + logo sobe
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 36,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse infinito e sutil da logo (±2%)
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.03,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // Rotação contínua do anel
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    // Breath do ring (opacidade)
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 0.5,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // Delay pequeno no pulse pra começar depois da entrada
    const pulseTimer = setTimeout(() => pulseLoop.start(), 520);
    spinLoop.start();
    breathLoop.start();

    return () => {
      clearTimeout(pulseTimer);
      pulseLoop.stop();
      spinLoop.stop();
      breathLoop.stop();
    };
  }, [fade, logoOpacity, logoScale, ringPulse, spin]);

  // Fade-out quando o pai sinaliza
  useEffect(() => {
    if (fadingOut) {
      Animated.timing(outFade, {
        toValue: 0,
        duration: 280,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [fadingOut, outFade]);

  const spinRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Tamanho da logo: ~42% da largura da tela, cap em 220px — elegante
  const LOGO_SIZE = Math.min(220, Math.max(150, SW * 0.42));
  const RING_SIZE = LOGO_SIZE + 44;

  return (
    <Animated.View style={[ss.root, { opacity: Animated.multiply(fade, outFade) }]}>
      {/* Centraliza absolutamente no meio vertical (ligeiramente acima — mais elegante) */}
      <View style={ss.center}>
        {/* Anel de progresso ao redor da logo */}
        <Animated.View
          style={[
            ss.ring,
            {
              width: RING_SIZE,
              height: RING_SIZE,
              borderRadius: RING_SIZE / 2,
              opacity: ringPulse,
              transform: [{ rotate: spinRotate }],
            },
          ]}
        />
        {/* Logo */}
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <Image
            source={require('../../assets/images/splash-js-logo.png')}
            style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
            resizeMode="contain"
          />
        </Animated.View>
      </View>

      {/* Hint discreto — só aparece se checagem de update estiver demorando */}
      {hint ? (
        <Animated.View style={[ss.hintBox, { opacity: logoOpacity }]}>
          <Animated.Text style={[ss.hintTxt, { opacity: ringPulse }]}>
            {hint}
          </Animated.Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const ss = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    // Sobe levemente pra ficar no "terço áureo" visual
    marginBottom: SH * 0.04,
    position: 'relative',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: C.amberDim,
    borderTopColor: C.amber,
    borderRightColor: C.amberGlow,
    ...Platform.select({
      ios: {
        shadowColor: C.amber,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  hintBox: {
    position: 'absolute',
    bottom: SH * 0.12,
    alignItems: 'center',
  },
  hintTxt: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
