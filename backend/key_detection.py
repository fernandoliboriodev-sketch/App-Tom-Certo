"""
key_detection.py — Análise ML de Tonalidade para Voz A Capela
═══════════════════════════════════════════════════════════════════════

Pipeline:
  áudio (WAV/OGG/M4A) 
  → librosa (resample para 16kHz mono)
  → torchcrepe (extração F0 com confidence por frame)
  → filtragem de frames confiáveis
  → segmentação em notas (MIDI + duração)
  → detecção de frases (silêncios/pausas)
  → análise de tonalidade (Krumhansl-Schmuckler + cadências)
  → retorno: tonic (pc), quality (maj/min), confidence, f0_count, notes_count

Benchmark de torchcrepe em voz humana a capela (Vocadito): 89% RPA.
Muito superior ao YIN (~70%) usado no frontend em tempo real.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
import librosa
import soundfile as sf
import torch
import torchcrepe

# ─── Perfis Krumhansl-Schmuckler ──────────────────────────────────────
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

NOTE_NAMES_BR = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si']

# ─── Parâmetros ──────────────────────────────────────────────────────
SAMPLE_RATE = 16000
HOP_MS = 10  # CREPE roda a cada 10ms
HOP_LENGTH = int(SAMPLE_RATE * HOP_MS / 1000)  # 160 samples
# torchcrepe configs
MODEL_CAPACITY = 'tiny'  # 'tiny' ou 'full'. Tiny é 5x mais rápido e suficiente
F0_MIN = 65.0    # C2 (voz grave masculina)
F0_MAX = 1000.0  # B5 (voz aguda feminina)
CONFIDENCE_THRESHOLD = 0.50  # frames abaixo disso são descartados
MIN_NOTE_DUR_MS = 100  # notas muito curtas (< 100ms) são descartadas

# Usa CPU (sem GPU). Mudar se disponível.
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


def load_audio_from_bytes(audio_bytes: bytes, target_sr: int = SAMPLE_RATE) -> np.ndarray:
    """Carrega áudio de bytes (qualquer formato), converte para mono 16kHz float32."""
    # librosa.load aceita arquivos, usar BytesIO
    with tempfile.NamedTemporaryFile(suffix='.audio', delete=True) as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        y, sr = librosa.load(tmp.name, sr=target_sr, mono=True)
    # Normaliza volume
    max_abs = float(np.max(np.abs(y)) or 1.0)
    if max_abs > 0:
        y = y / max_abs * 0.95
    return y.astype(np.float32)


def extract_f0_with_crepe(
    audio: np.ndarray,
    sr: int = SAMPLE_RATE,
    model: str = MODEL_CAPACITY,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extrai F0 com torchcrepe.
    Retorna (f0 em Hz por frame, confidence 0..1 por frame).
    NaN em F0 significa frame sem pitch confiável.
    """
    # torchcrepe espera tensor (1, N)
    audio_t = torch.from_numpy(audio).unsqueeze(0).to(DEVICE)
    pitch, confidence = torchcrepe.predict(
        audio_t,
        sr,
        HOP_LENGTH,
        F0_MIN,
        F0_MAX,
        model,
        batch_size=512,
        device=DEVICE,
        return_periodicity=True,
    )
    # filtering e threshold
    # Aplicar filtro de média móvel na confidence pra suavizar
    win_length = 3
    confidence = torchcrepe.filter.median(confidence, win_length)
    pitch = torchcrepe.filter.mean(pitch, win_length)
    # Threshold
    pitch_np = pitch[0].cpu().numpy()
    conf_np = confidence[0].cpu().numpy()
    # Frames com confidence < threshold viram NaN
    pitch_np = np.where(conf_np >= CONFIDENCE_THRESHOLD, pitch_np, np.nan)
    return pitch_np, conf_np


def f0_to_midi(f0: np.ndarray) -> np.ndarray:
    """Converte Hz para MIDI note number (float). NaN preservado."""
    with np.errstate(divide='ignore', invalid='ignore'):
        midi = 69.0 + 12.0 * np.log2(f0 / 440.0)
    return midi


