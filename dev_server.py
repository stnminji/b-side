"""
로컬 테스트용 서버 (내 컴퓨터에서만 사용, 배포는 Vercel이 담당)

실행:  python dev_server.py
접속:  http://localhost:8000

- 화면 파일(index.html 등)을 보여주고
- /api/gemini 요청은 api/gemini.py의 handle()로 넘긴다.
- API 키는 .env 파일에서 읽는다.
"""

import importlib.util
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8000


def load_env():
    """.env 파일의 KEY=VALUE 줄을 환경변수로 읽어온다."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        print("⚠️  .env 파일이 없어요. AI 기능은 동작하지 않고 임시 추천으로 대신해요.")
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip().strip('"').strip("'")


def load_api(filename="gemini.py"):
    spec = importlib.util.spec_from_file_location("api_" + filename[:-3], os.path.join(ROOT, "api", filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


load_env()
api = load_api()
config_api = load_api("config.py")


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        # 공개 설정(Supabase 주소·공개용 키)은 배포 서버와 같은 함수로 돌려준다
        if self.path.split("?")[0] == "/api/config":
            data = json.dumps(config_api.public_config()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        # 비밀 파일이나 서버 코드는 브라우저에 보여주지 않는다
        # (주소를 %2E 같은 식으로 바꿔 써도 막히도록, 실제 파일 경로로 바꾼 뒤 검사한다)
        rel = os.path.relpath(self.translate_path(self.path), ROOT).replace("\\", "/").lower()
        if rel.startswith((".env", "api/", "dev_server.py", ".git", "scripts/")) or rel == "api":
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/gemini":
            self.send_error(404)
            return
        # 요청 제한·오류 처리까지 배포 서버와 똑같은 함수를 쓴다
        status, body = api.serve(self.headers, self.rfile, self.client_address[0])
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print(f"B-SIDE 로컬 서버: http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), DevHandler).serve_forever()
