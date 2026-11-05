"""
B-SIDE - AI 서버 함수 (Vercel Python 함수 / 로컬에서는 dev_server.py가 사용)

API 키는 여기 서버에서만 사용한다. 브라우저(app.js)는 키를 모른다.
요청 형식 (POST /api/gemini, JSON):
  { "action": "extract",   "image": "<base64>", "mime": "image/jpeg" }  → 캡처에서 곡 목록 읽기
  { "action": "recommend", "query": "보수동쿨러 같은 밴드" }            → 취향 분석 + 추천
  추천 = 우리 데이터 + AI가 아는 실존 아티스트. 데이터 밖 아티스트는 Deezer로 실존을 검사한다.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.path.join(ROOT, "data", "bands.json")

# 모델 이름은 환경변수로 바꿀 수 있다 (Google AI Studio에서 쓸 수 있는 모델 확인)
DEFAULT_MODEL = "gemini-flash-lite-latest"  # 측정상 가장 빠름 (약 2초)
# 기본 모델이 바쁠 때 차례로 시도하는 예비 모델들 (scripts/list_models.py로 확인한 이름)
FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-flash-lite-latest", "gemini-3.6-flash"]
TIME_BUDGET = 50  # 초. 이 시간을 넘기면 더 시도하지 않는다 (배포 서버 제한 60초)


def load_artists():
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)["bands"]


class GeminiError(RuntimeError):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def _post(model, body, api_key, timeout):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except (TimeoutError, urllib.error.URLError) as e:
        if isinstance(e, urllib.error.HTTPError):
            detail = e.read().decode("utf-8", errors="ignore")[:300]
            raise GeminiError(e.code, f"Gemini API 오류 ({e.code}, {model}): {detail}")
        raise GeminiError(504, f"Gemini 응답이 너무 늦어요 ({model})")


def call_gemini(parts, models=None, budget=TIME_BUDGET):
    """Gemini API를 호출하고, 응답 글(JSON 문자열)을 파이썬 객체로 바꿔서 돌려준다."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not api_key.isascii() or "여기에" in api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되지 않았어요. .env 파일에 키를 붙여넣었는지 확인하세요.")

    # 모델이 바쁘거나(503/429) 너무 늦으면 다음 예비 모델로 넘어간다
    data, last_error, start = None, None, time.time()
    for model in models or [os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)] + FALLBACK_MODELS:
        config = {"responseMimeType": "application/json", "temperature": 0.7}
        if "lite" not in model:
            # AI의 '생각하는 시간'을 끈다 → 약 40초에서 5초로 빨라짐 (lite 모델은 이 설정을 지원하지 않음)
            config["thinkingConfig"] = {"thinkingBudget": 0}
        body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
        remaining = budget - (time.time() - start)
        if remaining < 5:
            break
        try:
            data = _post(model, body, api_key, timeout=min(15, remaining))  # 한 모델당 최대 15초
            break
        except GeminiError as e:
            last_error = e
            if e.code in (400, 401, 403):  # 키 문제 등은 다른 모델로 바꿔도 안 되므로 바로 멈춘다
                raise
    if not data:
        raise last_error or GeminiError(504, "AI가 지금 바빠요. 잠시 후 다시 시도해 주세요.")

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


# ---------- 1) 캡처 읽기 (아티스트 목록 / 노래 목록) ----------
EXTRACT_PROMPTS = {
    "songs": """이 이미지는 음원 앱(멜론, 스포티파이, 유튜브 뮤직, 애플뮤직 등)의 플레이리스트 화면 캡처다.
화면에 보이는 곡의 아티스트와 곡 제목을 위에서부터 순서대로 읽어라.
- 화면에 실제로 보이는 글자만 적고, 추측해서 채우지 마라.
- 플레이리스트가 아니면 빈 목록을 돌려줘라.
JSON 형식으로만 답하라: {"items": [{"artist": "아티스트", "title": "곡 제목"}]}""",
    "artists": """이 이미지는 음원 앱의 '좋아하는 아티스트' 또는 '팔로우한 아티스트' 화면 캡처다.
화면에 보이는 아티스트 이름을 위에서부터 순서대로 읽어라.
- 화면에 실제로 보이는 글자만 적고, 추측해서 채우지 마라.
- 노래 목록 화면이면 곡의 아티스트 이름만 중복 없이 뽑아라.
- 아티스트 목록이 아니면 빈 목록을 돌려줘라.
JSON 형식으로만 답하라: {"items": [{"artist": "아티스트"}]}""",
}


