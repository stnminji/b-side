"""
결 큐레이션 대표곡(한국어 원제)의 음악 DB 곡 번호를 미리 찾아 저장
실행:  python scripts/build_featured_ids.py   →  data/featured_ids.json

문제: 대표곡은 한국어 원제로 정리돼 있는데, Deezer에는 영어·로마자 제목으로 등록된 경우가 많아
     이름으로 찾으면 못 찾거나(정확 일치 실패) 엉뚱한 곡을 잡을 수 있다.
방법:
  1) Deezer에서 '아티스트 + 한국어 제목'으로 검색 → 그 아티스트의 곡만 후보로 (상위 3개)
  2) 제목이 그대로 같으면 확정
  3) 다르면 AI에게 "후보 제목이 이 한국어 제목과 같은 곡(번역·음역·같은 제목)인가?"만 묻는다 → 맞을 때만 저장
     (AI가 제목을 새로 만들게 하지 않음. 애매하면 저장하지 않음)
결과: { "아티스트|한국어 제목(비교용)": Deezer 곡 번호 }
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))
OUT = os.path.join(ROOT, "data", "featured_ids.json")


def get(url):
    time.sleep(0.15)  # Deezer 요청 제한 지키기
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Gyeol/1.0"}), timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(t):
    return re.sub(r"[\s\W_]+", "", re.sub(r"\s*[\(\[（].*?[\)\]）]", "", t or "")).lower()


def main():
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
    import gemini  # 서버와 같은 함수 재사용
    artists = gemini.load_artists()
    out = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    for i, a in enumerate(artists, 1):
        names = [a["name"]] + gemini.re_split_names(a.get("name_en") or "")
        keys = {norm(n) for n in names}
        exact, ask = 0, []
        for s in a["songs"]:
            key = norm(a["name"]) + "|" + norm(s["title"])
            if key in out:
                continue
            try:
                hits = get("https://api.deezer.com/search?limit=25&q=" + urllib.parse.quote(f"{a['name']} {s['title']}")).get("data", [])
            except Exception:
                continue
            mine = [t for t in hits if norm(t["artist"]["name"]) in keys][:3]
            same = [t for t in mine if norm(t["title"]) == norm(s["title"]) and norm(t["title"])]
            if same:
                out[key] = same[0]["id"]
                exact += 1
                continue
            # 제목만 검색: Deezer가 한국어 원제를 내부적으로 알고 있으면 이 아티스트의 곡이 나온다
            # (그 아티스트 곡이 '딱 한 곡'(버전 차이만)일 때만 확정 → 엉뚱한 곡 방지)
            try:
                only = get("https://api.deezer.com/search?limit=25&q=" + urllib.parse.quote(s["title"])).get("data", [])
            except Exception:
                only = []
            only = [t for t in only if norm(t["artist"]["name"]) in keys]
            bases = {norm(t["title"]) for t in only if norm(t["title"])}
            if len(bases) == 1:
                out[key] = only[0]["id"]
                exact += 1
            elif mine:
                ask.append((key, s["title"], mine))
        # 제목이 다른 후보는 AI에게 '같은 곡인지'만 확인 (한 아티스트당 한 번)
        if ask:
            lines = []
            for n, (key, ko, cands) in enumerate(ask):
                for m, t in enumerate(cands):
                    lines.append(f"{n}-{m}. 한국어 '{ko}' ↔ 음악DB '{t['title']}'")
            prompt = ("아래는 같은 한국 인디 아티스트의 곡 제목 쌍이다. 음악DB 제목이 한국어 제목과 '같은 곡'(번역·로마자 표기·같은 제목+버전 표기)이면 true. "
                      "다른 곡이거나 확실하지 않으면 false.\n"
                      'JSON으로만: {"same": {"0-0": true, ...}}\n\n' + "\n".join(lines))
            try:
                same = gemini.call_gemini([{"text": prompt}]).get("same", {})
            except Exception as e:
                print("   AI 확인 실패:", e, flush=True)
                same = {}
            for n, (key, ko, cands) in enumerate(ask):
                for m, t in enumerate(cands):
                    if same.get(f"{n}-{m}") is True:
                        out[key] = t["id"]
                        break
        found = sum(1 for s in a["songs"] if norm(a["name"]) + "|" + norm(s["title"]) in out)
        print(f"[{i}] {a['name']}: 대표곡 {len(a['songs'])}곡 중 {found}곡 곡 번호 확보", flush=True)
        json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"끝: {len(out)}곡", flush=True)


if __name__ == "__main__":
    main()
