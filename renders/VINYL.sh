#!/bin/bash
set -e

# ──────────────────────
# Аргументы
# ──────────────────────
COVER="$1"
TRACK="$2"
OUTPUT="$3"
DURATION="${4:-30}"
START_SEC="${5:-0}"
RPM="${6:-10}"
SIZE="${7:-640}"
AUDIO_BITRATE="${8:-128k}"

# ──────────────────────
# Ассеты
# ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VINYL_IN="$SCRIPT_DIR/../assets/vinyl_mock_in.png"
VINYL_OUT="$SCRIPT_DIR/../assets/vinyl_mock_out.png"

# ──────────────────────
# RPM → rad/s
# ──────────────────────
ROTATE_RAD_PER_SEC=$(echo "scale=6; $RPM * 2 * 3.14159265 / 60" | bc -l)

ffmpeg -y \
  -loop 1 -i "$COVER" \
  -i "$VINYL_IN" \
  -i "$VINYL_OUT" \
  -ss "$START_SEC" -i "$TRACK" \
  -t "$DURATION" \
  -filter_complex "
    [0:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos:force_original_aspect_ratio=increase,
         crop=${SIZE}:${SIZE}[base];

    [1:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos[vinyl_in];

    [2:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos[vinyl_out];

    [base][vinyl_in]
      blend=all_mode=multiply:all_opacity=1,
      format=rgba
      [composed];

    [composed][vinyl_out]overlay=0:0[tmp2];

    [tmp2]
      rotate=${ROTATE_RAD_PER_SEC}*t:ow=rotw(0):oh=roth(0):c=none,
      crop=${SIZE}:${SIZE},
      setsar=1,
      fps=24
    [vout]
  " \
  -map "[vout]" -map 3:a \
  -c:v libx264 \
  -crf 30 \
  -preset medium \
  -pix_fmt yuv420p \
  -c:a libopus \
  -b:a "$AUDIO_BITRATE" \
  -vbr on \
  -compression_level 10 \
  -movflags +faststart \
  -g 48 \
  -bf 2 \
  -refs 4 \
  "$OUTPUT"