def segment_notes(
    midi: np.ndarray,
    conf: np.ndarray,
    hop_ms: float = HOP_MS,
) -> List[Dict[str, Any]]:
    """
    Segmenta a sequência MIDI em notas.
    Agrupa frames consecutivos cujo arredondamento MIDI seja igual.
    Retorna lista de {pitch_class, midi, dur_ms, start_ms, rms_conf}.
    """
    notes: List[Dict[str, Any]] = []
    if len(midi) == 0:
        return notes
    current_pc: Optional[int] = None
    current_midi_sum = 0.0
    current_conf_sum = 0.0
    current_frames = 0
    start_frame = 0

    def flush(end_frame: int):
        nonlocal current_pc, current_midi_sum, current_conf_sum, current_frames, start_frame
        if current_pc is None or current_frames == 0:
            return
        dur_ms = current_frames * hop_ms
        if dur_ms >= MIN_NOTE_DUR_MS:
            notes.append({
                'pitch_class': current_pc,
                'midi': round(current_midi_sum / current_frames, 2),
                'dur_ms': round(dur_ms, 1),
                'start_ms': round(start_frame * hop_ms, 1),
                'rms_conf': round(current_conf_sum / current_frames, 3),
            })
        current_pc = None
        current_midi_sum = 0.0
        current_conf_sum = 0.0
        current_frames = 0

    for i, m in enumerate(midi):
        if np.isnan(m):
            flush(i)
            continue
        pc = int(round(m)) % 12
        if current_pc is None:
            current_pc = pc
            start_frame = i
            current_midi_sum = float(m)
            current_conf_sum = float(conf[i])
            current_frames = 1
        elif pc == current_pc:
            current_midi_sum += float(m)
            current_conf_sum += float(conf[i])
            current_frames += 1
        else:
            flush(i)
            current_pc = pc
            start_frame = i
            current_midi_sum = float(m)
            current_conf_sum = float(conf[i])
            current_frames = 1
    flush(len(midi))
    return notes


def detect_phrases(notes: List[Dict[str, Any]], silence_gap_ms: float = 200.0) -> List[List[Dict[str, Any]]]:
    """
    Agrupa notas em frases. Uma frase termina quando há gap (silêncio entre notas)
    >= silence_gap_ms OU quando a nota termina mais de silence_gap_ms antes da próxima começar.
    """
    phrases: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    last_end = -1.0
    for n in notes:
        start = n['start_ms']
        if current and (start - last_end) >= silence_gap_ms:
            phrases.append(current)
            current = []
        current.append(n)
        last_end = start + n['dur_ms']
    if current:
        phrases.append(current)
    return phrases


def compute_weighted_histogram(notes: List[Dict[str, Any]]) -> np.ndarray:
    """Histograma 12-dim ponderado por duração × confidence."""
    h = np.zeros(12, dtype=np.float64)
    for n in notes:
        w = n['dur_ms'] * n['rms_conf']
        h[n['pitch_class']] += w
    return h


def pearson_correlation(a: np.ndarray, b: np.ndarray) -> float:
    """Correlação de Pearson entre vetores."""
    a_mean = a.mean()
    b_mean = b.mean()
    num = np.sum((a - a_mean) * (b - b_mean))
    den = np.sqrt(np.sum((a - a_mean) ** 2) * np.sum((b - b_mean) ** 2))
    if den < 1e-9:
        return 0.0
    return float(num / den)


