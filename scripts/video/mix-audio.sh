#!/usr/bin/env bash
# Mistura trilha + efeitos (+ narração opcional) e gera o MP4 final.
# Uso: scripts/video/mix-audio.sh [pasta-com-narr-01..09]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
A="$ROOT/.tmp/video/audio"; mkdir -p "$A"
python3 "$ROOT/scripts/video/audio.py" "$A"
STARTS=(0.5 5.9 13.6 19.9 26.0 34.1 41.5 49.0 54.8)
VOICE="${1:-}"
if [[ -n "$VOICE" ]]; then
  inputs=(); filters=""; labels=""
  for i in $(seq 1 9); do
    f=$(ls "$VOICE"/narr-0$i.* 2>/dev/null | head -1 || true)
    [[ -z "$f" ]] && continue
    inputs+=(-i "$f")
    n=$(( ${#inputs[@]} / 2 + 1 ))
    ms=$(python3 -c "print(int(${STARTS[$((i-1))]}*1000))")
    filters+="[$n:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=${ms}|${ms}[v$i];"
    labels+="[v$i]"
  done
  count=$(( ${#inputs[@]} / 2 ))
  ffmpeg -hide_banner -loglevel error -y -i "$A/music.wav" -i "$A/sfx.wav" "${inputs[@]}" -filter_complex \
    "${filters}${labels}amix=inputs=${count}:normalize=0,loudnorm=I=-16:TP=-2,asplit[voz][sc];[0:a]volume=0.55[m];[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];[1:a]volume=0.7[s];[md][s][voz]amix=inputs=3:normalize=0,loudnorm=I=-15:TP=-1.5[out]" \
    -map "[out]" -ar 48000 "$A/mix.wav"
  OUT="$ROOT/video-demo/RotaPronta-demo-narrado.mp4"
else
  ffmpeg -hide_banner -loglevel error -y -i "$A/music.wav" -i "$A/sfx.wav" -filter_complex \
    "[0:a]volume=0.62[m];[1:a]volume=0.8[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 "$A/mix.wav"
  OUT="$ROOT/video-demo/RotaPronta-demo-com-audio.mp4"
fi
ffmpeg -hide_banner -loglevel error -y -i "$ROOT/video-demo/RotaPronta-demo.mp4" -i "$A/mix.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -t 60.5 -movflags +faststart "$OUT"
echo "gerado: $OUT"