def extract(payload):
    image = payload.get("image")
    if not image:
        raise ValueError("이미지가 없어요.")
    kind = payload.get("kind") if payload.get("kind") in EXTRACT_PROMPTS else "songs"
    # 사진 읽기는 lite 모델이 빠르고 정확함 (측정: 약 2초). 기본 모델은 이미지에서 40초 넘게 걸림
    result = call_gemini([
        {"text": EXTRACT_PROMPTS[kind]},
        {"inline_data": {"mime_type": payload.get("mime", "image/jpeg"), "data": image}},
    ], models=["gemini-flash-lite-latest", "gemini-flash-lite-latest", "gemini-3.6-flash"])
    items = []
    for it in result.get("items", []):
        artist, title = (it.get("artist") or "").strip(), (it.get("title") or "").strip()
        text = artist if kind == "artists" else f"{artist} - {title}".strip(" -")
        if text and text not in items:
            items.append(text)
    print(f"[사진 읽기] {kind}: {len(items)}개", flush=True)
    return {"items": items}


# ---------- 2) 취향 분석 + 추천 ----------
RECOMMEND_PROMPT = """너는 한국 인디 음악을 잘 아는 큐레이터다.
사용자가 좋아하는 음악(아티스트명, 곡 목록, 분위기 설명 등)을 보고 취향을 분석한 뒤,
사용자에게 맞는 한국 인디 아티스트(밴드·솔로) 후보 6팀을 골라라.

규칙:
0. 한국 아티스트만 추천한다. 해외 아티스트는 절대 추천하지 않는다.
1. [아티스트 목록]은 우리가 직접 정리한 아티스트다. 목록 안에서 3팀, 네가 확실히 아는 실존 한국 인디 아티스트를 목록 밖에서 3팀 골라 새로운 발견을 돕는다. 각각 잘 맞는 순서대로 쓴다.
2. 목록 안 아티스트의 노래는 hidden(숨은 곡) 또는 popular(대표곡)에 있는 제목만 그대로 쓴다. 목록 밖 아티스트는 실제로 발표된 곡 제목만 정확한 표기로 쓴다. 확실하지 않은 아티스트·곡은 고르지 않는다. (서버가 음악 데이터베이스로 실존 여부를 검사해서 틀린 것은 버린다)
3. 사용자가 입력에서 직접 언급한 아티스트와 [이미 추천한 아티스트]는 추천에서 뺀다.
4. 사용자가 말한 아티스트가 목록에 없으면 [조회한 아티스트 정보](장르, 곡 제목, 비슷한 아티스트)로 그 아티스트의 결을 파악한다. 목록 안의 다른 아티스트와 같은 팀으로 착각하지 않는다. 정보가 부족하면 아는 척하지 말고 summary에 솔직히 쓴 뒤 다른 단서로 추천한다.
5. 글은 짧고 간결하게, 친근한 존댓말로 쓴다.
   - reason: 취향과 무엇이 닮았는지 한 문장 (40자 이내)
   - genre: 장르 (15자 이내)
   - point: 이 곡을 들어야 하는 이유 (20자 이내)
   - summary: 사용자 취향 분석 한 문장 (50자 이내)
6. 이 서비스의 목적은 디깅(숨은 음악 발견)이다. 노래는 아티스트당 2~3곡, hidden(숨은 곡)에서 먼저 고르고 popular(대표곡)는 최대 1곡만 쓴다. hidden이 비어 있으면 popular에서 고른다. 가장 추천하는 곡을 첫 번째에 둔다.
7. tags는 취향 키워드 4~5개(#으로 시작, 짧은 단어).

[이번 추천 방식]
{mode_guide}

JSON 형식으로만 답하라:
{"summary": "...", "tags": ["#..."], "bands": [{"name": "아티스트 이름 (목록에 있으면 목록 표기 그대로)", "genre": "...", "reason": "...", "songs": [{"title": "정확한 곡 제목", "point": "..."}]}]}

[아티스트 목록]
{artists}

[조회한 아티스트 정보] (목록에 없는 아티스트를 음악 데이터베이스에서 확인한 내용. 추천은 여전히 목록 안에서만)
{research}

[이미 추천한 아티스트]
{exclude}

[사용자 입력]
{query}"""


