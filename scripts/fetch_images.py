"""
아티스트 사진 주소를 data/bands.json에 채우는 스크립트 (한 번만 실행)
실행:  python scripts/fetch_images.py

- Deezer 공개 API 사용 (키 필요 없음)
- 동명이인을 피하려고, 우리 데이터의 곡이 그 아티스트 이름으로 검색될 때만 같은 아티스트로 인정
- 확인 못 한 아티스트는 사진 없이 둔다 (화면에서 이니셜로 대신 표시)
"""

import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "bands.json")


def get(url):
    with urllib.request.urlopen(url, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(t):
    """비교용: 괄호 내용·공백·기호 제거, 소문자"""
    return re.sub(r"[\s\W_]+", "", re.sub(r"\(.*?\)", "", t)).lower()


def find_image(artist):
    """'아티스트명 + 곡명'으로 곡을 검색해서, 곡 제목과 아티스트 이름이 둘 다 맞을 때만 그 아티스트 사진을 쓴다."""
    # 검색어에서 괄호 부분은 뺀다 (예: "OWALLOIL (오월오일)" → "OWALLOIL")
    names = [re.sub(r"\(.*?\)", "", n).strip() for n in [artist["name"], artist.get("name_en") or ""]]
    names = [n for n in names if n]
    # Deezer 이름이 "Lacuna 라쿠나"처럼 영문+한글로 붙어 있는 경우도 같은 아티스트로 본다
    name_keys = {norm(n) for n in names} | {norm(" ".join(names)), norm(" ".join(reversed(names)))}
    korean = norm(artist["name"])
    best = None
    for song in artist["songs"]:
        for name in names:
            q = urllib.parse.quote(f"{name} {song['title']}")
            for t in get("https://api.deezer.com/search?limit=10&q=" + q).get("data", []):
                if norm(t["title"]).startswith(norm(song["title"])) and norm(t["artist"]["name"]) in name_keys:
                    pic = t["artist"].get("picture_medium")
                    # 한글 이름까지 들어간 Deezer 아티스트가 있으면 그걸 우선 (외국 동명이인 방지)
                    if korean in norm(t["artist"]["name"]):
                        return pic
                    best = best or pic
    if best:
        return best
    # 2차: 곡 제목이 영어로만 등록된 경우가 많아서, 이름이 '정확히' 같은 아티스트를 찾는다
    # (같은 이름이 여럿이면 팬이 가장 많은 쪽 = 그 이름으로 가장 알려진 아티스트)
    matches = []
    for name in names:
        for a in get("https://api.deezer.com/search/artist?limit=5&q=" + urllib.parse.quote(name)).get("data", []):
            if norm(a["name"]) in name_keys and "/artist//" not in a.get("picture_medium", "/artist//"):
                matches.append(a)
    if matches:
        return max(matches, key=lambda a: a.get("nb_fan", 0))["picture_medium"]
    return None


def main():
    d = json.load(open(DATA, encoding="utf-8"))
    for a in d["bands"]:
        if a.get("image"):  # 사진을 이미 찾은 아티스트는 건너뛴다 (새 팀·못 찾은 팀만 검색)
            continue
        try:
            img = find_image(a)
        except Exception as e:
            img = None
            print("오류", a["name"], e)
        a["image"] = img
        print(("✅ " if img else "❌ ") + a["name"])
    json.dump(d, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
