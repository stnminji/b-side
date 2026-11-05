"""로컬 서버(dev_server.py)에 추천 요청을 보내 결과를 확인하는 테스트 도구
실행: python scripts/test_recommend.py band "잔나비"
"""
import json, sys, time, urllib.request

mode, query = sys.argv[1], sys.argv[2]
body = json.dumps({"action": "recommend", "mode": mode, "query": query}).encode("utf-8")
req = urllib.request.Request("http://localhost:8000/api/gemini", data=body, headers={"Content-Type": "application/json"})
start = time.time()
d = json.loads(urllib.request.urlopen(req, timeout=90).read().decode("utf-8"))
print(f"[{mode}] {query}  ({time.time() - start:.1f}초)")
print(" ", d.get("summary") or d)
for b in d.get("bands", []):
    tag = "AI발견" if b.get("discovered") else "데이터"
    print(f"  [{tag}] {b['name']} / {b['genre']} | {[s['title'] for s in b['songs']]} | {'사진O' if b.get('image') else '사진X'}")