# ---------- 2-1) 목록에 없는 아티스트는 공개 음악 데이터에서 찾아보기 ----------
# Google 검색 연동은 무료 키로 쓸 수 없어서(429), 키 없이 쓰는 Deezer·MusicBrainz를 조회한다.
NAMES_PROMPT = """아래 [사용자 입력]에서 음악 아티스트(밴드·가수) 이름만 뽑아라. 곡 제목이나 분위기 단어는 빼라.
JSON 형식으로만 답하라: {"artists": ["이름"]}

[사용자 입력]
"""

# 분위기·장면처럼 아티스트 이름이 나오지 않는 방식은 조회를 건너뛴다 (속도)
SEARCH_MODES = {"band", "song", "free", "photo_artists", "photo_songs"}


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "B-SIDE/1.0 (hackathon demo)"})
    with urllib.request.urlopen(req, timeout=6) as res:
        return json.loads(res.read().decode("utf-8"))


def lookup_artist(name):
    """아티스트 한 팀의 실제 정보(장르, 앨범, 곡, 비슷한 아티스트)를 모아 한 줄로 만든다."""
    q = urllib.parse.quote(name)
    info = []
    # MusicBrainz: 국적, 정식 이름/설명, 장르 태그
    try:
        mb = _get_json(f"https://musicbrainz.org/ws/2/artist/?fmt=json&limit=1&query=artist:{q}")["artists"]
        if mb and mb[0]["name"].lower() == name.lower():
            a = mb[0]
            tags = [t["name"] for t in a.get("tags", [])][:5]
            info += [x for x in [a.get("country"), a.get("disambiguation"), ", ".join(tags)] if x]
    except Exception:
        pass
    # Deezer: 앨범 장르, 곡 제목, 비슷한 아티스트 (이름이 정확히 같을 때만 사용 → 동명이인 방지)
    try:
        found = [a for a in _get_json(f"https://api.deezer.com/search/artist?q={q}")["data"]
                 if a["name"].lower() == name.lower()]
        if found:
            aid = found[0]["id"]
            related = [a["name"] for a in _get_json(f"https://api.deezer.com/artist/{aid}/related")["data"][:6]]
            genres, titles = [], []
            for al in _get_json(f"https://api.deezer.com/artist/{aid}/albums")["data"][:2]:
                d = _get_json(f"https://api.deezer.com/album/{al['id']}")
                genres += [g["name"] for g in d.get("genres", {}).get("data", [])]
                titles += [t["title"] for t in d["tracks"]["data"][:5]]
            if genres:
                info.append("장르 " + ", ".join(dict.fromkeys(genres)))
            if titles:
                info.append("곡 " + ", ".join(titles[:8]))
            if related:
                info.append("비슷한 아티스트 " + ", ".join(related))
    except Exception:
        pass
    return f"{name}: " + (" / ".join(info) if info else "정보 없음")


def research(query, artists):
    """입력 속 아티스트 중 데이터에 없는 팀만 조회한다. 실패해도 추천은 계속한다."""
    known = {n.lower() for a in artists for n in (a["name"], a.get("name_en", "")) if n}
    try:
        names = call_gemini([{"text": NAMES_PROMPT + query}], budget=10,
                            models=["gemini-flash-lite-latest", "gemini-3.6-flash"]).get("artists", [])
    except Exception as e:
        print(f"[아티스트 조회] 이름 찾기 실패: {e}", flush=True)
        return ""
    unknown = [n.strip() for n in names if n.strip() and n.strip().lower() not in known][:3]
    lines = [lookup_artist(n) for n in unknown]
    print(f"[아티스트 조회] {lines}", flush=True)
    return "\n".join(lines)  # 한 팀당 한 줄


