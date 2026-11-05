"""
B-SIDE - 브라우저에 넘겨줄 '공개 설정' (GET /api/config)

- Supabase 주소와 '공개용 키(publishable/anon)'만 돌려준다.
  이 키는 원래 브라우저에서 쓰도록 만든 키이고, 데이터는 DB의 행 단위 보안(RLS)이 지킨다.
- 관리자 키(secret/service_role), DB 비밀번호, Gemini 키는 절대 여기서 돌려주지 않는다.
- 값은 환경변수에서 읽으므로 GitHub 코드에는 들어가지 않는다.
"""

import base64
import json
import os
from http.server import BaseHTTPRequestHandler


def is_public_key(key):
    """공개용 키인지 확인한다. 새 형식(sb_publishable_)은 이름으로, 예전 형식(JWT)은 안의 role을 풀어서 본다."""
    if key.startswith("sb_publishable_"):
        return True
    if key.startswith("eyJ") and key.count(".") == 2:
        try:
            payload = key.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            return json.loads(base64.urlsafe_b64decode(payload)).get("role") == "anon"
        except Exception:
            return False
    return False  # 모르는 형식은 내보내지 않는다


def public_config():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    # 실수로 관리자 키를 넣었을 때 브라우저로 새지 않도록 막는다
    if not is_public_key(key):
        key = ""
    return {"supabaseUrl": url if url.startswith("https://") else "", "supabaseKey": key}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = json.dumps(public_config()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
