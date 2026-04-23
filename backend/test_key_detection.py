"""
Teste do módulo key_detection com áudios sintéticos.
Gera melodias em tonalidades conhecidas e verifica a detecção.
"""
import sys
import numpy as np
import soundfile as sf
import io
from key_detection import analyze_audio_bytes, NOTE_NAMES_BR

SAMPLE_RATE = 16000

# MIDI de C4 = 60
# Pitch class 0=C, 1=C#, 2=D, 3=D#, 4=E, 5=F, 6=F#, 7=G, 8=G#, 9=A, 10=A#, 11=B


def midi_to_freq(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def generate_note(freq: float, duration_s: float, sr: int = SAMPLE_RATE, amp: float = 0.25) -> np.ndarray:
    """Gera nota com harmônicos + vibrato leve (mais realista)."""
    t = np.arange(int(duration_s * sr)) / sr
    # Vibrato: 5Hz, 0.3% de variação
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5 * t)
    # Fundamental + harmônicos 2 e 3 (voz humana)
    signal = (
        amp * np.sin(2 * np.pi * freq * vib * t)
        + 0.4 * amp * np.sin(2 * np.pi * 2 * freq * vib * t)
        + 0.2 * amp * np.sin(2 * np.pi * 3 * freq * vib * t)
    )
    # Envelope ADSR simples
    n = len(signal)
    attack_n = int(0.05 * sr)
    release_n = int(0.1 * sr)
    envelope = np.ones(n)
    envelope[:attack_n] = np.linspace(0, 1, attack_n)
    envelope[-release_n:] = np.linspace(1, 0, release_n)
    return signal * envelope


def generate_melody_wav(midi_sequence, durations_ms) -> bytes:
    """Gera WAV com a sequência melódica."""
    parts = []
    for midi, dur_ms in zip(midi_sequence, durations_ms):
        freq = midi_to_freq(midi)
        note = generate_note(freq, dur_ms / 1000.0)
        parts.append(note)
        # Pequeno silêncio entre notas (simula respiração)
        parts.append(np.zeros(int(0.05 * SAMPLE_RATE)))
    audio = np.concatenate(parts).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format='WAV')
    return buf.getvalue()


def melody_in_major(root_pc: int, octave: int = 4):
    """Melodia em tonalidade maior com cadências. Resolve em tônica."""
    # MIDI base
    base = 12 + octave * 12 + root_pc  # root na oitava pedida
    # Frase 1: I-III-V-III-I
    f1 = [base, base + 4, base + 7, base + 4, base]
    # Frase 2: V-IV-III-II-I
    f2 = [base + 7, base + 5, base + 4, base + 2, base]
    # Frase 3: VI-V-IV-III-II-I
    f3 = [base + 9, base + 7, base + 5, base + 4, base + 2, base]
    # Frase 4: III-II-7M-I (cadência com leading tone)
    f4 = [base + 4, base + 2, base + 11, base]

    durs1 = [280, 280, 300, 280, 650]
    durs2 = [280, 260, 260, 260, 600]
    durs3 = [280, 260, 260, 260, 250, 650]
    durs4 = [280, 260, 200, 650]

    midi_seq = f1 + f2 + f3 + f4
    durs = durs1 + durs2 + durs3 + durs4
    return midi_seq, durs


def melody_in_minor(root_pc: int, octave: int = 4):
    """Melodia em tonalidade menor natural com cadências."""
    base = 12 + octave * 12 + root_pc
    # Frase 1: i-III-v-III-i
    f1 = [base, base + 3, base + 7, base + 3, base]
    f2 = [base + 7, base + 5, base + 3, base + 2, base]
    f3 = [base + 3, base + 5, base + 7, base + 5, base + 3, base]
    f4 = [base + 3, base + 2, base + 10, base]
    durs1 = [280, 280, 300, 280, 650]
    durs2 = [280, 260, 260, 260, 600]
    durs3 = [280, 260, 260, 260, 250, 650]
    durs4 = [280, 260, 200, 650]
    return f1 + f2 + f3 + f4, durs1 + durs2 + durs3 + durs4


