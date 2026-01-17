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
# RPM → rad/s
# ──────────────────────
ROTATE_RAD_PER_SEC=$(echo "scale=6; $RPM * 2 * 3.14159265 / 60" | bc -l)

ffmpeg -y \
  -loop 1 -i "$COVER" \
  -ss "$START_SEC" -i "$TRACK" \
  -t "$DURATION" \
  -filter_complex "
    [0:v]format=rgba,
         rotate=${ROTATE_RAD_PER_SEC}*t:ow=rotw(0):oh=roth(0):c=none,
         scale=${SIZE}:${SIZE}:flags=lanczos:force_original_aspect_ratio=increase,
         crop=${SIZE}:${SIZE},
         setsar=1,
         fps=24
    [vout]
  " \
  -map "[vout]" -map 1:a \
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