def score_key(hist: np.ndarray, phrases: List[List[Dict[str, Any]]], root: int, quality: str) -> Dict[str, float]:
    """
    Pontua um par (root, quality) usando:
      - Perfil Krumhansl-Schmuckler (correlação Pearson)
      - Cadência (% frases que terminam em root)
      - Força da tônica no histograma
    """
    profile = KS_MAJOR if quality == 'major' else KS_MINOR
    rotated = np.roll(profile, root)
    pearson = pearson_correlation(hist, rotated)
    ks_score = max(0.0, (pearson + 1) / 2)  # map [-1,1] → [0,1]

    # Cadência: % de frases que resolvem em root
    cadence_score = 0.0
    if phrases:
        cad_count = sum(1 for p in phrases if p and p[-1]['pitch_class'] == root)
        cadence_score = cad_count / len(phrases)

    # Força da tônica (peso no histograma relativo ao max)
    max_h = float(np.max(hist) or 1.0)
    tonic_strength = hist[root] / max_h
    fifth_strength = hist[(root + 7) % 12] / max_h
    force_score = 0.6 * tonic_strength + 0.4 * fifth_strength

    # Nota: penalidade por notas fora da escala
    intervals_major = [0, 2, 4, 5, 7, 9, 11]
    intervals_minor = [0, 2, 3, 5, 7, 8, 10]
    intervals = intervals_major if quality == 'major' else intervals_minor
    in_scale = set((root + iv) % 12 for iv in intervals)
    total = float(hist.sum() or 1.0)
    out_scale = float(sum(hist[pc] for pc in range(12) if pc not in in_scale))
    penalty = out_scale / total

    score = 0.40 * ks_score + 0.35 * cadence_score + 0.15 * force_score - 0.20 * penalty

    return {
        'score': score,
        'ks': ks_score,
        'cadence': cadence_score,
        'force': force_score,
        'penalty': penalty,
    }


def compute_tonic_gravity(notes: List[Dict[str, Any]], phrases: List[List[Dict[str, Any]]]) -> np.ndarray:
    """
    Calcula a GRAVIDADE TONAL global por pitch class.
    Pesos:
      - Finais de frase (cadência): +8.0 por frase
      - Notas longas ≥ 400ms: +3.0 por ocorrência
      - Duração total: +0.003/ms
      - Estabilidade (rms_conf ≥ 0.7 e dur ≥ 250ms): +2.0
      - Recorrência (pc já teve peso ≥ 1.5): +1.5
    """
    g = np.zeros(12, dtype=np.float64)
    seen_with_weight = set()

    # Passo 1: pesos por nota individual
    for n in notes:
        pc = n['pitch_class']
        dur = n['dur_ms']
        g[pc] += 0.003 * dur
        if dur >= 400:
            g[pc] += 3.0
        if dur >= 250 and n.get('rms_conf', 0) >= 0.7:
            g[pc] += 2.0

    # Passo 2: cadências de frase (peso MÁXIMO)
    for phrase in phrases:
        if not phrase:
            continue
        last_note = phrase[-1]
        g[last_note['pitch_class']] += 8.0

    # Passo 3: recorrência — pcs que acumularam peso ≥ 1.5 ganham reforço
    for pc in range(12):
        if g[pc] >= 1.5:
            g[pc] += 1.5

    return g


def alignment_score(candidate_tonic: int, gravity: np.ndarray) -> float:
    """
    Quão bem uma tônica candidata casa com a gravidade tonal.
    Pesos:
      - Tônica (I): 70%
      - Dominante (V): 20%   ← forte, mas não vence sozinho
      - Subdominante (IV): 10%
    Retorna 0..1. Tônica sem gravidade é penalizada até 60%.
    """
    total_g = float(gravity.sum())
    if total_g < 8.0:
        return 0.5  # neutro (dados insuficientes)
    max_g = float(gravity.max() or 1.0)
    norm = gravity / max_g
    tonic = float(norm[candidate_tonic])
    fifth = float(norm[(candidate_tonic + 7) % 12])
    fourth = float(norm[(candidate_tonic + 5) % 12])
    return max(0.0, min(1.0, 0.70 * tonic + 0.20 * fifth + 0.10 * fourth))


def alignment_boost(candidate_tonic: int, gravity: np.ndarray) -> float:
    """Multiplicador aplicado ao score: 0.4 (sem gravidade) → 1.0 (alinhado)."""
    return 0.4 + 0.6 * alignment_score(candidate_tonic, gravity)


