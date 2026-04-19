import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Dimensions,
  Easing,
  Platform,
  Image,
  Modal,
  Linking,
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

import { useKeyDetection } from '../src/hooks/useKeyDetection';
import {
  NOTES_BR,
  NOTES_INTL,
  formatKeyDisplay,
  getHarmonicField,
} from '../src/utils/noteUtils';
import { useAuth } from '../src/auth/AuthContext';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Design Tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceHigh: '#1C1C1C',
  amber: '#FFB020',
  amberSoft: '#E6A010',
  amberMuted: 'rgba(255,176,32,0.10)',
  amberBorder: 'rgba(255,176,32,0.35)',
  amberGlow: 'rgba(255,176,32,0.30)',
  white: '#FFFFFF',
  text2: '#A1A1AA',
  text3: '#52525B',
  border: '#1F1F1F',
  borderMid: '#2A2A2A',
  red: '#EF4444',
  redMuted: 'rgba(239,68,68,0.10)',
  redBorder: 'rgba(239,68,68,0.35)',
  green: '#22C55E',
};

export default function HomeScreen() {
  const [fontsLoaded] = useFonts({
    Outfit_800ExtraBold,
    Outfit_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
  });

  const {
    currentKey,
    currentNote,
    recentNotes,
    isStable,
    statusMessage,
    isRunning,
    errorMessage,
    errorReason,
    softInfo,
    start,
    stop,
    reset,
  } = useKeyDetection();

  const screen: 'initial' | 'listening' | 'detected' = currentKey
    ? 'detected'
    : isRunning
    ? 'listening'
    : 'initial';

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

      {screen === 'initial' && (
        <InitialScreen
          onStart={start}
          errorMessage={errorMessage}
          errorReason={errorReason}
        />
      )}

      {screen === 'listening' && (
        <ListeningScreen
          onStop={stop}
          statusMessage={statusMessage}
          currentNote={currentNote}
          recentNotes={recentNotes}
          softInfo={softInfo}
        />
      )}

      {screen === 'detected' && (
        <DetectedScreen
          currentKey={currentKey!}
          currentNote={currentNote}
          recentNotes={recentNotes}
          isStable={isStable}
          isRunning={isRunning}
          statusMessage={statusMessage}
          onStop={stop}
          onReset={reset}
          onResume={start}
        />
      )}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCREEN 1: Initial
// ═════════════════════════════════════════════════════════════════════════════
function InitialScreen({
  onStart,
  errorMessage,
  errorReason,
}: {
  onStart: () => void;
  errorMessage: string | null;
  errorReason: 'permission_denied' | 'permission_blocked' | 'platform_limit' | 'unknown' | null;
}) {
  const { logout, session } = useAuth();
  const [modalVisible, setModalVisible] = React.useState(false);
  const prevErr = useRef<string | null>(null);

  React.useEffect(() => {
    if (errorMessage && errorMessage !== prevErr.current) {
      setModalVisible(true);
    }
    prevErr.current = errorMessage;
  }, [errorMessage]);
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const ringPulse = useRef(new Animated.Value(1)).current;
  const micScale = useRef(new Animated.Value(1)).current;
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;

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

    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1.18,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    ringLoop.start();

    const micLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(micScale, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(micScale, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    micLoop.start();

    const makeWave = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const w1 = makeWave(wave1, 0);
    const w2 = makeWave(wave2, 800);
    const w3 = makeWave(wave3, 1600);
    w1.start(); w2.start(); w3.start();

    return () => {
      ringLoop.stop();
      micLoop.stop();
      w1.stop(); w2.stop(); w3.stop();
    };
  }, []);

  const renderWave = (val: Animated.Value) => (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.initialWave,
        {
          opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [
            { scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) },
          ],
        },
      ]}
    />
  );

  return (
    <Animated.View
      style={[
        styles.initialContainer,
        { opacity: fade, transform: [{ translateY: slide }] },
      ]}
    >
      <View style={styles.initialHeader}>
        <Image
          source={require('../assets/images/app-logo.png')}
          style={styles.brandLogoLarge}
          resizeMode="contain"
        />
        <Text style={styles.initialAppName}>Tom Certo</Text>
        <Text style={styles.initialTagline}>Detector de tonalidade</Text>
      </View>

      <View style={styles.initialLogoArea}>
        {renderWave(wave3)}
        {renderWave(wave2)}
        {renderWave(wave1)}
        <Animated.View
          style={[styles.ringOuter, { transform: [{ scale: ringPulse }] }]}
        />
        <View style={styles.ringMid} />
        <Animated.View
          style={[
            styles.micCircleSimple,
            { transform: [{ scale: micScale }] },
          ]}
        >
          <Ionicons name="mic" size={60} color={C.amber} />
        </Animated.View>
      </View>

      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Pronto para ouvir</Text>
        <Text style={styles.instructionsBody}>
          Toque no botão abaixo e comece a cantar ou tocar seu instrumento.
          Vamos identificar o tom automaticamente.
        </Text>
      </View>

      {errorMessage && !modalVisible ? (
        <TouchableOpacity
          style={styles.softNotice}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="information-circle" size={14} color={C.amber} />
          <Text style={styles.softNoticeTxt}>Toque para detalhes</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.initialBtnArea}>
        <TouchableOpacity
          testID="start-detection-button"
          style={styles.primaryBtn}
          onPress={onStart}
          activeOpacity={0.8}
        >
          <Ionicons name="play" size={20} color={C.bg} />
          <Text style={styles.primaryBtnTxt}>Iniciar Detecção</Text>
        </TouchableOpacity>
        <Text style={styles.hintBelowBtn}>Precisamos acessar seu microfone</Text>

        <TouchableOpacity
          testID="logout-button"
          onPress={logout}
          activeOpacity={0.6}
          style={styles.logoutBtn}
        >
          <Ionicons name="log-out-outline" size={13} color={C.text3} />
          <Text style={styles.logoutTxt}>
            Sair{session?.customer_name ? ` · ${session.customer_name}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <MicNoticeModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onRetry={() => { setModalVisible(false); onStart(); }}
        reason={errorReason}
        message={errorMessage}
      />
    </Animated.View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCREEN 2: Listening
// ═════════════════════════════════════════════════════════════════════════════
function ListeningScreen({
  onStop,
  statusMessage,
  currentNote,
  recentNotes,
  softInfo,
}: {
  onStop: () => void;
  statusMessage: string;
  currentNote: number | null;
  recentNotes: number[];
  softInfo: string | null;
}) {
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const micPulse = useRef(new Animated.Value(1)).current;
  const noteOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makePulse = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const a1 = makePulse(pulse1, 0);
    const a2 = makePulse(pulse2, 600);
    const a3 = makePulse(pulse3, 1200);
    a1.start(); a2.start(); a3.start();

    const micLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(micPulse, { toValue: 1.08, duration: 750, useNativeDriver: true }),
        Animated.timing(micPulse, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    micLoop.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); micLoop.stop(); };
  }, []);

  useEffect(() => {
    Animated.timing(noteOpacity, {
      toValue: currentNote !== null ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [currentNote]);

  const renderRing = (val: Animated.Value) => (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.listeningRing,
        {
          opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [
            { scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) },
          ],
        },
      ]}
    />
  );

  return (
    <View style={styles.listeningContainer}>
      <View style={styles.listeningTop}>
        <Text style={styles.listeningLabel}>
          {statusMessage.includes('Ouvindo')
            ? 'OUVINDO'
            : statusMessage.includes('Confirmando')
            ? 'CONFIRMANDO'
            : statusMessage.includes('Refinando')
            ? 'REFINANDO'
            : 'ANALISANDO'}
        </Text>
        <Text style={styles.listeningStatus}>{statusMessage}</Text>
      </View>

      <View style={styles.listeningCenter}>
        <View style={styles.listeningRingsWrap}>
          {renderRing(pulse3)}
          {renderRing(pulse2)}
          {renderRing(pulse1)}
          <Animated.View
            style={[styles.listeningMic, { transform: [{ scale: micPulse }] }]}
          >
            <Ionicons name="mic" size={56} color={C.amber} />
          </Animated.View>
        </View>

        <Animated.View style={[styles.liveNoteBox, { opacity: noteOpacity }]}>
          <Text style={styles.liveNoteLabel}>NOTA AGORA</Text>
          <Text style={styles.liveNoteBr}>
            {currentNote !== null ? NOTES_BR[currentNote] : '—'}
          </Text>
          <Text style={styles.liveNoteIntl}>
            {currentNote !== null ? `(${NOTES_INTL[currentNote]})` : ''}
          </Text>
        </Animated.View>
      </View>

      <View style={styles.listeningBottom}>
        {softInfo ? (
          <View style={styles.softInfoBar}>
            <Ionicons name="sparkles" size={13} color={C.amber} />
            <Text style={styles.softInfoTxt}>{softInfo}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          testID="stop-detection-button"
          style={styles.stopBtn}
          onPress={onStop}
          activeOpacity={0.75}
        >
          <Ionicons name="stop" size={16} color={C.red} />
          <Text style={styles.stopBtnTxt}>Parar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCREEN 3: Detected
// ═════════════════════════════════════════════════════════════════════════════
function DetectedScreen({
  currentKey,
  currentNote,
  recentNotes,
  isStable,
  isRunning,
  statusMessage,
  onStop,
  onReset,
  onResume,
}: {
  currentKey: NonNullable<ReturnType<typeof useKeyDetection>['currentKey']>;
  currentNote: number | null;
  recentNotes: number[];
  isStable: boolean;
  isRunning: boolean;
  statusMessage: string;
  onStop: () => void;
  onReset: () => void;
  onResume: () => void;
}) {
  const keyDisplay = formatKeyDisplay(currentKey.root, currentKey.quality);
  const harmonicField = useMemo(
    () => getHarmonicField(currentKey.root, currentKey.quality),
    [currentKey.root, currentKey.quality]
  );

  const keyOpacity = useRef(new Animated.Value(0)).current;
  const keySlideY = useRef(new Animated.Value(14)).current;
  const chordsOpacity = useRef(new Animated.Value(0)).current;
  const statusDot = useRef(new Animated.Value(1)).current;
  const noteOpacity = useRef(new Animated.Value(0)).current;
  const prevKey = useRef('');

  useEffect(() => {
    const keyStr = `${currentKey.root}-${currentKey.quality}`;
    if (keyStr === prevKey.current) return;
    prevKey.current = keyStr;

    keyOpacity.setValue(0);
    keySlideY.setValue(14);
    chordsOpacity.setValue(0);

    Animated.sequence([
      Animated.parallel([
        Animated.timing(keyOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(keySlideY, {
          toValue: 0,
          tension: 80,
          friction: 11,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(chordsOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [currentKey.root, currentKey.quality]);

  useEffect(() => {
    Animated.timing(noteOpacity, {
      toValue: currentNote !== null ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [currentNote]);

  useEffect(() => {
    if (isRunning) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(statusDot, { toValue: 0.25, duration: 750, useNativeDriver: true }),
          Animated.timing(statusDot, { toValue: 1, duration: 750, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    statusDot.setValue(0.5);
  }, [isRunning]);

  return (
    <View style={styles.detectedContainer}>
      <View style={styles.detectedHeader}>
        <Image
          source={require('../assets/images/app-logo.png')}
          style={styles.headerLogoImg}
          resizeMode="contain"
        />
        <Text style={styles.appName}>Tom Certo</Text>
        <View style={styles.detectedStatusRow}>
          <Animated.View
            style={[
              styles.statusDot,
              {
                backgroundColor: isRunning ? C.amber : C.text3,
                opacity: isRunning ? statusDot : 0.5,
              },
            ]}
          />
          <Text style={styles.detectedStatusTxt} numberOfLines={2}>
            {statusMessage}
          </Text>
        </View>
      </View>

      <View style={styles.keyCard}>
        <Text style={styles.keyCardLabel}>TOM DETECTADO</Text>
        <Animated.View
          style={{
            opacity: keyOpacity,
            transform: [{ translateY: keySlideY }],
            alignItems: 'center',
          }}
        >
          <View style={styles.keyNoteRow}>
            <Text
              testID="main-key-display-text"
              style={styles.mainNoteBr}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {keyDisplay.noteBr}
            </Text>
            <Text style={styles.noteIntlBadge}>({keyDisplay.noteIntl})</Text>
          </View>
          <View style={styles.qualityPill}>
            <Text testID="main-key-tonality-text" style={styles.qualityText}>
              {keyDisplay.qualityLabel}
            </Text>
          </View>
        </Animated.View>
      </View>

      <View style={styles.currentNoteRow}>
        <Text style={styles.currentNoteLabel}>NOTA AGORA</Text>
        <Animated.View style={[styles.currentNoteValue, { opacity: noteOpacity }]}>
          <Text style={styles.currentNoteBr}>
            {currentNote !== null ? NOTES_BR[currentNote] : '—'}
          </Text>
          <Text style={styles.currentNoteIntl}>
            {currentNote !== null ? `(${NOTES_INTL[currentNote]})` : ''}
          </Text>
        </Animated.View>
      </View>

      <View style={styles.stabilityRow}>
        <View
          style={[
            styles.stabilityDot,
            { backgroundColor: isStable ? C.green : C.amber },
          ]}
        />
        <Text
          style={[
            styles.stabilityTxt,
            { color: isStable ? C.green : C.amber },
          ]}
        >
          {isStable ? 'Estável no tom atual' : 'Refinando análise...'}
        </Text>
      </View>

      <Animated.View style={[styles.harmonicSection, { opacity: chordsOpacity }]}>
        <Text style={styles.sectionLabel}>CAMPO HARMÔNICO</Text>
        <View style={styles.chordGrid} testID="harmonic-field-grid">
          {harmonicField.map((chord, i) => (
            <View
              key={`${chord.root}-${i}`}
              style={[
                styles.chordCard,
                chord.isTonic && styles.chordCardTonic,
              ]}
            >
              <Text style={styles.chordDegree}>
                {degreeLabel(i, currentKey.quality)}
              </Text>
              <Text
                style={[
                  styles.chordLabel,
                  chord.isTonic && styles.chordLabelTonic,
                ]}
              >
                {chord.label}
              </Text>
              <Text style={styles.chordIntl}>
                {chordIntlLabel(chord.root, chord.quality)}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <View style={styles.detectedActions}>
        {isRunning ? (
          <TouchableOpacity
            testID="stop-detection-button"
            style={styles.stopBtnLarge}
            onPress={onStop}
            activeOpacity={0.8}
          >
            <Ionicons name="stop" size={16} color={C.red} />
            <Text style={styles.stopBtnLargeTxt}>Parar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            testID="resume-detection-button"
            style={styles.primaryBtn}
            onPress={onResume}
            activeOpacity={0.8}
          >
            <Ionicons name="play" size={16} color={C.bg} />
            <Text style={styles.primaryBtnTxt}>Continuar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          testID="reset-detection-button"
          style={styles.resetBtn}
          onPress={onReset}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh" size={14} color={C.text2} />
          <Text style={styles.resetBtnTxt}>Nova detecção</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Mic Notice Modal ────────────────────────────────────────────────────────
function MicNoticeModal({
  visible,
  onClose,
  onRetry,
  reason,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  onRetry: () => void;
  reason: 'permission_denied' | 'permission_blocked' | 'platform_limit' | 'unknown' | null;
  message: string | null;
}) {
  const isPerm = reason === 'permission_denied' || reason === 'permission_blocked';
  const isBlocked = reason === 'permission_blocked';
  const isLimit = reason === 'platform_limit';

  const title = isPerm
    ? 'Acesso ao microfone'
    : isLimit
    ? 'Versão em desenvolvimento'
    : 'Aviso';
  const icon = isPerm ? 'mic-off' : isLimit ? 'construct-outline' : 'information-circle';
  const iconColor = isPerm ? C.red : C.amber;

  const openSettings = async () => {
    try { await Linking.openSettings(); } catch { /* */ }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={[styles.modalIcon, { borderColor: iconColor }]}>
            <Ionicons name={icon as any} size={26} color={iconColor} />
          </View>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMsg}>
            {message ||
              (isPerm
                ? 'Permita o acesso ao microfone para detectar o tom.'
                : 'Algo deu errado.')}
          </Text>

          <View style={styles.modalActions}>
            {isBlocked && Platform.OS !== 'web' ? (
              <TouchableOpacity
                style={styles.modalPrimary}
                onPress={openSettings}
                activeOpacity={0.85}
              >
                <Ionicons name="settings" size={16} color={C.bg} />
                <Text style={styles.modalPrimaryTxt}>Abrir configurações</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.modalPrimary}
                onPress={onRetry}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={isPerm ? 'mic' : 'refresh'}
                  size={16}
                  color={C.bg}
                />
                <Text style={styles.modalPrimaryTxt}>
                  {isPerm ? 'Permitir microfone' : 'Tentar novamente'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={styles.modalSecondaryTxt}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function degreeLabel(index: number, quality: 'major' | 'minor'): string {
  const major = ['I', 'ii', 'iii', 'IV', 'V', 'vi'];
  const minor = ['i', 'ii°', 'III', 'iv', 'v', 'VI'];
  return (quality === 'major' ? major : minor)[index] ?? '';
}

function chordIntlLabel(
  root: number,
  quality: 'major' | 'minor' | 'dim'
): string {
  const n = NOTES_INTL[root];
  if (quality === 'minor') return `${n}m`;
  if (quality === 'dim') return `${n}°`;
  return n;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const CHORD_GAP = 8;
const CHORD_WIDTH = (SW - 32 - CHORD_GAP * 2) / 3;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  splash: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashText: { fontSize: 28, fontWeight: '800', color: C.amber, letterSpacing: -0.5 },

  initialContainer: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 32,
  },
  initialHeader: { alignItems: 'center', marginTop: 20 },
  initialAppName: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 32,
    color: C.white,
    letterSpacing: -0.8,
  },
  initialTagline: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text3,
    marginTop: 4,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  initialLogoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  ringOuter: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: C.amberBorder,
    opacity: 0.3,
  },
  initialWave: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  ringMid: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: C.amberBorder,
    opacity: 0.5,
  },
  micCircleSimple: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: C.amberMuted,
    borderWidth: 1.5,
    borderColor: C.amberBorder,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: C.amber,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  brandLogoLarge: {
    width: 90,
    height: 90,
    marginBottom: 4,
  },
  micCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImg: {
    width: 150,
    height: 150,
  },
  instructions: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginTop: 8,
    marginBottom: 24,
  },
  instructionsTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 20,
    color: C.white,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  instructionsBody: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: SW - 80,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.redMuted,
    borderWidth: 1,
    borderColor: C.redBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.red,
    lineHeight: 18,
  },
  initialBtnArea: { alignItems: 'center' },
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
  primaryBtnTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
    color: C.bg,
    letterSpacing: 0.2,
  },
  hintBelowBtn: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: C.text3,
    marginTop: 14,
    textAlign: 'center',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  logoutTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.text3,
    letterSpacing: 0.3,
  },
  softNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 99,
    backgroundColor: C.amberMuted,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  softNoticeTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.amber,
    letterSpacing: 0.3,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 24,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  modalIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 14,
  },
  modalTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 20,
    color: C.white,
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  modalMsg: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActions: {
    gap: 8,
    width: '100%',
  },
  modalPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 99,
    backgroundColor: C.amber,
  },
  modalPrimaryTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 15,
    color: C.bg,
    letterSpacing: 0.3,
  },
  modalSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 99,
  },
  modalSecondaryTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text2,
    letterSpacing: 0.3,
  },

  listeningContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  listeningTop: { alignItems: 'center', marginTop: 16 },
  listeningLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: C.amber,
    letterSpacing: 3,
  },
  listeningStatus: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 22,
    color: C.white,
    marginTop: 8,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  listeningCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  listeningRingsWrap: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningRing: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  listeningMic: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: C.amberMuted,
    borderWidth: 1.5,
    borderColor: C.amberBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveNoteBox: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 160,
  },
  liveNoteLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2.8,
    marginBottom: 4,
  },
  liveNoteBr: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 42,
    color: C.amber,
    letterSpacing: -1,
    lineHeight: 46,
  },
  liveNoteIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: C.text3,
    marginTop: 2,
  },
  listeningBottom: { alignItems: 'center', gap: 14 },
  softInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.amberMuted,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: SW - 48,
  },
  softInfoTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.amber,
    lineHeight: 16,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 99,
    backgroundColor: C.redMuted,
    borderWidth: 1.5,
    borderColor: C.red,
  },
  stopBtnTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 15,
    color: C.red,
    letterSpacing: 0.3,
  },

  detectedContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  detectedHeader: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    marginBottom: 10,
  },
  headerLogoImg: {
    width: 40,
    height: 40,
    marginBottom: 2,
  },
  appName: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 18,
    color: C.white,
    letterSpacing: -0.3,
  },
  detectedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  detectedStatusTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.text2,
    letterSpacing: 0.2,
    flex: 1,
  },

  keyCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.amberBorder,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  keyCardLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.amber,
    letterSpacing: 2.8,
    marginBottom: 8,
  },
  keyNoteRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  mainNoteBr: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 64,
    color: C.white,
    lineHeight: 70,
    letterSpacing: -1.5,
    textShadowColor: C.amberGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
    textAlign: 'center',
  },
  noteIntlBadge: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
    color: C.text3,
    letterSpacing: 0.5,
  },
  qualityPill: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 5,
    backgroundColor: C.amberMuted,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  qualityText: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 14,
    color: C.amber,
    letterSpacing: 0.3,
  },

  currentNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
  },
  currentNoteLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2.4,
  },
  currentNoteValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  currentNoteBr: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 26,
    color: C.amber,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  currentNoteIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: C.text3,
  },

  stabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  stabilityDot: { width: 6, height: 6, borderRadius: 3 },
  stabilityTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    letterSpacing: 0.3,
  },

  harmonicSection: { marginBottom: 10 },
  sectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2.6,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  chordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CHORD_GAP,
  },
  chordCard: {
    width: CHORD_WIDTH,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  chordCardTonic: {
    backgroundColor: C.amberMuted,
    borderColor: C.amberBorder,
  },
  chordDegree: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 1.1,
    marginBottom: 2,
  },
  chordLabel: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 17,
    color: C.white,
    letterSpacing: -0.3,
  },
  chordLabelTonic: { color: C.amber },
  chordIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    color: C.text3,
    marginTop: 1,
    letterSpacing: 0.3,
  },

  detectedActions: {
    gap: 8,
    marginTop: 'auto',
  },
  stopBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 99,
    backgroundColor: C.redMuted,
    borderWidth: 1.5,
    borderColor: C.red,
  },
  stopBtnLargeTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 15,
    color: C.red,
    letterSpacing: 0.3,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 99,
    backgroundColor: 'transparent',
  },
  resetBtnTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text2,
    letterSpacing: 0.2,
  },
});
