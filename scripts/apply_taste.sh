#!/bin/sh
# B-SIDE DB 변경 ②: '감상 결(taste_profiles)' 표 추가 (기존 데이터는 건드리지 않음)
# 사용자 승인 후 직접 실행하는 용도
cd "$(dirname "$0")/.." || exit 1
"$LOCALAPPDATA/supabase-cli/supabase.exe" db query --remote --agent no --yes \
  -f supabase/migrations/20261106050000_taste_profiles.sql
