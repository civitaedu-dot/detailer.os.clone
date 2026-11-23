"""Trilha e efeitos sonoros ORIGINAIS do vídeo de demonstração, sintetizados do zero
(sem amostras de terceiros). Gera music.wav e sfx.wav em 48 kHz estéreo.

Uso: python3 scripts/video/audio.py <pasta_saida>
"""
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48000
DUR = 57.5
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
rng = np.random.default_rng(7)
N = int(SR * DUR)


def t_arr(sec):
    return np.arange(int(sec * SR)) / SR


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def add(buf, sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    n = min(len(sig), len(buf) - i)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += sig[:n] * gain * l * 1.414
    buf[i:i + n, 1] += sig[:n] * gain * r * 1.414


def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na)
    if na + nd < n:
        e[na:na + nd] = np.linspace(1, s, nd)
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# ───────────────────────── música ─────────────────────────
BPM = 104
BEAT = 60 / BPM
BAR = BEAT * 4
# progressão C - G - Am - F (com cores maj7/add9)
CHORDS = [
    [48, 55, 60, 64, 67, 71],   # Cmaj7
    [43, 55, 59, 62, 67, 69],   # G(add9)
    [45, 57, 60, 64, 67, 71],   # Am9-ish
    [41, 57, 60, 65, 69, 72],   # Fmaj7
]
music = np.zeros((N, 2))

# seções (segundos) alinhadas às cenas
INTRO_END, GROOVE_START, OUTRO_START, END = 4.6, 10.2, 51.6, 57.0


def section_gain(t, part):
    if part == "drums":
        if t < INTRO_END:
            return 0.0
        if t < GROOVE_START:
            return 0.45
        if t < 46.4:
            return 1.0
        if t < OUTRO_START:
            return 0.7
        return 0.0
    if part == "bass":
        if t < INTRO_END:
            return 0.0
        if t < OUTRO_START:
            return 1.0
        return 0.0
    return 1.0


def pad_voice(f, dur):
    t = t_arr(dur)
    det = [0.997, 1.0, 1.004]
    x = sum(2 * ((t * f * d) % 1) - 1 for d in det) / 3  # serras desafinadas
    x = lp(x, 1400)
    return x * env_adsr(len(t), 0.35, 0.3, 0.8, 0.6)


def pluck(f, dur=0.9):
    """Karplus-Strong."""
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = 0.5 * (buf[i % p] + buf[(i + 1) % p]) * 0.996
    return lp(out, 5000) * np.exp(-np.arange(n) / SR * 2.2)


def kick():
    t = t_arr(0.45)
    f = 50 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7.5) + 0.15 * np.sin(ph * 2) * np.exp(-t * 30)


def hat(open_=False):
    t = t_arr(0.18 if open_ else 0.06)
    return hp(rng.uniform(-1, 1, len(t)), 7500) * np.exp(-t * (18 if open_ else 70))


def clap():
    t = t_arr(0.25)
    n = bp(rng.uniform(-1, 1, len(t)), 900, 3500)
    e = np.exp(-t * 22)
    for k in (0.0, 0.012, 0.024):
        e += 0.6 * np.exp(-np.maximum(t - k, 0) * 120) * (t >= k)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.4
    return (n * e + body) * 0.6


K, H, HO, C = kick(), hat(), hat(True), clap()
plucks = {}
t0 = 0.0
bar_i = 0
while t0 < END:
    ch = CHORDS[bar_i % 4]
    # pad (o tempo todo, mais suave na introdução)
    for note in ch[1:]:
        add(music, pad_voice(midi(note), BAR + 0.6), t0, 0.055 if t0 < INTRO_END else 0.045, pan=rng.uniform(-0.5, 0.5))
    # arpejo dedilhado em colcheias
    arp = [ch[2] + 12, ch[3] + 12, ch[4] + 12, ch[3] + 12, ch[5] + 12, ch[4] + 12, ch[3] + 12, ch[4] + 12]
    for k, note in enumerate(arp):
        at = t0 + k * BEAT / 2
        if at >= END - 0.3:
            break
        key = note
        if key not in plucks:
            plucks[key] = pluck(midi(note))
        g = 0.11 if (k % 2 == 0) else 0.075
        add(music, plucks[key], at, g * (0.8 if at < GROOVE_START else 1.0), pan=0.35 if k % 2 else -0.35)
    # baixo
    for k, off in enumerate([0, 1.5, 2, 3, 3.5]):
        at = t0 + off * BEAT
        g = section_gain(at, "bass")
        if g == 0 or at >= END:
            continue
        tt = t_arr(BEAT * 0.9)
        f = midi(ch[0] - 12 + (12 if k == 3 else 0))
        b = np.sin(2 * np.pi * f * tt) + 0.3 * lp(2 * ((tt * f) % 1) - 1, 600)
        add(music, b * env_adsr(len(tt), 0.005, 0.15, 0.6, 0.08), at, 0.16 * g)
    # bateria
    for beat in range(4):
        at = t0 + beat * BEAT
        g = section_gain(at, "drums")
        if g == 0:
            continue
        if beat in (0, 2) or (beat == 3 and bar_i % 2 == 1):
            add(music, K, at + (BEAT / 2 if beat == 3 else 0), 0.42 * g)
        if beat in (1, 3) and at >= GROOVE_START:
            add(music, C, at, 0.2 * g, pan=0.05)
        add(music, H, at + BEAT / 2, 0.06 * g, pan=0.3)
        if at >= GROOVE_START:
            add(music, H, at, 0.035 * g, pan=0.3)
    t0 += BAR
    bar_i += 1

