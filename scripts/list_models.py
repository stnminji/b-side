"""
내 API 키로 쓸 수 있는 Gemini 모델 이름을 보여주는 스크립트 (키는 출력하지 않음)
실행:  python scripts/list_models.py
"""

import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

key = None
with open(os.path.join(ROOT, ".env"), encoding="utf-8") as f:
    for line in f:
        if line.strip().startswith("GEMINI_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")

req = urllib.request.Request(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    headers={"x-goog-api-key": key},
)
models = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())["models"]
for m in models:
    if "generateContent" in m.get("supportedGenerationMethods", []):
        print(m["name"].replace("models/", ""))
