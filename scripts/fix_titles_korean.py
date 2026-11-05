"""
숨은 곡 제목을 '원래 한국어 제목'으로 바꾸는 스크립트
실행:  python scripts/fix_titles_korean.py

문제: Deezer는 한국 노래 제목을 영어로 번역해서 올려둔 경우가 있다 (예: 한로로 "__에게" → "To. __")
     → 유튜브 뮤직·멜론에서 보는 제목과 달라서 사용자가 곡을 찾기 어렵다
해결: 모든 음원에는 국제 고유번호(ISRC)가 붙어 있다.
     Deezer 곡의 ISRC로 MusicBrainz(원어 제목을 쓰는 공개 음악 DB)를 조회해 원래 제목을 가져온다.
     이름이 아니라 고유번호로 찾기 때문에 다른 곡과 헷갈리지 않는다.
"""

import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_deep_tracks import DATA, find_artist_id, get, norm  # Deezer 조회 함수는 그대로 재사용

HANGUL = re.compile(r"[가-힣]")


def mb_title(isrc):
    """ISRC로 MusicBrainz에서 곡 제목을 찾는다 (MusicBrainz 규칙: 1초에 1번만 요청)"""
    time.sleep(1.1)
    req = urllib.request.Request(f"https://musicbrainz.org/ws/2/isrc/{isrc}?fmt=json",
                                 headers={"User-Agent": "B-SIDE/1.0 (hackathon demo)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            recs = json.loads(r.read().decode("utf-8")).get("recordings", [])
    except Exception:
        return None  # MusicBrainz에 없는 곡이면 그대로 둔다
    titles = [x["title"] for x in recs]
    # 한글이 들어간 제목이 있으면 그걸 우선 (원래 한국어 제목)
    return next((t for t in titles if HANGUL.search(t)), titles[0] if titles else None)


def main():
    d = json.load(open(DATA, encoding="utf-8"))
    changed = 0
    for a in d["bands"]:
        deep = a.get("deep_songs") or []
        # 이미 한글 제목이면 고칠 필요가 없다 → 영어 제목만 확인
        targets = {norm(t): t for t in deep if not HANGUL.search(t)}
        if not targets:
            continue
        aid = find_artist_id(a)
        if not aid:
            continue
        # 그 아티스트의 앨범 수록곡에서 숨은 곡을 찾아 ISRC를 얻는다
        for album in get(f"https://api.deezer.com/artist/{aid}/albums?limit=40").get("data", []):
            if not targets:
                break
            for t in get(f"https://api.deezer.com/album/{album['id']}/tracks?limit=50").get("data", []):
                key = norm(t["title"])
                if key not in targets:
                    continue
                old = targets.pop(key)
                isrc = get(f"https://api.deezer.com/track/{t['id']}").get("isrc")
                new = mb_title(isrc) if isrc else None
                # 원래 제목이 한국어일 때만 바꾼다 (원래 영어 제목인 곡은 그대로)
                if new and HANGUL.search(new) and new != old:
                    deep[deep.index(old)] = new
                    changed += 1
                    print(f"  {a['name']}: {old} → {new}", flush=True)
        json.dump(d, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=2)  # 중간 저장
    print(f"끝: {changed}곡 제목을 한국어로 바꿈")


if __name__ == "__main__":
    main()
