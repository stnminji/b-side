"""실험: Gemini가 유튜브 타브 악보 영상에서 기타 코드를 읽을 수 있는지 확인
실행: python scripts/test_tab.py <유튜브주소> [모델이름]
"""
import json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"\'')

url = sys.argv[1]
model = sys.argv[2] if len(sys.argv) > 2 else "gemini-flash-lite-latest"
prompt = """이 영상은 기타 타브 악보(TAB) 영상이다. 화면에 보이는 악보를 읽어라.
- 화면에 코드 이름(예: Am, Fmaj7)이 적혀 있으면 그대로 읽는다.
- 코드 이름이 없으면 타브 숫자(줄·프렛)로 코드를 추정하고, 추정이라고 표시한다.
- 보이지 않거나 확실하지 않은 것은 지어내지 말고 "불확실"이라고 쓴다.
JSON으로만 답하라:
{"title": "곡 제목(화면에 보이면)", "key": "조성", "tuning": "튜닝", "capo": "카포",
 "progression": [{"section": "인트로/벌스/코러스 등", "chords": ["코드"], "time": "영상 시간"}],
 "evidence": "코드를 어떻게 알아냈는지 (화면 글자 / 타브 숫자 추정)", "confidence": "높음/중간/낮음"}"""

body = {"contents": [{"parts": [{"file_data": {"file_uri": url}}, {"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}}
req = urllib.request.Request(
    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
start = time.time()
try:
    d = json.loads(urllib.request.urlopen(req, timeout=180).read().decode("utf-8"))
    print(f"[{model}] {time.time() - start:.0f}초")
    print(d["candidates"][0]["content"]["parts"][0]["text"])
except urllib.error.HTTPError as e:
    print(f"[{model}] 오류 {e.code}: {e.read().decode()[:300]}")
