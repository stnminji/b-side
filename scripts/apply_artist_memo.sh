#!/bin/sh
# B-SIDE DB 변경: '아티스트 감상 노트(artist_memos)' 표 추가 (기존 데이터는 건드리지 않음)
# 사용자 승인 후 직접 실행하는 용도
cd "$(dirname "$0")/.." || exit 1
"$LOCALAPPDATA/supabase-cli/supabase.exe" db query --remote --agent no --yes \
  -f supabase/migrations/20261106060000_artist_memos.sql
