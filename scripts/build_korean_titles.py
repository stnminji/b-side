"""
결 인디 아티스트 곡의 '원래 한국어 제목' 표 만들기
실행:  python scripts/build_korean_titles.py   →  data/korean_titles.json

문제: Deezer에는 한국 곡이 영어 제목으로 등록된 경우가 많다 (예: 우효 '민들레' → 'Dandelion (full ver.)')
방법 (AI 추측 없이, 두 음악 DB를 대조):
  1) 같은 아티스트의 Deezer 곡과 MusicBrainz 녹음을 모두 모은다
  2) 국제 음원 코드(ISRC)가 같으면 같은 곡  → MusicBrainz의 한국어 제목 사용
  3) ISRC가 없으면 '곡 길이'가 ±2초 안에서 딱 한 곡만 맞을 때만 같은 곡으로 본다
     (비슷한 길이의 곡이 둘 이상이면 헷갈리므로 바꾸지 않는다)
  4) (검증) 길이로만 맞춘 것은 두 번 거른다
     - 서로 다른 영어 제목 여러 곡이 같은 한국어 제목에 붙으면 → 모두 버림 (헷갈림)
     - AI에게 "이 영어 제목과 한국어 제목이 같은 곡의 번역·음역일 수 있나?"만 물어서 아니면 버림
     (ISRC로 맞춘 것은 정확하므로 그대로 둔다. 애매하면 영어 제목을 그대로 두는 쪽을 택함)
결과: { "Deezer 곡 번호": "한국어 제목" }  → 서버가 화면에 보여 줄 때 이 표로 바꾼다
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
OUT = os.path.join(ROOT, "data", "korean_titles.json")
HANGUL = re.compile(r"[가-힣]")
UA = {"User-Agent": "Gyeol/1.0 (hackathon demo; indie music)"}


def get(url, mb=False):
    time.sleep(1.1 if mb else 0.12)  # MusicBrainz는 1초에 1번, Deezer는 5초에 50번까지
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(t):
    return re.sub(r"[\s\W_]+", "", re.sub(r"\(.*?\)", "", t or "")).lower()


def deezer_artist(a):
    """우리 목록의 이름(한글·영문)과 정확히 같은 Deezer 프로필 중 팬이 가장 많은 것"""
    names = [a["name"]] + [x for x in re.split(r"[()/,]", a.get("name_en") or "") if x.strip()]
    keys = {norm(n) for n in names}
    best = None
    for n in names:
        for c in get("https://api.deezer.com/search/artist?limit=5&q=" + urllib.parse.quote(n)).get("data", []):
            if norm(c["name"]) in keys and (not best or c.get("nb_fan", 0) > best.get("nb_fan", 0)):
                best = c
    return best


def deezer_tracks(aid):
    tracks = {}
    for al in get(f"https://api.deezer.com/artist/{aid}/albums?limit=50").get("data", []):
        for t in get(f"https://api.deezer.com/album/{al['id']}/tracks?limit=100").get("data", []):
            if t.get("artist", {}).get("id") == aid and not HANGUL.search(t["title"]):
                tracks[t["id"]] = {"title": t["title"], "duration": t.get("duration", 0), "isrc": (t.get("isrc") or "").upper()}
    return tracks


def mb_recordings(a):
    found = get("https://musicbrainz.org/ws/2/artist/?fmt=json&limit=3&query=" + urllib.parse.quote(f'artist:"{a["name"]}"'), mb=True)
    cand = [x for x in found.get("artists", []) if norm(x["name"]) == norm(a["name"]) or x.get("country") == "KR"]
    if not cand:
        return []
    mbid, recs, offset = cand[0]["id"], [], 0
    while offset < 400:
        page = get(f"https://musicbrainz.org/ws/2/recording?fmt=json&limit=100&offset={offset}&inc=isrcs&artist={mbid}", mb=True)
        recs += page.get("recordings", [])
        offset += 100
        if offset >= page.get("recording-count", 0):
            break
    return [r for r in recs if HANGUL.search(r.get("title", ""))]


def base(t):
    return norm(re.sub(r"\s*[\(\[].*?[\)\]]", "", t))


def verify_guesses(guess):
    """길이로만 맞춘 후보 검증: ① 충돌 제거 ② AI 번역·음역 확인. 통과한 것만 {곡 번호: 한국어 제목}"""
    # ① 같은 한국어 제목에 서로 다른 영어 제목이 붙으면 모두 버림
    by_ko = {}
    for tid, (en, ko) in guess.items():
        by_ko.setdefault(ko, set()).add(base(en))
    guess = {tid: v for tid, v in guess.items() if len(by_ko[v[1]]) == 1}
    if not guess:
        return {}
    # ② AI에게 '같은 곡의 번역·음역으로 볼 수 있는지'만 묻는다 (새 제목을 만들게 하지 않음)
    sys.path.insert(0, os.path.join(ROOT, "api"))
    import gemini  # 서버와 같은 Gemini 호출 함수 재사용
    pairs = list({(en, ko) for en, ko in guess.values()})
    prompt = ("아래는 같은 한국 인디 아티스트의 곡 제목 쌍이다. 영어 제목이 한국어 제목의 번역이나 음역(또는 그 반대)으로 "
              "자연스럽게 볼 수 있으면 true, 뜻이 전혀 다르면 false. 확실하지 않으면 false.\n"
              'JSON으로만: {"ok": [true, false, ...]}  (순서 그대로)\n\n'
              + "\n".join(f"{i}. {en} ↔ {ko}" for i, (en, ko) in enumerate(pairs)))
    try:
        ok = gemini.call_gemini([{"text": prompt}]).get("ok", [])
    except Exception as e:
        print("   AI 확인 실패 → 길이 추정은 모두 버림:", e, flush=True)
        return {}
    good = {pairs[i] for i, v in enumerate(ok[:len(pairs)]) if v is True}
    return {tid: ko for tid, (en, ko) in guess.items() if (en, ko) in good}


def main():
    artists = json.load(open(DATA, encoding="utf-8"))["bands"]
    table = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    for i, a in enumerate(artists, 1):
        try:
            d = deezer_artist(a)
            if not d:
                print(f"[{i}] {a['name']}: Deezer 없음", flush=True)
                continue
            tracks = deezer_tracks(d["id"])
            if not tracks:
                print(f"[{i}] {a['name']}: 영어 제목 곡 없음", flush=True)
                continue
            recs = mb_recordings(a)
            by_isrc = {i_.upper(): r["title"] for r in recs for i_ in r.get("isrcs", [])}
            exact, guess = {}, {}
            for tid, t in tracks.items():
                title = by_isrc.get(t["isrc"]) if t["isrc"] else None
                if title:
                    exact[str(tid)] = title
                elif t["duration"]:
                    # 길이 ±2초 안에 한글 제목 녹음이 '딱 하나'일 때만 후보로 (버전 표기만 다른 같은 제목은 하나로 봄)
                    near = {re.sub(r"\s*\(.*?\)\s*$", "", r["title"]) for r in recs
                            if r.get("length") and abs(r["length"] / 1000 - t["duration"]) <= 2}
                    if len(near) == 1:
                        guess[str(tid)] = (t["title"], near.pop())
            guess = verify_guesses(guess)
            table.update(exact)
            table.update(guess)
            n = len(exact) + len(guess)
            print(f"[{i}] {a['name']}: 영어 제목 {len(tracks)}곡 중 {n}곡 한국어 제목 찾음", flush=True)
        except Exception as e:
            print(f"[{i}] {a['name']}: 오류 {e}", flush=True)
        json.dump(table, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)  # 중간 저장
    print(f"끝: 총 {len(table)}곡", flush=True)


if __name__ == "__main__":
    # .env의 GEMINI_API_KEY를 읽어 둔다 (AI 확인용)
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    main()