# 추천 방식마다 AI에게 주는 추가 지시
MODE_GUIDES = {
    "mood": "사용자가 고른 분위기 키워드에 가장 잘 맞는 아티스트와 곡을 고른다. 노래마다 point에 그 분위기가 어떻게 느껴지는지 쓴다.",
    "band": "사용자가 좋아하는 아티스트와 사운드·분위기가 닮은 아티스트를 고른다. reason에 그 아티스트와 무엇이 닮았는지 구체적으로 쓴다.",
    "song": "사용자가 좋아하는 노래 한 곡과 비슷한 결의 '노래'를 찾는 것이 목적이다. 그 곡과 가장 닮은 곡을 각 아티스트의 첫 번째 노래로 두고, point에 원곡과 무엇이 닮았는지 쓴다.",
    "feel": "사용자가 말한 장면·영화·계절·장소의 느낌을 음악으로 옮긴다면 어떤 소리일지 먼저 상상하고, 그 느낌에 맞는 아티스트와 곡을 고른다. summary에 그 느낌을 어떤 사운드로 해석했는지 쓴다.",
    "free": "사용자의 자유로운 설명에서 상황, 기분, 원하는 사운드를 읽어내 추천한다.",
    "photo_artists": "사용자가 좋아하는 아티스트 목록(캡처에서 읽음)을 보고 공통된 취향을 분석한 뒤, 그 취향에 맞는 아티스트를 고른다.",
    "photo_songs": "사용자의 플레이리스트(캡처에서 읽음)를 보고 공통된 취향을 분석한 뒤, 그 플레이리스트에 이어 들으면 좋을 아티스트와 곡을 고른다.",
}


def recommend(payload):
    query = (payload.get("query") or "").strip()
    if not query:
        raise ValueError("입력이 비어 있어요.")
    query = query[:2000]  # 너무 긴 입력은 자른다
    # '더 찾아보기'를 누르면 이미 보여준 아티스트 이름이 온다 → 이번엔 빼고 추천
    exclude = [str(n)[:40] for n in (payload.get("exclude") or [])][:40]

    artists = load_artists()
    # AI에게 줄 목록은 필요한 정보만 간단하게 (출처 등은 뺀다)
    brief = [
        {"name": a["name"], "type": a["type"], "genre": a["genre"], "mood": a["mood"],
         "sound": a["sound"], "popular": [s["title"] for s in a["songs"]], "hidden": a.get("deep_songs", [])}
        for a in artists
    ]
    # 목록에 없는 아티스트가 나오면 공개 음악 데이터에서 먼저 알아본다
    found = research(query, artists) if payload.get("mode") in SEARCH_MODES else ""
    # 사용자 입력({query})은 맨 마지막에 넣는다 (입력 안의 글자가 다른 칸을 바꾸지 못하게)
    prompt = (RECOMMEND_PROMPT
              .replace("{mode_guide}", MODE_GUIDES.get(payload.get("mode"), MODE_GUIDES["free"]))
              .replace("{artists}", json.dumps(brief, ensure_ascii=False))
              .replace("{research}", found or "없음")
              .replace("{exclude}", ", ".join(exclude) or "없음")
              .replace("{query}", query))
    result = call_gemini([{"text": prompt}])

    # --- 환각 방지 검사 ---
    # 목록 안 아티스트: 우리 데이터의 곡인지 확인 / 목록 밖 아티스트: Deezer에 실제로 있는지 확인
    by_name = {a["name"]: a for a in artists}
    mentioned = query.lower()
    skip = {n.lower() for n in exclude}
    candidates = [b for b in result.get("bands", [])
                  if b.get("name") and b["name"].lower() not in mentioned and b["name"].lower() not in skip]
    with ThreadPoolExecutor(max_workers=5) as pool:  # 여러 아티스트를 동시에 확인해서 빠르게
        checked = list(pool.map(lambda b: check_known(b, by_name[b["name"]]) if b["name"] in by_name else check_outside(b), candidates))
    # 결과 3팀 = 우리 데이터 2팀 + AI가 새로 찾은 팀 1팀을 번갈아 (한쪽이 모자라면 다른 쪽으로 채움)
    known = [b for b in checked if b and not b.get("discovered")]
    found_new = [b for b in checked if b and b.get("discovered")]
    bands = []
    while (known or found_new) and len(bands) < 3:
        for group in (known, found_new, known):
            if group and len(bands) < 3:
                bands.append(group.pop(0))

    if not bands:
        raise RuntimeError("AI가 실제로 있는 아티스트를 찾지 못했어요.")
    return {"summary": result.get("summary", ""), "tags": result.get("tags", [])[:6], "bands": bands}