# acorde final + cauda
for note in [48, 55, 60, 64, 67, 72]:
    add(music, pad_voice(midi(note), 4.5), 53.0, 0.06)
    add(music, pluck(midi(note + 12), 3.0), 53.0 + 0.04 * (note % 5), 0.09)

# fade-in inicial e fade-out
tt = np.arange(N) / SR
music *= np.clip(tt / 1.2, 0, 1)[:, None] * np.clip((DUR - tt) / 3.0, 0, 1)[:, None]

# ───────────────────────── efeitos ─────────────────────────
sfx = np.zeros((N, 2))


def whoosh(dur=0.7, up=True):
    t = t_arr(dur)
    noise = rng.uniform(-1, 1, len(t))
    out = np.zeros_like(noise)
    steps = 24
    seg = len(t) // steps
    for s in range(steps):
        x = s / steps
        fc = (300 + 4500 * x) if up else (4800 - 4500 * x)
        a, b = s * seg, (s + 1) * seg
        out[a:b] = bp(noise[a:b], max(80, fc * 0.6), min(18000, fc * 1.4), 1)
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return lp(out * e, 9000)


def pop(f=880):
    t = t_arr(0.12)
    ff = f * (1 + 0.6 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t * 38)


def tick():
    t = t_arr(0.025)
    return hp(rng.uniform(-1, 1, len(t)), 3000) * np.exp(-t * 300)


def tap():
    t = t_arr(0.09)
    return (np.sin(2 * np.pi * 1600 * t) * 0.5 + hp(rng.uniform(-1, 1, len(t)), 2000) * 0.5) * np.exp(-t * 90)


def chime(notes=(72, 76, 79), gap=0.07):
    out = np.zeros(int(1.6 * SR))
    for i, n in enumerate(notes):
        t = t_arr(1.4)
        f = midi(n + 12)
        x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2.01 * t)) * np.exp(-t * 3.2)
        a = int(i * gap * SR)
        out[a:a + len(x)] += x[: len(out) - a]
    return out * 0.6


def shutter():
    t = t_arr(0.16)
    n = rng.uniform(-1, 1, len(t))
    e = np.exp(-t * 60) + 0.7 * np.exp(-np.maximum(t - 0.07, 0) * 70) * (t > 0.07)
    return bp(n, 1200, 6000) * e


# abertura
add(sfx, whoosh(1.0), 0.05, 0.22)
add(sfx, pop(520), 0.95, 0.35)
soft_tick = lp(tick(), 6000)
for i in range(16):  # digitação da frase (1,8 s → 3,6 s), cliques espaçados e suaves
    add(sfx, soft_tick, 1.8 + i * (1.8 / 16) + rng.uniform(0, 0.02), 0.03, pan=rng.uniform(-0.3, 0.3))
# problema
add(sfx, whoosh(0.8), 4.5, 0.25)
add(sfx, whoosh(0.9, up=False), 4.9, 0.14, pan=0.5)
for i, at in enumerate([6.0, 6.55, 7.1]):
    add(sfx, pop(660 + 110 * i), at, 0.25, pan=-0.4)
# passos
for at in (10.15, 17.05, 22.95, 31.15, 39.05):
    add(sfx, whoosh(0.7), at, 0.22)
add(sfx, whoosh(1.2, up=False), 13.1, 0.18, pan=0.4)   # foto voando para o celular
add(sfx, shutter(), 14.45, 0.35, pan=0.5)
for i in range(8):                                        # contador de pedidos
    add(sfx, tick(), 19.4 + i * 0.15, 0.1, pan=-0.3)
add(sfx, chime((76, 79, 84)), 20.6, 0.22)
add(sfx, pop(700), 25.2, 0.28, pan=-0.4)
add(sfx, pop(780), 27.4, 0.28, pan=-0.4)
add(sfx, tap(), 28.0, 0.25, pan=0.5)                      # pino no mapa
add(sfx, chime((72, 76, 79)), 29.2, 0.18)
add(sfx, whoosh(1.4, up=False), 33.0, 0.1, pan=0.5)       # rolagem da rota
add(sfx, pop(700), 33.2, 0.26, pan=-0.4)
add(sfx, pop(840), 33.8, 0.26, pan=-0.4)
add(sfx, tap(), 41.0, 0.4, pan=0.5)                       # Navegar
add(sfx, tap(), 42.4, 0.4, pan=0.5)                       # Entregue
add(sfx, chime((79, 84, 88), 0.06), 42.8, 0.25)
# restaurante e encerramento
add(sfx, whoosh(0.8), 46.3, 0.22)
add(sfx, whoosh(1.0), 51.5, 0.25)
add(sfx, pop(520), 52.0, 0.3)


def norm(x, peak_db):
    p = np.max(np.abs(x)) + 1e-9
    return x / p * (10 ** (peak_db / 20))


wavfile.write(f"{OUT}/music.wav", SR, (norm(music, -3) * 32767).astype(np.int16))
wavfile.write(f"{OUT}/sfx.wav", SR, (norm(sfx, -3) * 32767).astype(np.int16))
print("ok", f"{OUT}/music.wav", f"{OUT}/sfx.wav")
