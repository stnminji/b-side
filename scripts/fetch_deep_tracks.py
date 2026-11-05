"""
아티스트마다 '숨은 곡(인기곡이 아닌 수록곡)'을 data/bands.json에 채우는 스크립트
실행:  python scripts/fetch_deep_tracks.py

- Deezer 공개 API에서 그 아티스트의 앨범 수록곡을 가져온다 → 실제로 있는 곡만 들어감 (환각 없음)
- 이미 있는 대표곡(songs)과 겹치는 곡, Inst/MR/Remix 같은 버전 곡은 뺀다
- 아티스트 확인 방식은 사진 스크립트와 같다 (대표곡 제목 + 아티스트 이름이 모두 맞아야 인정)
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "bands.json")
MAX_DEEP = 10
SKIP = re.compile(r"(inst|mr\b|remix|ver\.|version|live|acoustic|demo|intro|outro|interlude|sped up|edit)", re.I)


def get(url):
    time.sleep(0.12)  # Deezer 요청 제한(5초에 50회) 지키기
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(t):
    return re.sub(r"[\s\W_]+", "", re.sub(r"\(.*?\)", "", t)).lower()


def find_artist_id(artist):
    names = [artist["name"]] + ([artist["name_en"]] if artist.get("name_en") else [])
    keys = {norm(n) for n in names}
    for song in artist["songs"]:
        for name in names:
            q = urllib.parse.quote(f"{name} {song['title']}")
            for t in get("https://api.deezer.com/search?limit=10&q=" + q).get("data", []):
                if norm(t["title"]).startswith(norm(song["title"])) and norm(t["artist"]["name"]) in keys:
                    return t["artist"]["id"]
    return None


def deep_tracks(artist, artist_id):
    known = {norm(s["title"]) for s in artist["songs"]}
    seen, result = set(), []
    albums = get(f"https://api.deezer.com/artist/{artist_id}/albums?limit=40").get("data", [])
    for album in albums:
        for t in get(f"https://api.deezer.com/album/{album['id']}/tracks?limit=50").get("data", []):
            title = t["title"].strip()
            key = norm(title)
            if t.get("artist", {}).get("id") != artist_id or not key or key in known or key in seen or SKIP.search(title):
                continue
            seen.add(key)
            result.append(title)
    # 너무 많으면 앞(최신 앨범)과 뒤(옛 앨범)에서 고르게 뽑는다
    if len(result) > MAX_DEEP:
        step = len(result) / MAX_DEEP
        result = [result[int(i * step)] for i in range(MAX_DEEP)]
    return result


def main():
    d = json.load(open(DATA, encoding="utf-8"))
    for a in d["bands"]:
        if "deep_songs" in a and "--all" not in sys.argv:
            continue
        try:
            aid = find_artist_id(a)
            a["deep_songs"] = deep_tracks(a, aid) if aid else []
        except Exception as e:
            print("오류", a["name"], e)
            continue
        print(f'{a["name"]}: {len(a["deep_songs"])}곡', flush=True)
        json.dump(d, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=2)  # 중간 저장


if __name__ == "__main__":
    main()