def melody_major_drift_V_vi(root_pc: int, octave: int = 4):
    """
    CASO REAL REPORTADO: cantor em Sol Maior, IA confundiu com Ré Maior (V)
    e Lá menor. Aqui: 8 frases onde 4 resolvem em V, 2 em vi (ii em menor),
    só 2 na tônica. Um detector sem guard anti-grau confunde facilmente.
    """
    base = 12 + octave * 12 + root_pc
    V = base + 7
    IV = base + 5
    vi = base + 9
    ii = base + 2
    III = base + 4
    seven = base + 11
    phrases = [
        ([V, vi, V, IV, V], [280, 250, 280, 250, 650]),         # termina em V
        ([base, III, V, IV, V], [280, 260, 280, 260, 650]),     # termina em V
        ([III, V, IV, III, ii, vi], [250, 260, 260, 240, 250, 650]),  # termina em vi
        ([base, III, vi], [280, 260, 650]),                     # termina em vi
        ([III, IV, seven, V], [260, 260, 250, 650]),            # termina em V (com LT)
        ([V, IV, III, ii, base], [280, 260, 260, 260, 650]),    # tônica
        ([IV, V, III, ii, V], [260, 260, 260, 260, 650]),       # termina em V
        ([III, ii, seven, base], [280, 260, 200, 650]),         # tônica
    ]
    all_midi, all_durs = [], []
    for m, d in phrases:
        all_midi.extend(m)
        all_durs.extend(d)
    return all_midi, all_durs


TESTS = [
    ('Dó Maior',   lambda: melody_in_major(0),  'Dó Maior'),
    ('Ré Maior',   lambda: melody_in_major(2),  'Ré Maior'),
    ('Sol Maior',  lambda: melody_in_major(7),  'Sol Maior'),
    ('Fá# Maior',  lambda: melody_in_major(6),  'Fá# Maior'),
    ('Lá menor',   lambda: melody_in_minor(9),  'Lá menor'),
    ('Mi menor',   lambda: melody_in_minor(4),  'Mi menor'),
    ('Si menor',   lambda: melody_in_minor(11), 'Si menor'),
    # ═══ DRIFT REAL: Sol Maior com muita ênfase em V e vi ═══
    # Esse é o caso EXATO reportado pelo user. Sistema v1 confundia com Ré Maior / Lá menor.
    ('DRIFT Sol Maior (ênfase V/vi adversarial)', lambda: melody_major_drift_V_vi(7), 'Sol Maior'),
    ('DRIFT Dó Maior (ênfase V/vi adversarial)', lambda: melody_major_drift_V_vi(0), 'Dó Maior'),
    ('DRIFT Ré Maior (ênfase V/vi adversarial)', lambda: melody_major_drift_V_vi(2), 'Ré Maior'),
]


def run():
    print('═' * 70)
    print('TEST — Detecção de tom via torchcrepe + Krumhansl (backend)')
    print('═' * 70)
    passed = 0
    for name, gen, expected_key in TESTS:
        midi_seq, durs = gen()
        wav = generate_melody_wav(midi_seq, durs)
        result = analyze_audio_bytes(wav)

        detected = result.get('key_name', 'N/A')
        conf = result.get('confidence', 0)
        notes_count = result.get('notes_count', 0)
        ok = detected == expected_key

        status = '✓' if ok else '✗'
        print(f'\n{status} {name}')
        print(f'   Esperado:  {expected_key}')
        print(f'   Detectado: {detected}  (conf={conf:.2f})')
        print(f'   Notas: {notes_count}  | Frases: {result.get("phrases_count", 0)}  | F0 frames: {result.get("valid_f0_frames", 0)}/{result.get("f0_frames", 0)}')
        if not ok:
            print(f'   Top 5: {result.get("top_candidates", [])[:5]}')
        if ok:
            passed += 1

    print('\n' + '═' * 70)
    print(f'Aprovados: {passed}/{len(TESTS)}')
    print('═' * 70)
    sys.exit(0 if passed == len(TESTS) else 1)


if __name__ == '__main__':
    run()
