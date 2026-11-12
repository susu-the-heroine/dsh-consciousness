"""
识海 · 向量计算
把每条记忆的正文算成一个向量，存进 vectors.json。
检索时 Node 直接读这个文件算余弦，不用再启动 Python。

用法：
  python embed.py                  # 算 main 识海
  python embed.py --sea xxx        # 算指定识海
  python embed.py --all            # 算所有识海
"""
import os
import sys
import json
import time
import argparse

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

SEAS = os.path.join(os.path.expanduser("~"), ".dsh", "consciousness-seas")
MODEL = "BAAI/bge-small-zh-v1.5"

_model = None
_tok = None


def load_model():
    global _model, _tok
    if _model is not None:
        return _tok, _model
    from transformers import AutoTokenizer, AutoModel
    _tok = AutoTokenizer.from_pretrained(MODEL)
    _model = AutoModel.from_pretrained(MODEL)
    _model.eval()
    return _tok, _model


def encode(texts, batch_size=32):
    """返回 list[list[float]]，已经归一化。"""
    import torch
    import numpy as np

    tok, mdl = load_model()
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            inp = tok(batch, padding=True, truncation=True,
                      max_length=512, return_tensors="pt")
            res = mdl(**inp)
            # bge 用 CLS pooling
            emb = res.last_hidden_state[:, 0, :]
            # 归一化
            emb = torch.nn.functional.normalize(emb, p=2, dim=1)
            out.extend(emb.cpu().numpy().astype("float32").tolist())
    return out


def embed_sea(sea):
    path = os.path.join(SEAS, sea, "data.json")
    if not os.path.exists(path):
        print(f"跳过 {sea}：没有 data.json")
        return 0

    data = json.load(open(path, encoding="utf-8-sig"))
    pts = [p for p in data.get("points", []) if not p.get("dead")]
    if not pts:
        print(f"跳过 {sea}：没有记忆")
        return 0

    # 算哪些需要算：没有向量的，或者文本变了的
    vpath = os.path.join(SEAS, sea, "vectors.json")
    old = {}
    if os.path.exists(vpath):
        try:
            old = json.load(open(vpath, encoding="utf-8"))
        except Exception:
            old = {}

    todo = []
    for p in pts:
        key = str(p.get("id"))
        text = (str(p.get("title") or "") + "\n" + str(p.get("text") or "")).strip()
        fp = hash(text) & 0x7FFFFFFF
        cur = old.get(key)
        if cur and cur.get("fp") == fp and cur.get("v"):
            continue
        todo.append((key, text, fp))

    if not todo:
        print(f"{sea}: {len(pts)} 条都算过了，不用重算")
        return len(pts)

    t0 = time.time()
    vecs = encode([t for _, t, _ in todo])
    elapsed = time.time() - t0

    store = dict(old)
    for (key, _, fp), v in zip(todo, vecs):
        store[key] = {"fp": fp, "v": [round(x, 5) for x in v]}

    # 清掉已经删掉的
    alive_ids = {str(p.get("id")) for p in pts}
    store = {k: v for k, v in store.items() if k in alive_ids}

    tmp = vpath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, vpath)

    dim = len(vecs[0]) if vecs else 0
    size = os.path.getsize(vpath) / 1024
    print(f"{sea}: 算了 {len(todo)} 条，共 {len(store)} 条 · {dim} 维 · "
          f"{size:.0f} KB · {elapsed:.1f}s")
    return len(store)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sea", default="main")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    if a.all:
        names = [d for d in os.listdir(SEAS)
                 if os.path.isdir(os.path.join(SEAS, d)) and not d.startswith("_")]
        total = 0
        for n in names:
            total += embed_sea(n)
        print(f"全部完成，共 {total} 条")
    else:
        embed_sea(a.sea)


if __name__ == "__main__":
    main()