def check_known(b, a):
    """우리 데이터에 있는 아티스트: 곡 제목이 데이터에 있는 것만 남긴다."""
    hidden = set(a.get("deep_songs", []))
    real_titles = {s["title"] for s in a["songs"]} | hidden
    songs = [{**s, "hidden": s["title"] in hidden} for s in b.get("songs", []) if s.get("title") in real_titles]
    if not songs:  # 곡이 전부 틀렸으면 데이터의 대표곡으로 대신한다
        songs = [{"title": s["title"], "point": s.get("note", "")} for s in a["songs"][:2]]
    return {"name": a["name"], "genre": a["genre"], "image": a.get("image"),
            "reason": b.get("reason", ""), "songs": songs[:3]}


def _norm(t):
    """비교용: 괄호·공백·기호를 빼고 소문자로"""
    return re.sub(r"[\s\W_]+", "", re.sub(r"\(.*?\)", "", t or "")).lower()


def korean_title(track):
    """Deezer가 한국 노래 제목을 영어로 번역해 둔 경우가 있다 (예: "__에게" → "To. __").
    곡 고유번호(ISRC)로 MusicBrainz를 조회해 원래 한국어 제목을 찾는다. 실패하면 Deezer 제목 그대로."""
    title = track["title"]
    if re.search(r"[가-힣]", title):
        return title
    try:
        isrc = _get_json(f"https://api.deezer.com/track/{track['id']}").get("isrc")
        recs = _get_json(f"https://musicbrainz.org/ws/2/isrc/{isrc}?fmt=json").get("recordings", []) if isrc else []
        return next((r["title"] for r in recs if re.search(r"[가-힣]", r["title"])), title)
    except Exception:
        return title


def check_outside(b):
    """데이터 밖 아티스트: Deezer에서 '아티스트 + 곡'을 검색해 둘 다 실제로 맞는 곡만 남긴다.
    한 곡도 확인되지 않으면 AI가 지어냈을 수 있으므로 아티스트째 버린다."""
    songs, image = [], None
    # Deezer에는 영어 이름으로 등록된 경우가 많다 (예: 가을방학 → Autumn Vacation)
    # 그래서 한글 이름으로 아티스트를 먼저 찾고, 이름 대신 아티스트 번호(id)로 비교한다
    try:
        hit = _get_json(f"https://api.deezer.com/search/artist?limit=1&q={urllib.parse.quote(b['name'])}").get("data", [])
        artist_id = hit[0]["id"] if hit else None
    except Exception:
        artist_id = None
    for s in b.get("songs", [])[:3]:
        try:
            q = urllib.parse.quote(f"{b['name']} {s.get('title', '')}")
            hits = _get_json(f"https://api.deezer.com/search?limit=10&q={q}").get("data", [])
        except Exception:
            continue
        for t in hits:
            a_name, b_name = _norm(t["artist"]["name"]), _norm(b["name"])
            artist_ok = t["artist"]["id"] == artist_id or (b_name and (b_name in a_name or a_name in b_name))
            if artist_ok and _norm(t["title"]).startswith(_norm(s.get("title"))):
                songs.append({"title": t["title"], "point": s.get("point", ""), "hidden": False})
                image = image or t["artist"].get("picture_medium")
                break
    if not songs and artist_id:
        # 2차 확인: AI가 쓴 곡 제목 표기가 달라 못 찾았을 수 있다.
        # 한글 이름만으로 곡을 검색했을 때 바로 그 아티스트의 곡이 나오면 실존으로 보고, 그 실제 곡을 쓴다
        try:
            hits = _get_json(f"https://api.deezer.com/search?limit=10&q={urllib.parse.quote(b['name'])}").get("data", [])
        except Exception:
            hits = []
        own = [t for t in hits if t["artist"]["id"] == artist_id]
        if len(own) >= 2:
            songs = [{"title": korean_title(t), "point": "", "hidden": False} for t in own[:2]]
            image = own[0]["artist"].get("picture_medium")
    if not songs:
        print(f"[검증] 버림: {b.get('name')} (Deezer에서 곡을 확인하지 못함)", flush=True)
        return None
    return {"name": b["name"], "genre": b.get("genre", ""), "image": image, "reason": b.get("reason", ""),
            "songs": songs, "discovered": True}  # discovered: 우리 데이터 밖에서 AI가 새로 찾은 아티스트


