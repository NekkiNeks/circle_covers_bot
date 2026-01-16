#!/bin/bash
set -e

# ──────────────────────
# Аргументы
# ──────────────────────
COVER="$1"            # путь к изображению
TRACK="$2"            # путь к аудио
OUTPUT="$3"           # путь к выходному видео
DURATION="${4:-30}"   # длительность видео в секундах
START_SEC="${5:-0}"   # с какой секунды воспроизводить аудио
RPM="${6:-10}"        # скорость вращения в об/мин

# ──────────────────────
# Пути к ассетам (относительно скрипта)
# ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VINYL_IN="$SCRIPT_DIR/../assets/vinyl_mock_in.png"
VINYL_OUT="$SCRIPT_DIR/../assets/vinyl_mock_out.png"

# Проверки
[ -f "$COVER" ] || { echo "COVER not found"; exit 1; }
[ -f "$TRACK" ] || { echo "TRACK not found"; exit 1; }
[ -f "$VINYL_IN" ] || { echo "vinyl_mock_in not found"; exit 1; }
[ -f "$VINYL_OUT" ] || { echo "vinyl_mock_out not found"; exit 1; }

# ──────────────────────
# RPM → rad/s
# ──────────────────────
ROTATE_RAD_PER_SEC=$(echo "scale=6; $RPM * 2 * 3.14159265 / 60" | bc -l)

# ──────────────────────
# FFmpeg
# ──────────────────────
ffmpeg -y \
  -loop 1 -i "$COVER" \
  -i "$VINYL_IN" \
  -i "$VINYL_OUT" \
  -ss "$START_SEC" -i "$TRACK" \
  -t "$DURATION" \
  -filter_complex "
    [0:v]format=rgba,scale=300:300[base];
    [1:v]format=rgba,scale=300:300[vinyl_in];
    [2:v]format=rgba,scale=300:300[vinyl_out];

    [base][vinyl_in]
    blend=all_mode=multiply:all_opacity=1,
    format=rgba
    [composed];

    [composed][vinyl_out]overlay=0:0[final];

    [final]
    rotate=${ROTATE_RAD_PER_SEC}*t:ow=rotw(0):oh=roth(0):c=none,
    crop=300:300,
    setsar=1
    [v]
  " \
  -map "[v]" -map 3:a \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -preset veryslow \
  -c:a aac -b:a 128k \
  "$OUTPUT"