"""
识海 · 向量查询服务
只在算查询向量的时候用。零依赖（标准库 http.server）。

启动：
  python embed_server.py            # 默认 8931
  python embed_server.py --port 8932

接口：
  GET  /health                     → {"ok": true}
  POST /embed  {"text": "..."}     → {"v": [512 个浮点]}
  POST /embed  {"texts": [...]}    → {"vs": [[...], ...]}
"""
import os
import sys
import json
import argparse
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MODEL = "BAAI/bge-small-zh-v1.5"

_model = None
_tok = None
_lock = threading.Lock()


def load_model():
    global _model, _tok
    with _lock:
        if _model is not None:
            return _tok, _model
        from transformers import AutoTokenizer, AutoModel
        _tok = AutoTokenizer.from_pretrained(MODEL)
        _model = AutoModel.from_pretrained(MODEL)
        _model.eval()
        return _tok, _model


def encode(texts):
    import torch
    tok, mdl = load_model()
    out = []
    with torch.no_grad():
        inp = tok(texts, padding=True, truncation=True,
                  max_length=512, return_tensors="pt")
        res = mdl(**inp)
        emb = res.last_hidden_state[:, 0, :]
        emb = torch.nn.functional.normalize(emb, p=2, dim=1)
        out = emb.cpu().numpy().astype("float32").tolist()
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "loaded": _model is not None})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            n = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(n) if n else b"{}"
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._json(400, {"ok": False, "error": "bad json: " + str(e)})
            return

        try:
            if "texts" in body:
                texts = [str(x) for x in (body.get("texts") or [])][:128]
                if not texts:
                    self._json(200, {"vs": []})
                    return
                vs = encode(texts)
                # 保留 5 位小数，够用且省字节
                self._json(200, {"vs": [[round(x, 5) for x in v] for v in vs]})
            else:
                text = str(body.get("text") or "")
                if not text.strip():
                    self._json(200, {"v": []})
                    return
                v = encode([text])[0]
                self._json(200, {"v": [round(x, 5) for x in v]})
        except Exception as e:
            self._json(500, {"ok": False, "error": type(e).__name__ + ": " + str(e)[:200]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8931)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()

    print(f"识海向量服务 · {MODEL}")
    print(f"  监听 http://{a.host}:{a.port}")
    print("  首次加载约 30 秒，之后每次查询毫秒级")

    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n停了")


if __name__ == "__main__":
    main()
