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
  ScrollView,
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
import AudioVisualizer from '../src/components/AudioVisualizer';

const { width: SW, height: SH } = Dimensions.get('window');

const C = {
  bg: '#000000',
  surface: '#0E0E0E',
  surface2: '#141414',
  border: '#1C1C1C',
  borderStrong: '#2A2A2A',
  amber: '#FFB020',
  amberGlow: 'rgba(255,176,32,0.38)',
  amberMuted: 'rgba(255,176,32,0.10)',
  amberBorder: 'rgba(255,176,32,0.28)',
  white: '#FFFFFF',
  text2: '#A0A0A0',
  text3: '#555555',
  red: '#EF4444',
  redMuted: 'rgba(239,68,68,0.12)',
  green: '#22C55E',
  greenMuted: 'rgba(34,197,94,0.10)',
  greenBorder: 'rgba(34,197,94,0.35)',
  blue: '#60A5FA',
};

// ═════════════════════════════════════════════════════════════════════════
// ROOT
// ═════════════════════════════════════════════════════════════════════════
export default function HomeScreen() {
  const det = useKeyDetection();
  const { appMode, errorMessage } = det;

  return (
    <SafeAreaView style={ss.safe} edges={['top', 'bottom']}>
      {appMode === 'idle' && <IdleScreen det={det} />}
      {appMode === 'analyzing' && <AnalyzingScreen det={det} />}
      {appMode === 'result' && <ResultScreen det={det} />}
      {appMode === 'monitoring' && <MonitoringScreen det={det} />}
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// IDLE — tela inicial grande "Começar análise"
// ═════════════════════════════════════════════════════════════════════════
function IdleScreen({ det }: { det: ReturnType<typeof useKeyDetection> }) {
  const { logout, session } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const prevErr = useRef<string | null>(null);
  useEffect(() => {
    if (det.errorMessage && det.errorMessage !== prevErr.current) setModalVisible(true);
    prevErr.current = det.errorMessage;
  }, [det.errorMessage]);

  const fadeIn = useRef(new Animated.Value(0)).current;
  const logoGlow = useRef(new Animated.Value(0.6)).current;
  const micScale = useRef(new Animated.Value(1)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    const logoLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(logoGlow, { toValue: 0.6, duration: 2200, useNativeDriver: true }),
      ])
    );
    logoLoop.start();

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

  const renderRing = (val: Animated.Value) => (
    <Animated.View
      style={[ss.micRing, {
        opacity: val.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] }),
        transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
      }]}
    />
  );

  const handleStart = () => {
    Animated.sequence([
      Animated.timing(micScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.spring(micScale, { toValue: 1, useNativeDriver: true }),
    ]).start();
    det.startAnalysis();
  };

  return (
    <Animated.View style={[ss.idleRoot, { opacity: fadeIn }]}>
      <View style={ss.idleLogoRow}>
        <Animated.Image
          source={require('../assets/images/logo-full.png')}
          style={[ss.idleLogo, { opacity: logoGlow }]}
          resizeMode="contain"
        />
      </View>

      <Text style={ss.idleTitle}>Toque para iniciar</Text>
      <Text style={ss.idleSubtitle}>
        Cante ou toque por {Math.ceil(15)} segundos.{'\n'}
        O app identifica o tom da música.
      </Text>

      <View style={ss.idleMicSection}>
        {renderRing(ring3)}
        {renderRing(ring2)}
        {renderRing(ring1)}

        <Animated.View style={{ transform: [{ scale: micScale }] }}>
          <TouchableOpacity
            testID="start-analysis-btn"
            style={ss.idleMicBtn}
            onPress={handleStart}
            activeOpacity={0.85}
          >
            <Ionicons name="mic" size={58} color={C.bg} />
          </TouchableOpacity>
        </Animated.View>
      </View>

      <Text style={ss.idleCta}>COMEÇAR ANÁLISE</Text>

      {det.statusMessage && det.statusMessage !== 'Pronto para detectar' && (
        <View style={ss.softBar}>
          <Ionicons name="information-circle-outline" size={15} color={C.amber} />
          <Text style={ss.softBarTxt}>{det.statusMessage}</Text>
        </View>
      )}

      <TouchableOpacity testID="logout-btn" style={ss.logoutBtn} onPress={logout} activeOpacity={0.6}>
        <Ionicons name="log-out-outline" size={13} color={C.text3} />
        <Text style={ss.logoutTxt}>
          Sair{session?.customer_name ? ` · ${session.customer_name}` : ''}
        </Text>
      </TouchableOpacity>

      <MicNoticeModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onRetry={() => { setModalVisible(false); det.startAnalysis(); }}
        reason={det.errorReason}
        message={det.errorMessage}
      />
    </Animated.View>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ANALYZING — 15s countdown com captura
// ═════════════════════════════════════════════════════════════════════════
function AnalyzingScreen({ det }: { det: ReturnType<typeof useKeyDetection> }) {
  const { analyzeTimeLeft, currentNote, recentNotes, audioLevel, cancelAnalysis } = det;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={ss.analyzeRoot}>
      <View style={ss.analyzeHeader}>
        <Text style={ss.analyzeTitle}>Analisando...</Text>
        <TouchableOpacity
          testID="cancel-analysis-btn"
          style={ss.analyzeCancel}
          onPress={cancelAnalysis}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={24} color={C.text2} />
        </TouchableOpacity>
      </View>

      <Animated.View style={[ss.countdownBox, { transform: [{ scale: pulse }] }]}>
        <Text style={ss.countdownNum}>{analyzeTimeLeft}</Text>
        <Text style={ss.countdownUnit}>segundos</Text>
      </Animated.View>

      <Text style={ss.analyzeInstruction}>
        Continue cantando ou tocando.{'\n'}
        Ao final, o tom será identificado.
      </Text>

      <View style={ss.visualizerBox}>
        <AudioVisualizer level={audioLevel} color={C.amber} height={68} bars={11} active />
      </View>

      {currentNote !== null && (
        <View style={ss.analyzeNoteBox}>
          <Text style={ss.analyzeNoteLabel}>CAPTANDO</Text>
          <Text style={ss.analyzeNoteTxt}>{NOTES_BR[currentNote]}</Text>
        </View>
      )}

      <View style={ss.analyzeRecentBox}>
        <Text style={ss.analyzeRecentLabel}>NOTAS DETECTADAS</Text>
        <View style={ss.analyzeRecentRow}>
          {recentNotes.length === 0 ? (
            <Text style={ss.analyzeRecentEmpty}>aguardando notas...</Text>
          ) : (
            recentNotes.map((pc, i) => (
              <View key={`${pc}-${i}`} style={ss.analyzeChip}>
                <Text style={ss.analyzeChipTxt}>{NOTES_BR[pc]}</Text>
              </View>
            ))
          )}
        </View>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// RESULT — tom definitivo + campo harmônico
// ═════════════════════════════════════════════════════════════════════════
function ResultScreen({ det }: { det: ReturnType<typeof useKeyDetection> }) {
  const { lockedKey, lockedConfidence, newAnalysis, startMonitoring, reset } = det;
  if (!lockedKey) return null;

  const k = formatKeyDisplay(lockedKey.root, lockedKey.quality);
  const confPct = Math.min(100, Math.max(0, Math.round(lockedConfidence * 100)));
  const harmonicField = useMemo(
    () => getHarmonicField(lockedKey.root, lockedKey.quality),
    [lockedKey.root, lockedKey.quality]
  );

  const slideIn = useRef(new Animated.Value(30)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideIn, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={ss.resultScroll}>
      <Animated.View style={{ opacity: fadeIn, transform: [{ translateY: slideIn }] }}>
        <View style={ss.resultHeader}>
          <Ionicons name="checkmark-circle" size={22} color={C.green} />
          <Text style={ss.resultHeaderTxt}>TOM IDENTIFICADO</Text>
          <TouchableOpacity
            testID="result-close-btn"
            onPress={reset}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={ss.resultClose}
          >
            <Ionicons name="close" size={22} color={C.text2} />
          </TouchableOpacity>
        </View>

        <View style={ss.resultKeyBox}>
          <Text style={ss.resultKeyNote}>{k.noteBr}</Text>
          <Text style={ss.resultKeyQuality}>{k.qualityLabel}</Text>
          <Text style={ss.resultKeyIntl}>{k.noteIntl}{lockedKey.quality === 'minor' ? 'm' : ''}</Text>
          <View style={ss.resultConfRow}>
            <Ionicons name="shield-checkmark" size={14} color={C.green} />
            <Text style={ss.resultConfTxt}>Confiança {confPct}%</Text>
          </View>
        </View>

        <View style={ss.fieldSection}>
          <Text style={ss.fieldSectionTitle}>Campo Harmônico</Text>
          <Text style={ss.fieldSectionSub}>
            Acordes mais prováveis da tonalidade detectada
          </Text>
          <View style={ss.chordGrid}>
            {harmonicField.map((chord, i) => (
              <View
                key={i}
                testID={`chord-${i}`}
                style={[ss.chordCard, chord.isTonic && ss.chordCardTonic]}
              >
                <Text style={ss.chordDegree}>{degreeLabel(i, lockedKey.quality)}</Text>
                <Text style={[ss.chordName, chord.isTonic && ss.chordNameTonic]}>{chord.label}</Text>
                <Text style={ss.chordIntl}>{chordIntlLabel(chord.root, chord.quality)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={ss.resultActions}>
          <TouchableOpacity
            testID="monitor-btn"
            style={ss.resultActionSecondary}
            onPress={startMonitoring}
            activeOpacity={0.85}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="radio" size={18} color={C.blue} />
            <Text style={[ss.resultActionTxt, { color: C.blue }]}>Monitorar ao vivo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="new-analysis-btn"
            style={ss.resultActionPrimary}
            onPress={newAnalysis}
            activeOpacity={0.85}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="refresh" size={18} color={C.bg} />
            <Text style={[ss.resultActionTxt, { color: C.bg }]}>Nova análise</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// MONITORING — tom travado + detecção live
// ═════════════════════════════════════════════════════════════════════════
function MonitoringScreen({ det }: { det: ReturnType<typeof useKeyDetection> }) {
  const { lockedKey, lockedConfidence, currentNote, recentNotes, audioLevel, stopMonitoring, modulationCandidate } = det;
  if (!lockedKey) return null;
  const k = formatKeyDisplay(lockedKey.root, lockedKey.quality);

  return (
    <View style={ss.monRoot}>
      <View style={ss.monHeader}>
        <View>
          <Text style={ss.monHeaderLabel}>MONITORANDO</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={ss.monHeaderKey}>{k.noteBr}</Text>
            <Text style={ss.monHeaderQ}>{k.qualityLabel}</Text>
          </View>
        </View>
        <TouchableOpacity
          testID="stop-monitor-btn"
          onPress={stopMonitoring}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={ss.monClose}
        >
          <Ionicons name="close" size={22} color={C.text2} />
        </TouchableOpacity>
      </View>

      <View style={ss.monNoteBox}>
        <Text style={ss.monNoteLabel}>NOTA ATUAL</Text>
        <Text style={ss.monNoteTxt}>
          {currentNote !== null ? NOTES_BR[currentNote] : '—'}
        </Text>
        <AudioVisualizer level={audioLevel} color={C.amber} height={38} bars={7} active />
      </View>

      {modulationCandidate && (
        <View style={ss.monChangeBanner}>
          <Ionicons name="swap-horizontal" size={16} color={C.blue} />
          <Text style={ss.monChangeTxt}>
            Possível mudança para{' '}
            <Text style={{ fontFamily: 'Outfit_700Bold', color: C.blue }}>
              {formatKeyDisplay(modulationCandidate.root, modulationCandidate.quality).noteBr}{' '}
              {formatKeyDisplay(modulationCandidate.root, modulationCandidate.quality).qualityLabel}
            </Text>
          </Text>
        </View>
      )}

      <View style={ss.monHistoryBox}>
        <Text style={ss.monHistoryLabel}>HISTÓRICO</Text>
        <View style={ss.monHistoryRow}>
          {recentNotes.length === 0
            ? <Text style={ss.monHistoryEmpty}>aguardando notas...</Text>
            : recentNotes.map((pc, i) => {
                const latest = i === recentNotes.length - 1;
                return (
                  <View key={`${pc}-${i}`} style={[ss.monChip, latest && ss.monChipActive]}>
                    <Text style={[ss.monChipTxt, latest && ss.monChipTxtActive]}>{NOTES_BR[pc]}</Text>
                  </View>
                );
              })
          }
        </View>
      </View>
    </View>
  );
}

// ─── MicNoticeModal ──────────────────────────────────────────────────────────
function MicNoticeModal({ visible, onClose, onRetry, reason, message }: {
  visible: boolean; onClose: () => void; onRetry: () => void;
  reason: string | null; message: string | null;
}) {
  const isBlocked = reason === 'permission_blocked';
  const isPerm = reason === 'permission_denied' || isBlocked;
  const isLimit = reason === 'platform_limit';
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
function degreeLabel(i: number, _q: 'major' | 'minor') {
  return (['I', 'ii', 'iii', 'IV', 'V', 'vi'] as const)[i] ?? '';
}
function chordIntlLabel(root: number, q: 'major' | 'minor' | 'dim') {
  return NOTES_INTL[root] + (q === 'minor' ? 'm' : q === 'dim' ? '°' : '');
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const MIC_SIZE = 140;
const CHORD_GAP = 8;
const CHORD_W = (SW - 32 - CHORD_GAP * 2) / 3;

const ss = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // ═══ IDLE ═══════════════════════════════════════════════════════════════
  idleRoot: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: SH * 0.06,
    paddingBottom: 28,
    alignItems: 'center',
  },
  idleLogoRow: { alignItems: 'center', marginBottom: 12 },
  idleLogo: { width: 160, height: 160 },
  idleTitle: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 28,
    color: C.white,
    letterSpacing: -0.6,
    marginTop: 4,
  },
  idleSubtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 6,
    marginBottom: 24,
    maxWidth: 280,
  },
  idleMicSection: {
    alignItems: 'center',
    justifyContent: 'center',
    width: MIC_SIZE * 3,
    height: MIC_SIZE * 2.2,
  },
  micRing: {
    position: 'absolute',
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  idleMicBtn: {
    width: MIC_SIZE,
    height: MIC_SIZE,
    borderRadius: MIC_SIZE / 2,
    backgroundColor: C.amber,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: C.amber, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.65, shadowRadius: 32 },
      android: { elevation: 12 },
      default: {},
    }),
  },
  idleCta: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 12,
    color: C.amber,
    letterSpacing: 3,
    marginTop: 2,
    marginBottom: 28,
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
    maxWidth: 320,
  },
  softBarTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: C.amber,
    lineHeight: 16,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 'auto',
    paddingVertical: 8,
  },
  logoutTxt: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: C.text3,
    letterSpacing: 0.4,
  },

  // ═══ ANALYZING ══════════════════════════════════════════════════════════
  analyzeRoot: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  analyzeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  analyzeTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 22,
    color: C.white,
    letterSpacing: -0.4,
  },
  analyzeCancel: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  countdownBox: {
    alignItems: 'center',
    marginVertical: 20,
  },
  countdownNum: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 180,
    color: C.amber,
    letterSpacing: -8,
    lineHeight: 190,
    ...Platform.select({
      ios: { textShadowColor: C.amberGlow, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 38 },
      default: {},
    }),
  },
  countdownUnit: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    color: C.text2,
    letterSpacing: 2,
    marginTop: -10,
  },
  analyzeInstruction: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 24,
  },
  visualizerBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  analyzeNoteBox: {
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 14,
  },
  analyzeNoteLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9,
    color: C.text3,
    letterSpacing: 2.5,
  },
  analyzeNoteTxt: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 64,
    color: C.white,
    lineHeight: 70,
    letterSpacing: -2,
  },
  analyzeRecentBox: { gap: 8 },
  analyzeRecentLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 9,
    color: C.text3,
    letterSpacing: 2.5,
  },
  analyzeRecentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 44,
    alignItems: 'center',
  },
  analyzeRecentEmpty: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: C.text3,
    fontStyle: 'italic',
  },
  analyzeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minWidth: 32,
    alignItems: 'center',
  },
  analyzeChipTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 12,
    color: C.text2,
    letterSpacing: 0.3,
  },

  // ═══ RESULT ═════════════════════════════════════════════════════════════
  resultScroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 18,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  resultHeaderTxt: {
    flex: 1,
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: C.green,
    letterSpacing: 2,
  },
  resultClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  resultKeyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    backgroundColor: C.greenMuted,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.greenBorder,
  },
  resultKeyNote: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 106,
    color: C.white,
    letterSpacing: -4,
    lineHeight: 115,
  },
  resultKeyQuality: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 28,
    color: C.white,
    letterSpacing: -0.6,
    marginTop: -8,
  },
  resultKeyIntl: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: C.text2,
    letterSpacing: 1,
    marginTop: 4,
  },
  resultConfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.greenBorder,
  },
  resultConfTxt: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: C.green,
    letterSpacing: 0.4,
  },
  fieldSection: { gap: 10 },
  fieldSectionTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 18,
    color: C.white,
    letterSpacing: -0.3,
  },
  fieldSectionSub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: C.text2,
    marginTop: -4,
    marginBottom: 6,
  },
  chordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: CHORD_GAP },
  chordCard: {
    width: CHORD_W,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 12,
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
    marginBottom: 3,
  },
  chordName: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 17,
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
  resultActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  resultActionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 99,
    backgroundColor: C.amber,
  },
  resultActionSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 99,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.35)',
  },
  resultActionTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 14,
    letterSpacing: 0.3,
  },

  // ═══ MONITORING ═════════════════════════════════════════════════════════
  monRoot: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  monHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  monHeaderLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2,
    marginBottom: 2,
  },
  monHeaderKey: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 32,
    color: C.white,
    letterSpacing: -0.8,
  },
  monHeaderQ: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 18,
    color: C.text2,
  },
  monClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  monNoteBox: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  monNoteLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2.5,
  },
  monNoteTxt: {
    fontFamily: 'Outfit_800ExtraBold',
    fontSize: 88,
    color: C.white,
    letterSpacing: -3,
    lineHeight: 96,
  },
  monChangeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(96,165,250,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.35)',
    marginTop: 14,
  },
  monChangeTxt: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    color: C.text2,
  },
  monHistoryBox: { gap: 8, marginTop: 16 },
  monHistoryLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    color: C.text3,
    letterSpacing: 2,
  },
  monHistoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 44,
    alignItems: 'center',
  },
  monHistoryEmpty: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 11,
    color: C.text3,
    fontStyle: 'italic',
  },
  monChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    minWidth: 32,
    alignItems: 'center',
  },
  monChipActive: {
    backgroundColor: 'rgba(255,176,32,0.14)',
    borderColor: 'rgba(255,176,32,0.50)',
  },
  monChipTxt: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 12,
    color: C.text2,
  },
  monChipTxtActive: { color: C.amber },

  // ═══ MODAL ══════════════════════════════════════════════════════════════
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
});
