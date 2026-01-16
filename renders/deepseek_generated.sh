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
AUDIO_BITRATE="${8:-64k}"

# ──────────────────────
# Ассеты
# ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOCK_IN="$SCRIPT_DIR/../assets/cd_mock_in.png"
MOCK_OUT="$SCRIPT_DIR/../assets/cd_mock_out.png"

# ──────────────────────
# RPM → rad/s
# ──────────────────────
ROTATE_RAD_PER_SEC=$(echo "scale=6; $RPM * 2 * 3.14159265 / 60" | bc -l)

ffmpeg -y \
  -loop 1 -i "$COVER" \
  -i "$MOCK_IN" \
  -i "$MOCK_OUT" \
  -ss "$START_SEC" -i "$TRACK" \
  -t "$DURATION" \
  -filter_complex "
    [0:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos:force_original_aspect_ratio=increase,
         crop=${SIZE}:${SIZE}[base];

    [1:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos,
         colorchannelmixer=aa=0.15[overlay_in];

    [2:v]format=rgba,
         scale=${SIZE}:${SIZE}:flags=lanczos[overlay_out];

    [base][overlay_in]overlay=0:0[tmp1];
    [tmp1][overlay_out]overlay=0:0[tmp2];

    [tmp2]
      rotate=${ROTATE_RAD_PER_SEC}*t:ow=rotw(0):oh=roth(0):c=none,
      crop=${SIZE}:${SIZE},
      setsar=1,
      fps=24
    [vout]
  " \
  -map "[vout]" \
  -map 3:a \
  -c:v libx265 \
  -crf 30 \
  -preset medium \
  -tune animation \
  -pix_fmt yuv420p \
  -x265-params "aq-mode=3:aq-strength=1.0:psy-rd=1.0:psy-rdoq=2.0:no-sao=1" \
  -c:a libopus \
  -b:a "$AUDIO_BITRATE" \
  -vbr on \
  -compression_level 10 \
  -movflags +faststart \
  -g 48 \
  -bf 2 \
  -refs 4 \
  "$OUTPUT"