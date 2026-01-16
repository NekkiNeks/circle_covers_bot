#!/bin/bash

# Аргументы
COVER="$1"        # путь к изображению
TRACK="$2"        # путь к аудио
OUTPUT="$3"       # путь к выходному видео
DURATION="${4:-30}" # длительность видео в секундах
START_SEC="${5:-0}" # с какой секунды воспроизводить аудио (по умолчанию 0)
RPM="${6:-10}"      # скорость вращения в об/мин

# Конвертируем RPM в rad/s для ffmpeg
ROTATE_RAD_PER_SEC=$(echo "scale=6; $RPM * 2 * 3.14159265 / 60" | bc -l)

ffmpeg -y \
  -loop 1 -i "$COVER" \
  -ss "$START_SEC" -i "$TRACK" \
  -t "$DURATION" \
  -filter_complex "
    [0:v]format=rgba,
    rotate=${ROTATE_RAD_PER_SEC}*t:ow=rotw(0):oh=roth(0):c=none,
    scale=300:300,
    crop=300:300,
    setsar=1
    [v]
  " \
  -map "[v]" -map 1:a \
  -c:v libx264 -crf 23 -preset veryslow -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  "$OUTPUT"