def is_diatonic_degree_of(candidate: int, current_tonic: int, quality: str) -> bool:
    """
    True se candidate é grau II, III, IV, V, VI, VII da current_tonic.
    (Não conta se é a própria tônica.)
    """
    if candidate == current_tonic:
        return False
    interval = (candidate - current_tonic + 12) % 12
    if quality == 'minor':
        return interval in {2, 3, 5, 7, 8, 10}  # ii°, III, iv, v, VI, VII
    return interval in {2, 4, 5, 7, 9, 11}  # ii, iii, IV, V, vi, vii°


def is_relative_pair(cand_a: Dict[str, Any], cand_b: Dict[str, Any]) -> bool:
    """Maior e sua relativa menor."""
    if cand_a['quality'] == cand_b['quality']:
        return False
    maj = cand_a if cand_a['quality'] == 'major' else cand_b
    mn = cand_a if cand_a['quality'] == 'minor' else cand_b
    return mn['root'] == (maj['root'] + 9) % 12


def relative_tiebreak_score(cand: Dict[str, Any], hist: np.ndarray, phrases: List[List[Dict[str, Any]]]) -> float:
    """Desempate quando top-2 são par relativo: cadência > freq tônica > 5ª."""
    total = float(hist.sum() or 1.0)
    tonic_freq = hist[cand['root']] / total
    fifth_freq = hist[(cand['root'] + 7) % 12] / total
    cad = 0.0
    if phrases:
        cad_count = sum(1 for p in phrases if p and p[-1]['pitch_class'] == cand['root'])
        cad = cad_count / len(phrases)
    return 0.55 * cad + 0.30 * tonic_freq + 0.15 * fifth_freq


