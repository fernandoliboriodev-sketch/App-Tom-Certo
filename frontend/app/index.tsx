import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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

import { useKeyDetection } from '../src/hooks/useKeyDetection';
import {
  NOTES_BR,
  NOTES_INTL,
  formatKeyDisplay,
  getHarmonicField,
} from '../src/utils/noteUtils';
import { useAuth } from '../src/auth/AuthContext';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Design tokens (premium dark) ────────────────────────────────────────────
const C = {
  bg:           '#000000',
  surface:      '#111111',
  surface2:     '#181818',
  border:       '#1E1E1E',
  amber:        '#FFB020',
  amberGlow:    'rgba(255,176,32,0.40)',
  amberMuted:   'rgba(255,176,32,0.10)',
  amberBorder:  'rgba(255,176,32,0.28)',
  white:        '#FFFFFF',
  text2:        '#A0A0A0',
  text3:        '#555555',
  red:          '#EF4444',
  redMuted:     'rgba(239,68,68,0.12)',
  green:        '#22C55E',
};

export default function HomeScreen() {
  const {
    currentKey,
    keyTier,
    liveConfidence,
    changeSuggestion,
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

  return (
    <SafeAreaView style={ss.safe} edges={['top', 'bottom']}>
      {screen === 'initial' && (
        <InitialScreen onStart={start} errorMessage={errorMessage} errorReason={errorReason} />
      )}
      {screen === 'listening' && (
        <ListeningScreen onStop={stop} statusMessage={statusMessage} currentNote={currentNote} softInfo={softInfo} />
      )}
      {screen === 'detected' && (
        <DetectedScreen
          currentKey={currentKey!}
          keyTier={keyTier}
          liveConfidence={liveConfidence}
          changeSuggestion={changeSuggestion}
          currentNote={currentNote}
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
// SCREEN 1 — Initial (Shazam style)
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
  const [modalVisible, setModalVisible] = useState(false);
  const prevErr = useRef<string | null>(null);

  useEffect(() => {
    if (errorMessage && errorMessage !== prevErr.current) setModalVisible(true);
    prevErr.current = errorMessage;
  }, [errorMessage]);

  // Entrance animations
  const fadeIn  = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  // Logo glow pulse
  const logoGlow = useRef(new Animated.Value(0.6)).current;

  // Mic rings — 3 waves expanding outward
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  // Mic button scale on press
  const micScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Entrance
    Animated.parallel([
      Animated.timing(fadeIn,  { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Logo subtle breath
    const logoLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, { toValue: 1,   duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(logoGlow, { toValue: 0.6, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    logoLoop.start();

    // Sonar rings — staggered
    const makeRing = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const r1 = makeRing(ring1, 0);
    const r2 = makeRing(ring2, 700);
    const r3 = makeRing(ring3, 1400);
    r1.start(); r2.start(); r3.start();

    return () => { logoLoop.stop(); r1.stop(); r2.stop(); r3.stop(); };
  }, []);

  const handlePressIn = () => {
    Animated.spring(micScale, { toValue: 0.92, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(micScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  const renderRing = (val: Animated.Value) => (
    <Animated.View
      style={[ss.micRing, {
        opacity:   val.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] }),
        transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
      }]}
    />
  );

  return (
    <Animated.View style={[ss.initialRoot, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>

      {/* ── BRAND BLOCK: Logo oficial (com texto integrado) ── */}
      <View style={ss.brandBlock}>
        <Animated.Image
          source={require('../assets/images/logo-full.png')}
          style={[ss.logoClean, { opacity: logoGlow }]}
          resizeMode="contain"
        />
      </View>

      {/* ── MIC SECTION: Shazam-style CTA ── */}
      <View style={ss.micSection}>
        {renderRing(ring3)}
        {renderRing(ring2)}
        {renderRing(ring1)}

        <Animated.View style={{ transform: [{ scale: micScale }] }}>
          <TouchableOpacity
            testID="start-detection-btn"
            style={ss.micBtn}
            onPress={onStart}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={1}
          >
            <Ionicons name="mic" size={52} color={C.bg} />
          </TouchableOpacity>
        </Animated.View>

        <Text style={ss.micLabel}>Toque para detectar</Text>
      </View>

      {/* Error box */}
      {errorMessage && !modalVisible ? (
        <TouchableOpacity testID="error-details-btn" style={ss.errorBox} onPress={() => setModalVisible(true)} activeOpacity={0.7}>
          <Ionicons name="alert-circle" size={16} color={C.red} />
          <Text style={ss.errorTxt} numberOfLines={2}>{errorMessage}</Text>
        </TouchableOpacity>
      ) : null}

      {/* ── BOTTOM: Logout ── */}
      <TouchableOpacity testID="logout-btn" style={ss.logoutBtn} onPress={logout} activeOpacity={0.6}>
        <Ionicons name="log-out-outline" size={13} color={C.text3} />
        <Text style={ss.logoutTxt}>
          Sair{session?.customer_name ? ` · ${session.customer_name}` : ''}
        </Text>
      </TouchableOpacity>

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
// SCREEN 2 — Listening
// ═════════════════════════════════════════════════════════════════════════════
function ListeningScreen({
  onStop,
  statusMessage,
  currentNote,
  softInfo,
}: {
  onStop: () => void;
  statusMessage: string;
  currentNote: number | null;
  softInfo: string | null;
}) {
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const noteOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const mkPulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    const a1 = mkPulse(pulse1, 0);
    const a2 = mkPulse(pulse2, 450);
    const a3 = mkPulse(pulse3, 900);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, []);

  useEffect(() => {
    Animated.timing(noteOpacity, {
      toValue: currentNote !== null ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [currentNote]);

  const renderPulse = (v: Animated.Value) => (
    <Animated.View style={[ss.listeningPulse, {
      opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
    }]} />
  );

  const stateLabel =
    statusMessage.includes('Ouvindo') ? 'OUVINDO' :
    statusMessage.includes('Confirmando') ? 'CONFIRMANDO' :
    statusMessage.includes('Refinando') ? 'REFINANDO' : 'ANALISANDO';

  return (
    <View style={ss.listeningRoot}>
      {/* Status */}
      <View style={ss.listeningTop}>
        <Text style={ss.listeningLabel}>{stateLabel}</Text>
      </View>

      {/* Center: mic with sonar */}
      <View style={ss.listeningCenter}>
        {renderPulse(pulse3)}
        {renderPulse(pulse2)}
        {renderPulse(pulse1)}
        <View style={ss.micBtnActive}>
          <Ionicons name="mic" size={52} color={C.bg} />
        </View>
      </View>

      {/* Live note */}
      <Animated.View style={[ss.liveNoteWrap, { opacity: noteOpacity }]}>
        <Text style={ss.liveNoteBr}>{currentNote !== null ? NOTES_BR[currentNote] : '—'}</Text>
        <Text style={ss.liveNoteIntl}>{currentNote !== null ? NOTES_INTL[currentNote] : ''}</Text>
      </Animated.View>

      {/* Soft info */}
      {softInfo ? (
        <View style={ss.softBar}>
          <Ionicons name="information-circle-outline" size={15} color={C.amber} />
          <Text style={ss.softBarTxt}>{softInfo}</Text>
        </View>
      ) : null}

      {/* Stop */}
      <TouchableOpacity testID="stop-btn" style={ss.stopBtn} onPress={onStop} activeOpacity={0.8}>
        <Ionicons name="stop-circle" size={18} color={C.red} />
        <Text style={ss.stopBtnTxt}>Parar</Text>
      </TouchableOpacity>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SCREEN 3 — Detected
// ═════════════════════════════════════════════════════════════════════════════
function DetectedScreen({
  currentKey,
  keyTier,
  liveConfidence,
  changeSuggestion,
  currentNote,
  isStable,
  isRunning,
  statusMessage,
  onStop,
  onReset,
  onResume,
}: {
  currentKey: NonNullable<ReturnType<typeof useKeyDetection>['currentKey']>;
  keyTier: ReturnType<typeof useKeyDetection>['keyTier'];
  liveConfidence: number;
  changeSuggestion: ReturnType<typeof useKeyDetection>['changeSuggestion'];
  currentNote: number | null;
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

  const changeDisplay = useMemo(() => {
    if (!changeSuggestion) return null;
    return formatKeyDisplay(changeSuggestion.root, changeSuggestion.quality);
  }, [changeSuggestion]);

  const isProvisional = keyTier === 'provisional';
  const confidencePct = Math.round(Math.max(0, liveConfidence) * 100);
  const tierLabel = isProvisional ? 'TOM PROVÁVEL' : 'TOM DETECTADO';

  const keyOpacity = useRef(new Animated.Value(0)).current;
  const keyScale  = useRef(new Animated.Value(0.88)).current;
  const chordsOpacity = useRef(new Animated.Value(0)).current;
  const statusDot = useRef(new Animated.Value(1)).current;
  const prevKey = useRef('');

  useEffect(() => {
    const k = `${currentKey.root}-${currentKey.quality}`;
    if (k === prevKey.current) return;
    prevKey.current = k;
    keyOpacity.setValue(0); keyScale.setValue(0.88); chordsOpacity.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(keyOpacity, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(keyScale,   { toValue: 1, tension: 70, friction: 10, useNativeDriver: true }),
      ]),
      Animated.timing(chordsOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
  }, [currentKey.root, currentKey.quality]);

  useEffect(() => {
    if (!isRunning) { statusDot.setValue(0.4); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(statusDot, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(statusDot, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRunning]);

  return (
    <View style={ss.detectedRoot}>
      {/* Header */}
      <View style={ss.detectedHeader}>
        <Image source={require('../assets/images/logo-icon.png')} style={ss.headerLogo} resizeMode="contain" />
        <Text style={ss.headerName}>Tom Certo</Text>
        <View style={ss.statusRow}>
          <Animated.View style={[ss.statusDot, { backgroundColor: isRunning ? C.amber : C.text3, opacity: statusDot }]} />
          <Text style={ss.statusTxt} numberOfLines={1}>{statusMessage}</Text>
        </View>
      </View>

      {/* Key hero */}
      <Animated.View style={[ss.keyHero, { opacity: keyOpacity, transform: [{ scale: keyScale }] }]}>
        <Text style={[ss.keyHeroLabel, isProvisional && { color: C.amber }]}>{tierLabel}</Text>
        <View style={ss.keyHeroRow}>
          <Text style={ss.keyHeroNote}>{keyDisplay.noteBr}</Text>
          <Text style={ss.keyHeroIntl}>({keyDisplay.noteIntl})</Text>
        </View>
        <View style={ss.keyQualityPill}>
          <Text style={ss.keyQualityTxt}>{keyDisplay.qualityLabel.toUpperCase()}</Text>
        </View>

        {/* Confiança ao vivo */}
        <View style={ss.confWrap}>
          <Text style={ss.confLabel}>CONFIANÇA</Text>
          <Text
            style={[
              ss.confValue,
              {
                color:
                  confidencePct >= 80 ? C.green :
                  confidencePct >= 60 ? C.amber : C.text2,
              },
            ]}
          >
            {confidencePct}%
          </Text>
          {/* Barra de confiança */}
          <View style={ss.confBarBg}>
            <View
              style={[
                ss.confBarFill,
                {
                  width: `${Math.min(100, confidencePct)}%`,
                  backgroundColor:
                    confidencePct >= 80 ? C.green :
                    confidencePct >= 60 ? C.amber : C.text3,
                },
              ]}
            />
          </View>
        </View>
      </Animated.View>

      {/* Banner de possível mudança de tom */}
      {changeDisplay && (
        <View style={ss.changeBanner}>
          <Ionicons name="swap-horizontal" size={14} color={C.amber} />
          <Text style={ss.changeBannerTxt}>
            Possível mudança para{' '}
            <Text style={ss.changeBannerStrong}>
              {changeDisplay.noteBr} {changeDisplay.qualityLabel}
            </Text>
          </Text>
        </View>
      )}

      {/* Stability + current note inline */}
      <View style={ss.metaRow}>
        <View style={ss.metaLeft}>
          <View style={[ss.stableIndicator, { backgroundColor: isStable ? C.green : C.amber }]} />
          <Text style={[ss.stableTxt, { color: isStable ? C.green : C.amber }]}>
            {isStable ? 'Estável' : 'Refinando...'}
          </Text>
        </View>
        {currentNote !== null && (
          <View style={ss.metaRight}>
            <Text style={ss.currentNoteLabel}>NOTA</Text>
            <Text style={ss.currentNoteTxt}>{NOTES_BR[currentNote]}</Text>
          </View>
        )}
      </View>

      {/* Harmonic field */}
      <Animated.View style={{ opacity: chordsOpacity, flex: 1 }}>
        <Text style={ss.sectionLabel}>CAMPO HARMÔNICO</Text>
        <View style={ss.chordGrid}>
          {harmonicField.map((chord, i) => (
            <View key={i} testID={`chord-${i}`}
              style={[ss.chordCard, chord.isTonic && ss.chordCardTonic]}>
              <Text style={ss.chordDegree}>{degreeLabel(i, currentKey.quality)}</Text>
              <Text style={[ss.chordName, chord.isTonic && ss.chordNameTonic]}>{chord.label}</Text>
              <Text style={ss.chordIntl}>{chordIntlLabel(chord.root, chord.quality)}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Actions */}
      <View style={ss.detectedActions}>
        {isRunning ? (
          <TouchableOpacity testID="stop-btn-detected" style={ss.actionBtnDanger} onPress={onStop} activeOpacity={0.8}>
            <Ionicons name="stop-circle" size={18} color={C.red} />
            <Text style={ss.actionBtnDangerTxt}>Parar</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity testID="resume-btn" style={ss.actionBtnGhost} onPress={onResume} activeOpacity={0.8}>
            <Ionicons name="play-circle" size={18} color={C.green} />
            <Text style={[ss.actionBtnGhostTxt, { color: C.green }]}>Continuar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity testID="reset-btn" style={ss.actionBtnGhost} onPress={onReset} activeOpacity={0.7}>
          <Ionicons name="refresh" size={16} color={C.text2} />
          <Text style={ss.actionBtnGhostTxt}>Nova detecção</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MicNoticeModal
// ═════════════════════════════════════════════════════════════════════════════
function MicNoticeModal({ visible, onClose, onRetry, reason, message }: {
  visible: boolean; onClose: () => void; onRetry: () => void;
  reason: string | null; message: string | null;
}) {
  const isBlocked = reason === 'permission_blocked';
  const isPerm    = reason === 'permission_denied' || isBlocked;
  const isLimit   = reason === 'platform_limit';
  const icon: any = isPerm ? 'mic-off' : isLimit ? 'construct-outline' : 'information-circle';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ss.modalBg}>
        <View style={ss.modalCard}>
          <Ionicons name={icon} size={30} color={isPerm ? C.red : C.amber} style={{ marginBottom: 14 }} />
          <Text style={ss.modalTitle}>{isPerm ? 'Microfone bloqueado' : isLimit ? 'Recurso nativo' : 'Aviso'}</Text>
          <Text style={ss.modalMsg}>{message ?? 'Algo deu errado.'}</Text>
          <View style={{ gap: 8, width: '100%', marginTop: 20 }}>
            {isBlocked && Platform.OS !== 'web' ? (
              <TouchableOpacity testID="open-settings-btn" style={ss.modalPrimary} onPress={async () => { try { await Linking.openSettings(); } catch {} }} activeOpacity={0.85}>
                <Text style={ss.modalPrimaryTxt}>Abrir Configurações</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity testID="retry-mic-btn" style={ss.modalPrimary} onPress={onRetry} activeOpacity={0.85}>
                <Text style={ss.modalPrimaryTxt}>{isPerm ? 'Permitir Microfone' : 'Tentar novamente'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity testID="close-modal-btn" style={ss.modalSecondary} onPress={onClose}>
              <Text style={ss.modalSecondaryTxt}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function degreeLabel(i: number, q: 'major' | 'minor') {
  return (['I','ii','iii','IV','V','vi'] as const)[i] ?? '';
}
function chordIntlLabel(root: number, q: 'major' | 'minor' | 'dim') {
  return NOTES_INTL[root] + (q === 'minor' ? 'm' : q === 'dim' ? '°' : '');
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const MIC_SIZE   = 128;
const CHORD_GAP  = 8;
const CHORD_W    = (SW - 32 - CHORD_GAP * 2) / 3;

const ss = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  splash:    { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  splashTxt: { fontSize: 28, fontFamily: 'Outfit_800ExtraBold', color: C.amber },

  // ── InitialScreen ──────────────────────────────────────────────────────────
  initialRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: SH * 0.10,
    paddingBottom: 36,
    paddingHorizontal: 24,
  },

  // Brand
  brandBlock: { alignItems: 'center' },
  logoClean: {
    width: 220,
    height: 220,
  },

  // Mic CTA
  micSection: {
    alignItems: 'center',
    justifyContent: 'center',
    width: MIC_SIZE * 3,
    height: MIC_SIZE * 3,
  },
  micRing: {
    position: 'absolute',
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  micBtn: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    backgroundColor: C.amber,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios:     { shadowColor: C.amber, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 28 },
      android: { elevation: 10 },
      default: {},
    }),
  },
  micBtnActive: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    backgroundColor: C.amber,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios:     { shadowColor: C.amber, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 32 },
      android: { elevation: 12 },
      default: {},
    }),
  },
  micLabel: {
    position: 'absolute',
    bottom: 12,
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text3,
    letterSpacing: 0.5,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.redMuted,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: '100%',
  },
  errorTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.red,
    lineHeight: 16,
  },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  logoutTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.text3,
    letterSpacing: 0.4,
  },

  // ── Listening ─────────────────────────────────────────────────────────────
  listeningRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  listeningTop: { alignItems: 'center' },
  listeningLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: C.amber,
    letterSpacing: 4,
  },
  listeningCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    width: MIC_SIZE * 3,
    height: MIC_SIZE * 3,
  },
  listeningPulse: {
    position: 'absolute',
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  liveNoteWrap: { alignItems: 'center', gap: 2 },
  liveNoteBr: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 72,
    color: C.white,
    letterSpacing: -2,
    lineHeight: 76,
    textAlign: 'center',
  },
  liveNoteIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text2,
    letterSpacing: 0.5,
  },
  softBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.amberMuted,
    borderWidth: 1,
    borderColor: C.amberBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: '100%',
  },
  softBarTxt: {
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
    height: 48,
    paddingHorizontal: 32,
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

  // ── Detected ──────────────────────────────────────────────────────────────
  detectedRoot: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  detectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerLogo: { width: 28, height: 28 },
  headerName: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 15,
    color: C.white,
    flex: 1,
    letterSpacing: -0.3,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 10,
    color: C.text2,
    maxWidth: 120,
    letterSpacing: 0.2,
  },

  keyHero: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.amberBorder,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  keyHeroLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.amber,
    letterSpacing: 3,
    marginBottom: 8,
  },
  keyHeroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  keyHeroNote: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 68,
    color: C.white,
    lineHeight: 74,
    letterSpacing: -1.5,
    ...Platform.select({
      ios: { textShadowColor: C.amberGlow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22 },
      default: {},
    }),
  },
  keyHeroIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text3,
  },
  keyQualityPill: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 5,
    backgroundColor: C.amberMuted,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  keyQualityTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: C.amber,
    letterSpacing: 2,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stableIndicator: { width: 7, height: 7, borderRadius: 4 },
  stableTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  metaRight: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  currentNoteLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2,
  },
  currentNoteTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 22,
    color: C.amber,
    letterSpacing: -0.5,
    lineHeight: 26,
  },

  sectionLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  chordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: CHORD_GAP },
  chordCard: {
    width: CHORD_W,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  chordCardTonic: { backgroundColor: C.amberMuted, borderColor: C.amberBorder },
  chordDegree: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 1,
    marginBottom: 2,
  },
  chordName: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 16,
    color: C.white,
    letterSpacing: -0.3,
  },
  chordNameTonic: { color: C.amber },
  chordIntl: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 10,
    color: C.text3,
    marginTop: 1,
  },

  detectedActions: { flexDirection: 'row', gap: 10 },
  actionBtnDanger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 46,
    borderRadius: 99,
    backgroundColor: C.redMuted,
    borderWidth: 1.5,
    borderColor: C.red,
  },
  actionBtnDangerTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 14,
    color: C.red,
  },
  actionBtnGhost: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 46,
    borderRadius: 99,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionBtnGhostTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    color: C.text2,
  },

  // ── Modal ────────────────────────────────────────────────────────────────
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: C.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 28 },
      android: { elevation: 14 },
      default: {},
    }),
  },
  modalTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 20,
    color: C.white,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  modalMsg: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalPrimary: {
    height: 48,
    borderRadius: 99,
    backgroundColor: C.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 15,
    color: C.bg,
    letterSpacing: 0.4,
  },
  modalSecondary: { height: 40, alignItems: 'center', justifyContent: 'center' },
  modalSecondaryTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text2,
  },

  // ── Confiança ao vivo ──────────────────────────────────────────────────
  confWrap: {
    marginTop: 18,
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 36,
  },
  confLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9.5,
    color: C.text3,
    letterSpacing: 2.5,
    marginBottom: 6,
  },
  confValue: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 22,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  confBarBg: {
    width: '70%',
    height: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  confBarFill: {
    height: '100%',
    borderRadius: 99,
  },

  // ── Banner de mudança ──────────────────────────────────────────────────
  changeBanner: {
    marginHorizontal: 20,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255,176,32,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,176,32,0.28)',
  },
  changeBannerTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.text2,
    letterSpacing: 0.2,
  },
  changeBannerStrong: {
    fontFamily: 'Outfit_700Bold',
    color: C.amber,
  },
});