ACTIONS = {"extract": extract, "recommend": recommend}


def server_error(e):
    """서버 오류의 자세한 내용(외부 API 응답 등)은 서버 로그에만 남기고, 브라우저에는 짧은 안내만 보낸다.
    → 내부 정보가 네트워크 응답으로 새어 나가지 않게 한다. (API 키는 원래 어떤 메시지에도 넣지 않음)"""
    print("서버 오류:", type(e).__name__, str(e)[:300], flush=True)
    return {"error": "AI가 지금 응답하지 못했어요. 잠시 후 다시 시도해 주세요."}


# ---------- 요청 제한 (공개 주소에서 AI를 무제한 호출해 무료 사용량을 다 써버리는 것 방지) ----------
MAX_BODY = 6 * 1024 * 1024  # 요청 크기 상한 6MB (캡처 사진은 브라우저에서 줄여서 보내므로 보통 1MB 안팎)
LIMITS = {
    "ip":  [(60, 8), (86400, 60)],      # 한 사용자(IP): 1분에 8번, 하루 60번
    "all": [(60, 40), (86400, 800)],    # 서버 전체: 1분에 40번, 하루 800번
}
_hits = {}                 # 키별 요청 시각 기록 (메모리에만 저장, 개인정보는 남기지 않음)
_lock = threading.Lock()   # 동시에 여러 요청이 와도 기록이 꼬이지 않게


class RateLimited(Exception):
    pass


def check_rate_limit(ip):
    """한도를 넘으면 RateLimited를 일으킨다. 통과하면 이번 요청을 기록한다."""
    now = time.time()
    with _lock:
        keys = [("ip", "ip:" + (ip or "unknown")), ("all", "all")]
        for kind, key in keys:
            q = _hits.setdefault(key, deque())
            while q and now - q[0] > 86400:  # 하루 지난 기록은 지운다
                q.popleft()
            for window, limit in LIMITS[kind]:
                if sum(1 for t in q if now - t <= window) >= limit:
                    raise RateLimited("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
        for _, key in keys:
            _hits[key].append(now)
        if len(_hits) > 5000:  # 기록이 너무 쌓이면 오래된 IP 기록 정리 (메모리 보호)
            for k in [k for k, q in _hits.items() if k != "all" and (not q or now - q[-1] > 86400)]:
                del _hits[k]


def client_ip(headers, fallback=""):
    """Vercel은 실제 접속 IP를 x-forwarded-for / x-real-ip 헤더로 넘겨준다."""
    fwd = headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else "") or headers.get("x-real-ip", "") or fallback


def serve(headers, rfile, ip):
    """요청 하나를 처리해서 (상태코드, 응답) 을 돌려준다. dev_server.py와 Vercel이 같이 쓴다."""
    try:
        length = int(headers.get("Content-Length", 0))
        if length < 0:
            return 400, {"error": "잘못된 요청이에요."}
        if length > MAX_BODY:
            return 413, {"error": "사진 용량이 너무 커요."}
        check_rate_limit(ip)
        payload = json.loads(rfile.read(length) or b"{}")
        return 200, handle(payload)
    except RateLimited as e:
        return 429, {"error": str(e)}
    except ValueError as e:
        return 400, {"error": str(e)}
    except Exception as e:
        return 500, server_error(e)


def handle(payload):
    """dev_server.py와 Vercel 둘 다 이 함수를 쓴다."""
    action = ACTIONS.get(payload.get("action"))
    if not action:
        raise ValueError("알 수 없는 요청이에요.")
    return action(payload)


# ---------- Vercel 서버 함수 진입점 ----------
class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        status, body = serve(self.headers, self.rfile, client_ip(self.headers, self.client_address[0]))
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