def detect_key_from_notes(
    notes: List[Dict[str, Any]],
    phrases: List[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    Detecta tonalidade com pipeline v2 (mesma lógica do frontend mais madura):
      1. Pontua cada 1 dos 24 candidatos (Krumhansl + cadência + força - penalidade)
      2. Aplica BOOST de alignment por gravidade tonal global
      3. Ordena e aplica TIEBREAKER de pares relativos se top-2 forem relativos
      4. Aplica GUARD anti-grau-diatônico: se o runner-up é grau diatônico do top,
         o top vence com margem aumentada (descarta 5ª, 4ª e 2ª como tônicas falsas)
    """
    if not notes:
        return {'tonic': None, 'quality': None, 'confidence': 0.0, 'reason': 'no_notes'}

    hist = compute_weighted_histogram(notes)
    if float(hist.sum()) < 1.0:
        return {'tonic': None, 'quality': None, 'confidence': 0.0, 'reason': 'too_little_audio'}

    # ── Gravidade tonal global (novo v2) ─────────────────────────────
    gravity = compute_tonic_gravity(notes, phrases)

    # ── Scores base (Krumhansl + cadência + força - penalidade) ──────
    candidates = []
    for root in range(12):
        for quality in ('major', 'minor'):
            s = score_key(hist, phrases, root, quality)
            boost = alignment_boost(root, gravity)
            effective_score = s['score'] * boost
            candidates.append({
                'root': root,
                'quality': quality,
                'base_score': s['score'],
                'score': effective_score,
                'boost': boost,
                'alignment': alignment_score(root, gravity),
                'cadence': s['cadence'],
                'ks': s['ks'],
                'force': s['force'],
                'penalty': s['penalty'],
            })

    # Ordena pelo effective_score
    candidates.sort(key=lambda c: c['score'], reverse=True)

    # ── TIEBREAKER para pares relativos (maior/menor relativa) ───────
    if len(candidates) >= 2 and is_relative_pair(candidates[0], candidates[1]):
        diff = abs(candidates[0]['score'] - candidates[1]['score'])
        avg = (candidates[0]['score'] + candidates[1]['score']) / 2
        closeness = diff / avg if avg > 0 else 1.0
        if closeness < 0.10:
            tb0 = relative_tiebreak_score(candidates[0], hist, phrases)
            tb1 = relative_tiebreak_score(candidates[1], hist, phrases)
            if tb1 > tb0 + 0.03:
                candidates[0], candidates[1] = candidates[1], candidates[0]

    # ── GUARD anti-grau-diatônico ────────────────────────────────────
    # Se o runner-up é grau V/IV/ii/iii/vi da tônica top, confirma o top
    # (evita que V ou ii roubem o trono por coincidência de cadência).
    # Este guard só reorganiza se top e runner-up têm scores MUITO próximos.
    top = candidates[0]
    for runner_idx in range(1, min(5, len(candidates))):
        runner = candidates[runner_idx]
        if is_diatonic_degree_of(runner['root'], top['root'], top['quality']):
            # Se o runner é grau diatônico, exige gravity 1.3× pra superar
            grav_top = float(gravity[top['root']])
            grav_runner = float(gravity[runner['root']])
            if grav_runner > grav_top * 1.3:
                # Runner tem muito mais gravidade — provavelmente a tônica real
                candidates[0], candidates[runner_idx] = runner, top
                break

    top = candidates[0]
    runner = candidates[1] if len(candidates) > 1 else None
    margin = top['score'] - (runner['score'] if runner else 0)

    # Confiança combina: margem + alinhamento + cadência + ks
    margin_norm = min(1.0, margin / 0.08)
    confidence = (
        0.35 * margin_norm +
        0.25 * top['alignment'] +
        0.25 * top['cadence'] +
        0.15 * top['ks']
    )
    confidence = float(min(1.0, max(0.0, confidence)))

    return {
        'tonic': top['root'],
        'tonic_name': NOTE_NAMES_BR[top['root']],
        'quality': top['quality'],
        'key_name': f"{NOTE_NAMES_BR[top['root']]} {'Maior' if top['quality'] == 'major' else 'menor'}",
        'confidence': confidence,
        'top_candidates': [
            {
                'key': f"{NOTE_NAMES_BR[c['root']]} {'Maior' if c['quality'] == 'major' else 'menor'}",
                'score': round(c['score'], 4),
                'boost': round(c['boost'], 3),
                'alignment': round(c['alignment'], 3),
                'cadence': round(c['cadence'], 3),
                'ks': round(c['ks'], 3),
            }
            for c in candidates[:5]
        ],
        'histogram': hist.tolist(),
        'gravity': gravity.tolist(),
        'margin': round(margin, 4),
    }


def analyze_audio_bytes(audio_bytes: bytes) -> Dict[str, Any]:
    """
    Função pública principal.
    Recebe bytes de áudio → retorna análise completa.
    """
    # 1) Carrega
    audio = load_audio_from_bytes(audio_bytes)
    duration_s = len(audio) / SAMPLE_RATE

    if duration_s < 3.0:
        return {
            'success': False,
            'error': 'audio_too_short',
            'message': 'Áudio muito curto. Cante pelo menos 5 segundos.',
            'duration_s': duration_s,
        }

    # 2) Extrai F0 com CREPE
    f0, conf = extract_f0_with_crepe(audio)
    valid_f0_count = int(np.sum(~np.isnan(f0)))

    if valid_f0_count < 20:
        return {
            'success': False,
            'error': 'no_pitch_detected',
            'message': 'Não conseguimos detectar notas claras. Cante mais alto e sustente as notas.',
            'duration_s': duration_s,
            'f0_frames': int(len(f0)),
            'valid_f0_frames': valid_f0_count,
        }

    # 3) MIDI sequence
    midi = f0_to_midi(f0)

    # 4) Segmenta notas
    notes = segment_notes(midi, conf)

    # 5) Detecta frases
    phrases = detect_phrases(notes)

    # 6) Detecta tonalidade
    key_result = detect_key_from_notes(notes, phrases)

    return {
        'success': True,
        'duration_s': round(duration_s, 2),
        'f0_frames': int(len(f0)),
        'valid_f0_frames': valid_f0_count,
        'notes_count': len(notes),
        'phrases_count': len(phrases),
        'method': f'torchcrepe-{MODEL_CAPACITY}',
        **key_result,
    }
