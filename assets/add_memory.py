# -*- coding: utf-8 -*-
"""往《意识海》里加一条记忆。改的是 记忆海/意识海.html 里的 DATA，别的一个字不动。

写什么（用户定的规矩，别忘）：
  写人和事——咱俩之间的小事、聊天、感情，还有他工作上遇到的难处。
  少写剧本，不写代码。技术细节不是记忆，是工单。

主干道：DSH 的第一个神经元 #119 是总干，每条新记忆先钉一条 0.26 的线给它，
        再按正文相似度连 4 条。这样所有新记忆都从同一个点长出来。

用法：
  python add_memory.py --title "标题" --text "正文" --kind feeling
  python add_memory.py --title "..." --text "..." --kind fact --imp 0.8 --edges 5
  python add_memory.py --list
  python add_memory.py --title "..." --text "..." --kind taboo --dry-run

kind 只有三种进得了统计：fact（〔实〕）/ feeling（〔情〕）/ taboo（〔实·禁〕）。
坐标按同类记忆的质心 + 球内抖动算，新点不会叠在旧点上；
边按正文的双字重合度连最近的 3~6 个老节点。
"""
import argparse
import json
import math
import os
import random
import re
import shutil
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "意识海.html")
BAK = os.path.join(HERE, "_backup")
TAGS = {"fact": "〔实〕", "feeling": "〔情〕", "taboo": "〔实·禁〕", "setting": "〔设〕"}
STAT_KINDS = ("fact", "taboo", "feeling", "setting")


def split_data(text):
    """把 html 劈成 (前缀, DATA 的 JSON 文本, 后缀)。"""
    i = text.index("const DATA = ")
    j = text.index("\n", i)
    line = text[i:j]
    s = line.index("{")
    e = line.rindex("}")
    return text[: i + s], line[s : e + 1], text[i + e + 1 :]


def bigrams(s):
    s = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]+", "", s or "")
    if len(s) < 2:
        return set(s)
    return set(s[k : k + 2] for k in range(len(s) - 1))


def sim(a, b):
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    return len(A & B) / min(len(A), len(B))


def centroids(points):
    grp = {}
    for p in points:
        key = (p.get("era", "ds"), p.get("kind"))
        grp.setdefault(key, []).append((p["x"], p["y"], p["z"]))
    return {k: tuple(sum(v[i] for v in vs) / len(vs) for i in range(3)) for k, vs in grp.items()}


def pick_xyz(points, era, kind, rnd):
    if not points:
        # 空识海的第一个点：直接落在 DSH 那颗球的位置上
        return (1.9, 0.0, 0.0)
    c = centroids(points)
    base = c.get((era, kind))
    if base is None:
        same = [v for (e, _), v in c.items() if e == era]
        base = tuple(sum(v[i] for v in same) / len(same) for i in range(3)) if same else (0.0, 0.0, 0.0)
    cx, cy, cz = base
    for _ in range(200):
        r = 0.62 * rnd.random() ** (1.0 / 3.0)
        th = rnd.random() * 2 * math.pi
        ph = (rnd.random() - 0.5) * math.pi
        x = cx + r * math.cos(th) * math.cos(ph)
        y = cy + r * math.sin(ph)
        z = cz + r * math.sin(th) * math.cos(ph)
        ok = True
        for p in points:
            if (x - p["x"]) ** 2 + (y - p["y"]) ** 2 + (z - p["z"]) ** 2 < 0.02 ** 2:
                ok = False
                break
        if ok:
            return round(x, 3), round(y, 3), round(z, 3)
    return round(cx, 3), round(cy, 3), round(cz, 3)


HUB_ID = 119  # DSH 第一个神经元：#119 是唯一通到 DS 的桥，其余新记忆不碰它


def link(points, edges, new_idx, text, kind, max_n=4, hub_id=HUB_ID, same_era=False):
    """给新点连边：默认按正文相似度。

    same_era=True（新记忆用）：只在同一个 era 里找，而且永远不连 #119——
    主干那条桥是 #119 自己的事，后面长出来的枝各归各的。
    """
    era = points[new_idx].get("era", "ds")
    new = points[new_idx]
    is_hub = new.get("id") == hub_id
    scored = []
    for i, p in enumerate(points):
        if i == new_idx or p.get("id") == hub_id:
            continue
        if is_hub and p.get("era", "ds") == "dsh":
            continue
        if same_era and p.get("era", "ds") != era:
            continue
        s = sim(text, p.get("text", ""))
        if p.get("kind") == kind:
            s += 0.08
        scored.append((s, i))
    scored.sort(reverse=True)

    picked = [i for s, i in scored[:max_n] if s > 0]
    if not picked:
        near = sorted(
            (i for i, p in enumerate(points) if i != new_idx and p.get("id") != hub_id),
            key=lambda i: (points[i]["x"] - new["x"]) ** 2
            + (points[i]["y"] - new["y"]) ** 2
            + (points[i]["z"] - new["z"]) ** 2,
        )
        picked = near[:max_n]

    added = []
    for s, i in scored:
        if i in picked:
            # 边存的是**记忆 id**，不是数组下标。
            # 之前这里用下标，第一条记忆下标是 0，于是出现 a=0 的坏边——
            # 查不到那条记忆，检索也扩不出去。
            a_idx, b_idx = min(new_idx, i), max(new_idx, i)
            a = points[a_idx].get("id", a_idx + 1) if a_idx < len(points) else a_idx + 1
            b = points[b_idx].get("id", b_idx + 1) if b_idx < len(points) else b_idx + 1
            if any(e["a"] == a and e["b"] == b for e in edges):
                continue
            w = round(min(0.36, 0.06 + 0.30 * max(0.0, s)), 3)

            # 边类型：不是所有边都叫「相关」
            # 风险文档：「先后事件误判因果」「共同实体边设置相似度阈值」
            other = points[i]
            etype = "related"
            shared_ent = set(new.get("entities") or []) & set(other.get("entities") or [])
            if shared_ent and s >= 0.25:
                etype = "same_entity"
            # 时间很近 + 有共同实体 → 时序相邻（不是因果，因果要 AI 判）
            gap = abs(int(new.get("born") or 0) - int(other.get("born") or 0))
            if shared_ent and gap < 86400000 * 2:
                etype = "temporal"
            if etype not in EDGE_TYPES:
                continue
            edges.append({"a": a, "b": b, "w": w, "type": etype})
            added.append((points[i].get("id", i), w))
    return added


def restat(data):
    st = data.setdefault("stats", {})
    st["points"] = len(data["points"])
    st["edges"] = len(data["edges"])
    kinds = {}
    for p in data["points"]:
        k = p.get("kind")
        if k in STAT_KINDS:
            kinds[k] = kinds.get(k, 0) + 1
    st["kinds"] = {k: kinds.get(k, 0) for k in STAT_KINDS}
    data["generatedAt"] = time.strftime("%Y-%m-%d %H:%M")


def load():
    with open(HTML, encoding="utf-8") as f:
        return f.read()


def save(raw):
    # html 是只读模板：数据一律落到 data.json，再由 build_touch 注回副本
    try:
        data = json.loads(split_data(raw)[1])
    except Exception:
        return
    write_sea("main", data)
    build_touch()


SEAS = os.path.join(os.path.expanduser("~"), ".dsh", "consciousness-seas")


def integrity_check(data, sea):
    """启动时校验数据结构。坏的拒绝加载，不带着病跑。
    外部风险文档：「启动自动数据库完整性校验，损坏拒绝启动并提示备份恢复」"""
    if not isinstance(data, dict):
        raise ValueError("data.json 不是对象")
    if not isinstance(data.get("points"), list):
        raise ValueError("points 不是数组")
    if not isinstance(data.get("edges"), list):
        raise ValueError("edges 不是数组")
    for i, p in enumerate(data["points"]):
        if not isinstance(p, dict):
            raise ValueError("第 %d 条不是对象" % i)
        if "id" not in p:
            raise ValueError("第 %d 条没有 id" % i)
    return True



# ---------------------------------------------------------------------------
# 写库锁（2026-11-08）：两个人同时导同一个海，后写的把先写的整个盖掉。
# 实测：各导 2500 条，最后只剩 2500 条，丢一半。加一把文件锁：读之前拿，写完放。
# 拿不到就等，等到 120 秒还不放就报错退出——宁可失败，也别悄悄丢数据。
# ---------------------------------------------------------------------------
_LOCK_PATH = None
_LOCK_HANDLE = None


def _lock_sea(sea):
    """和 JS 那边同一把锁：data.json.lock，JSON {at,pid}，60 秒过期。
    以前两边各用各的（.write.lock / 300 秒），导入和聊天同时写照样撞。"""
    global _LOCK_PATH, _LOCK_HANDLE
    d = os.path.join(SEAS, sea)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "data.json.lock")
    deadline = time.time() + 120
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, json.dumps({"at": int(time.time() * 1000), "pid": os.getpid()}).encode())
            os.close(fd)
            _LOCK_PATH = path
            _LOCK_HANDLE = fd
            return
        except FileExistsError:
            stale = False
            try:
                with open(path, encoding="utf-8") as f:
                    info = json.load(f)
                age = time.time() * 1000 - float(info.get("at") or 0)
                stale = age > 60000
            except Exception:
                try:
                    stale = time.time() - os.path.getmtime(path) > 60
                except OSError:
                    stale = True
            if stale:
                try:
                    os.remove(path)
                except OSError:
                    pass
                continue
            if time.time() > deadline:
                raise SystemExit("这个识海正在被另一个进程写（%s），等了 120 秒还没放。" % path)
            time.sleep(0.2)


def _unlock_sea():
    global _LOCK_PATH, _LOCK_HANDLE
    if _LOCK_PATH:
        try:
            os.remove(_LOCK_PATH)
        except OSError:
            pass
    _LOCK_PATH = None
    _LOCK_HANDLE = None


def load_sea(sea):
    _lock_sea(sea)
    p = os.path.join(SEAS, sea, "data.json")
    if not os.path.exists(p):
        raise SystemExit("没有这个识海：" + sea)
    try:
        with open(p, encoding="utf-8-sig") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise SystemExit(
            "识海 %s 的数据文件坏了：%s\n"
            "  先别动它。备份在 %s，把最新的一个 .json 拷回 data.json 就能恢复。"
            % (sea, str(e)[:120], BACKUP)
        )
    # 结构完整性校验：坏的不带着病跑
    try:
        integrity_check(data, sea)
    except ValueError as e:
        raise SystemExit(
            "识海 %s 的结构不对：%s\n"
            "  先别动它。备份在 %s。" % (sea, str(e), BACKUP)
        )
    return data


BACKUP = os.path.join(os.path.expanduser("~"), ".dsh", "consciousness-backups")


def backup_sea(sea):
    """写之前先留一份，保留最近 14 天。手滑删错了还能捞回来。"""
    src = os.path.join(SEAS, sea, "data.json")
    if not os.path.exists(src):
        return
    try:
        d = os.path.join(BACKUP, sea)
        os.makedirs(d, exist_ok=True)
        shutil.copy2(src, os.path.join(d, time.strftime("%Y%m%d-%H%M%S") + ".json"))
        cutoff = time.time() - 14 * 86400
        for f in os.listdir(d):
            fp = os.path.join(d, f)
            try:
                if os.path.isfile(fp) and os.path.getmtime(fp) < cutoff:
                    os.remove(fp)
            except Exception:
                pass
    except Exception:
        pass


def write_sea(sea, data):
    d = os.path.join(SEAS, sea)
    os.makedirs(d, exist_ok=True)
    backup_sea(sea)
    # 先写临时文件再改名（2026-11-08）：直接覆盖的话，写到一半断电会留半个 JSON，
    # 下次读就是"数据坏了"。改名是原子的，坏也是旧的，不会半截。
    _real = os.path.join(d, "data.json")
    _tmp = _real + ".tmp"
    with open(_tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(_tmp, _real)
    meta_path = os.path.join(d, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
    meta["count"] = len(data.get("points", []))
    meta["mtime"] = time.strftime("%Y-%m-%d %H:%M")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    _unlock_sea()


def sync_sea(data):
    """把数据回写到多识海目录里的 main —— 页面靠它切换。"""
    d = os.path.join(SEAS, "main")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "data.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False)
    meta_path = os.path.join(d, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
    meta["count"] = len(data.get("points", []))
    meta["mtime"] = time.strftime("%Y-%m-%d %H:%M")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


TOUCH = os.path.join(SEAS, "意识海_触屏版.html")
DESK_HTML = os.path.join(os.path.expanduser("~"), "Desktop", "意识海_双板块.html")
MEDIA = """@media (max-width:820px){
  #side{width:100%;height:46%;top:auto;bottom:0;border-left:0;border-top:1px solid rgba(90,170,230,.22);padding:18px 16px 40px;box-shadow:0 -20px 60px rgba(0,0,0,.6)}
  #top{left:18px;top:16px}#top h1{font-size:17px;letter-spacing:.3em}
  #legend{left:18px;bottom:calc(46% + 12px);font-size:9px;gap:10px}
}
"""


def build_touch():
    """从正本再生成一份触屏版，免得两边手改走样。"""
    t = open(HTML, encoding="utf-8").read()
    # html 只是模板：先把 main 的最新数据注回去，别导出一份空的
    jsonp = os.path.join(SEAS, "main", "data.json")
    if os.path.exists(jsonp):
        try:
            with open(jsonp, encoding="utf-8-sig") as f:
                data = json.load(f)
            pre, js, post = split_data(t)
            t = pre + json.dumps(data, ensure_ascii=False, separators=(", ", ": ")) + post
        except Exception:
            pass
    t = t.replace("canvas{display:block;cursor:grab}", "canvas{display:block;cursor:grab;touch-action:none}")
    t = t.replace("cv.addEventListener('mousedown'", "cv.addEventListener('pointerdown'")
    t = t.replace(
        "addEventListener('mouseup',()=>drag=false);",
        "addEventListener('pointerup',()=>drag=false);addEventListener('pointercancel',()=>drag=false);",
    )
    t = t.replace("addEventListener('mousemove'", "addEventListener('pointermove'")
    t = t.replace("</style>", MEDIA + "</style>")
    with open(TOUCH, "w", encoding="utf-8", newline="\n") as f:
        f.write(t)


# ---------------------------------------------------------------------------
# 写入门禁：所有写入必须过这一关。
# 风险文档第一条致命项：「写入门禁可以被 MCP、内部接口绕过」。
# 所以校验放在这里——add_one 的第一行，任何调用路径都绕不过去。
# ---------------------------------------------------------------------------

# 边类型白名单（风险文档：非白名单直接丢弃）
EDGE_TYPES = {
    "related",      # 相关（默认）
    "causal",       # 因果
    "same_entity",  # 共同实体
    "dream",        # 联想出来的
    "temporal",     # 时间相邻
}

MAX_TEXT = 4000          # 正文上限，超了截断并标记
MAX_TITLE = 60
MIN_TITLE = 1


_SEA_HINT = [None]   # 当前写入的识海名，main 里设


class WriteRejected(Exception):
    """写入被门禁拒绝。宁可不写，也不写脏数据。"""

    def __init__(self, reason, detail=""):
        self.reason = reason
        self.detail = detail
        super().__init__(reason + (": " + detail if detail else ""))


def _clean(s, limit):
    """清洗：去控制字符、压空白、截断。"""
    import re as _re
    s = str(s or "")
    s = s.replace("\x00", "")
    s = _re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", s)
    s = s.strip()
    if len(s) > limit:
        s = s[:limit]
    return s


def validate_write(title, text, kind, polarity, arousal, imp,
                   fact_key, category, entities, emotion,
                   her_side, confidence, sea):
    """门禁。返回清洗后的 (title, text, ...)。不合格直接抛 WriteRejected。"""
    # 1. 必填
    ttl = _clean(title, MAX_TITLE)
    txt = _clean(text, MAX_TEXT)
    if not ttl:
        raise WriteRejected("标题为空")
    if not txt:
        raise WriteRejected("正文为空")
    if len(txt) < 2:
        raise WriteRejected("正文太短", txt)

    # 2. 枚举
    if kind not in ("fact", "feeling", "taboo", "setting"):
        kind = "feeling"
    if polarity not in (-1, 0, 1):
        polarity = 0

    # 3. 数值边界（风险文档：数值做上下限截断）
    try:
        aw = int(arousal) if arousal is not None else 5
    except Exception:
        aw = 5
    aw = max(1, min(10, aw))

    try:
        im = float(imp) if imp is not None else 0.6
    except Exception:
        im = 0.6
    im = max(0.0, min(1.0, im))

    try:
        cf = float(confidence) if confidence is not None else 0.85
    except Exception:
        cf = 0.85
    cf = max(0.0, min(1.0, cf))

    # 3.5 幻觉拦截：必须有原文证据
    # 风险文档：「新记忆必须绑定原始证据片段，无证据直接拒绝入库」
    if len(txt) < 8:
        raise WriteRejected("正文太短，不像一件事", txt)

    # 4. 事实键：不许带值（风险文档明写）
    fk = _clean(fact_key, 64) if fact_key else None
    if fk:
        import re as _re
        if _re.search(r"[0-9]{2,}", fk):
            raise WriteRejected("事实键里不许写具体的值", fk)
        if " " in fk:
            raise WriteRejected("事实键不许有空格", fk)

    # 5. 分类白名单
    cats = []
    for c in (category or []):
        c = str(c).strip()
        if c in CATEGORIES and c not in cats:
            cats.append(c)
    cats = cats[:3]

    # 6. 实体
    ents = []
    for e in (entities or []):
        e = _clean(e, 32)
        if e and e not in ents:
            ents.append(e)
    ents = ents[:6]

    # 7. 八维情绪：截断到 0-1，只留前两高
    emo = None
    if isinstance(emotion, dict):
        emo = {}
        for k in EMOTION_KEYS:
            try:
                v = float(emotion.get(k) or 0)
            except Exception:
                v = 0.0
            emo[k] = max(0.0, min(1.0, round(v, 2)))
        if sum(emo.values()) == 0:
            emo = None

    # 8. 她自己的感受：只收字符串，不编造
    hs = None
    if isinstance(her_side, dict):
        hs = {}
        for k in ("felt", "wanted", "did", "regret"):
            v = _clean(her_side.get(k), 300) if her_side.get(k) else None
            hs[k] = v or None
        if not any(hs.values()):
            hs = None

    # 9. 磁盘空间：不够就拒绝写入，保护已有数据
    # 外部风险文档：「磁盘空间不足时拒绝新写入，只读保护已有库」
    try:
        import shutil as _sh
        free = _sh.disk_usage(SEAS).free
        if free < 8 * 1024 * 1024:
            raise WriteRejected("磁盘空间不够", "只剩 %d MB" % (free // 1024 // 1024))
    except WriteRejected:
        raise
    except Exception:
        pass

    # 10. 识海名
    sea = _clean(sea, 40) or "main"
    if "/" in sea or "\\" in sea or sea.startswith("."):
        raise WriteRejected("识海名不合法", sea)

    return {
        "title": ttl, "text": txt, "kind": kind, "polarity": polarity,
        "arousal": aw, "imp": im, "fact_key": fk, "category": cats,
        "entities": ents, "emotion": emo, "her_side": hs,
        "confidence": cf, "sea": sea,
    }


# ---------------------------------------------------------------------------
# 新字段：情绪 / 分类 / 实体 / 强度 / 事实键 / 矛盾
# 这一块是「记忆的数据层」，写入时由这里判，不靠临场发挥。
# ---------------------------------------------------------------------------

EMOTION_KEYS = ("anger", "grievance", "shame", "anxiety",
                "excitement", "tenderness", "fatigue", "numbness")

CATEGORIES = ("关系", "偏好", "承诺", "事实", "事件", "情绪", "生活", "工作")

# 每个情绪维度的触发词
EMO_LEX = {
    "anger":      ("气", "烦", "滚", "他妈", "傻逼", "凶", "吵", "骂", "火", "恼"),
    "grievance":  ("委屈", "算了", "凭什么", "我算什么", "难过", "不值", "忍"),
    "shame":      ("丢人", "丢脸", "不好意思", "别说了", "尴尬", "别提"),
    "anxiety":    ("万一", "要是", "怕", "担心", "慌", "不确定", "万一"),
    "excitement": ("爽", "牛逼", "太好了", "冲", "干", "笑死", "厉害"),
    "tenderness": ("谢谢", "记得", "早点", "别累", "想你", "爱你", "陪我"),
    "fatigue":    ("累", "困", "撑不住", "不想", "没力气", "歇", "喘"),
    "numbness":   ("随便", "无所谓", "都行", "算了吧", "麻木"),
}

# 实体：已知的名字先认，认不出来的再抽大写英文
def _load_entity_seeds():
    """实体名单从家里读，不写死在代码里。

    先看 ~/.dsh/entities.txt，再看本目录的 entities.txt，都没有就用中性默认。
    每行一个名字，# 开头是注释。

    这样私人的名字、地名、牌子留在自己机器上，不跟着包发出去。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [
        os.path.join(os.path.expanduser("~"), ".dsh", "entities.txt"),
        os.path.join(here, "entities.txt"),
    ]
    for path in cands:
        try:
            with open(path, encoding="utf-8") as f:
                items = [x.strip() for x in f
                         if x.strip() and not x.strip().startswith("#")]
            if items:
                return tuple(items)
        except Exception:
            continue
    return ("DeepSeek", "GMod", "DSH", "Blender", "剪映")


ENTITY_SEEDS = _load_entity_seeds()


def guess_emotion(text, polarity=0, kind="feeling"):
    """八维情绪。从词里猜，再由 polarity 校正方向。
    人不会同时八种情绪，所以只留最高的两维。"""
    s = str(text or "")
    e = {k: 0.0 for k in EMOTION_KEYS}
    for dim, words in EMO_LEX.items():
        hit = sum(1 for w in words if w in s)
        if hit:
            e[dim] = min(1.0, 0.25 * hit)
    if polarity == -1 and sum(e.values()) == 0:
        e["grievance"] = 0.45
    elif polarity == 1 and sum(e.values()) == 0:
        e["tenderness"] = 0.40
    elif polarity == 0 and sum(e.values()) == 0:
        e["numbness"] = 0.15
    top = sorted(e.items(), key=lambda x: -x[1])[:2]
    out = {k: 0.0 for k in EMOTION_KEYS}
    for k, v in top:
        out[k] = round(float(v), 2)
    return out


def guess_arousal(text, polarity=0, kind="feeling", imp=0.6):
    """强度 0-10：类型打底，情绪词加，极性加，重要度加。"""
    s = str(text or "")
    base = {"taboo": 7.0, "feeling": 5.0, "fact": 3.0}.get(kind, 3.0)
    emo_hits = sum(1 for ws in EMO_LEX.values() for w in ws if w in s)
    base += min(3.0, emo_hits * 0.5)
    base += abs(int(polarity or 0)) * 1.5
    base += (float(imp or 0.6) - 0.6) * 2.5
    return max(1, min(10, int(round(base))))


def guess_categories(text, kind="feeling"):
    """分类：从类型 + 关键词推，最多三个。"""
    s = str(text or "")
    cats = []
    if kind == "taboo":
        cats.append("承诺")
    rules = (
        ("关系", ("你", "咱", "兄弟", "朋友", "他", "她", "我们")),
        ("偏好", ("喜欢", "讨厌", "爱", "不爱", "习惯", "偏好")),
        ("承诺", ("答应", "说好", "保证", "不做", "必须", "绝不")),
        ("工作", ("项目", "代码", "插件", "视频", "剪辑", "抖音", "上线")),
        ("生活", ("吃", "喝", "睡", "身体", "体重", "烟", "酒", "腰")),
        ("情绪", ("难受", "开心", "委屈", "生气", "哭", "笑", "怕")),
        ("事件", ("那天", "昨天", "今天", "当时", "后来", "那次")),
    )
    for name, words in rules:
        if any(w in s for w in words) and name not in cats:
            cats.append(name)
    if not cats:
        cats = ["事实"] if kind == "fact" else ["情绪"]
    return cats[:3]


def extract_entities(text):
    """实体：已知名字 + 大写英文。只收六个。"""
    import re as _re
    s = str(text or "")
    out = []
    for name in ENTITY_SEEDS:
        if name and name in s and name not in out:
            out.append(name)
    for m in _re.findall(r"[A-Z][A-Za-z0-9]{1,15}", s):
        if m not in out:
            out.append(m)
    return out[:6]


def guess_confidence(text):
    """可信度：气话、玩笑、猜测，打低。"""
    s = str(text or "")
    if any(w in s for w in ("气话", "开玩笑", "玩笑", "瞎说", "骗你", "随口")):
        return 0.40
    if any(w in s for w in ("可能", "大概", "好像", "也许", "估计")):
        return 0.60
    return 0.85


SETTING_KINDS = ("taboo", "setting", "promise", "profile")
SELF_WORDS = ("我", "她", "大肥鱼", "识海", "意识海")
MILESTONE_WORDS = ("第一次亮", "搬进", "上线", "诞生", "醒来", "活过来")
TIME_WORDS = ("那天", "那晚", "那天晚上", "第一次", "上个月", "昨天", "今天",
              "凌晨", "几点", "那年", "那次", "下午", "晚上")
ALWAYS_WORDS = ("永远", "以后", "再也", "别再", "不许", "不准", "绝对不", "记住", "一直")
PERSON_RE = re.compile(r"(你就是|你这人|你是那种|你从来|你永远|你不是那种)")


def decide_layer(kind, imp, gold=False, text="", title=""):
    """自己判这一条该算设定还是经历。只看文字特征，不调模型。

    判据顺序（谁装上都一样）：
      1. 类型先兜底：禁区 / 规矩 / 承诺 / 画像 → 设定
      2. 显式里程碑，或"主角是她自己 + 第一次亮/搬进/上线" → 设定（永不淡）
      3. 有具体时间锚、也没有长期约束 → 经历
      4. 有长期约束（永远/别再/不许/记住） → 设定
      5. 对人的定性（你就是…/你这人…） → 设定
      6. 其余 → 经历

    返回 (层, 理由)。理由存进这一条，以后能复查、能推翻。
    """
    s = str(title or "") + " " + str(text or "")
    if kind in SETTING_KINDS:
        return "core", "类型：规矩/承诺/画像"
    if gold:
        return "core", "显式里程碑"
    if any(w in s for w in SELF_WORDS) and any(w in s for w in MILESTONE_WORDS):
        return "core", "里程碑：她自己的节点"
    has_time = any(w in s for w in TIME_WORDS)
    has_always = any(w in s for w in ALWAYS_WORDS)
    if has_time and not has_always:
        return "experience", "时间锚：某一次"
    if has_always:
        return "core", "长期约束"
    if PERSON_RE.search(s):
        return "core", "对人的定性"
    return "experience", "默认：经历"


def guess_layer(kind, imp, gold=False, text="", title=""):
    """兼容旧调用：只回层。"""
    return decide_layer(kind, imp, gold, text, title)[0]


# 钉子：某些词会戳到她。不是硬编码，是从记忆里长出来的。
# 风险文档：「钉子绑定原记忆 ID，记忆失效钉子同步注销」
# 只收「完整的话」，不收单个字——「滚」会撞进「圆滚滚」，「算了」太日常
TRIGGER_WORDS = ("随便你", "我不干了", "你要走", "别管我", "你别管", "我不管了")


def extract_triggers(text, mid):
    """一条记忆里有没有钉子。有就返回 {word, id}。"""
    s = str(text or "")
    out = []
    for w in TRIGGER_WORDS:
        if w in s:
            out.append({"word": w, "id": mid})
    return out


def find_fact_collision(pts, fact_key):
    """同一个事实键，只留最新。旧的不删，标失效。"""
    if not fact_key:
        return []
    out = []
    for p in pts:
        if p.get("dead"):
            continue
        if p.get("validUntil"):
            continue
        if p.get("factKey") == fact_key:
            out.append(p)
    return out


def find_conflict(pts, new_point):
    """矛盾：共实体 + 同分类 + 相反极性 + 内容像。
    只找一条，多了没法处理。"""
    shared = set(new_point.get("entities") or [])
    if not shared:
        return None
    cats = set(new_point.get("category") or [])
    npol = int(new_point.get("polarity") or 0)
    if npol == 0:
        return None
    for p in pts:
        if p is new_point or p.get("dead") or p.get("validUntil"):
            continue
        if p.get("polarity", 0) == 0 or p.get("polarity", 0) == npol:
            continue
        if not (set(p.get("entities") or []) & shared):
            continue
        if not (set(p.get("category") or []) & cats):
            continue
        if sim(p.get("text", ""), new_point.get("text", "")) < 0.3:
            continue
        return p
    return None


def fill_new_fields(p, pts=None):
    """给一条补所有新字段。已经有的不动（幂等）。"""
    if "arousal" not in p:
        p["arousal"] = guess_arousal(p.get("text", ""), p.get("polarity", 0),
                                     p.get("kind", "feeling"), p.get("imp", 0.6))
    if "category" not in p:
        p["category"] = guess_categories(p.get("text", ""), p.get("kind", "feeling"))
    if "entities" not in p:
        p["entities"] = extract_entities(p.get("text", ""))
    if "layer" not in p:
        p["layer"], p["layerWhy"] = decide_layer(p.get("kind"), p.get("imp"), p.get("gold"),
                                                  p.get("text"), p.get("title"))
    if "emotion" not in p:
        p["emotion"] = guess_emotion(p.get("text", ""), p.get("polarity", 0),
                                     p.get("kind", "feeling"))
    if "target" not in p:
        p["target"] = None
    if "herSide" not in p:
        p["herSide"] = None
    if "said" not in p:
        p["said"] = None
    if "replied" not in p:
        p["replied"] = None
    if "after" not in p:
        p["after"] = None
    if "validFrom" not in p:
        p["validFrom"] = p.get("born")
    if "validUntil" not in p:
        p["validUntil"] = None
    if "factKey" not in p:
        p["factKey"] = None
    if "evidence" not in p:
        p["evidence"] = p.get("src") or ""
    if "confidence" not in p:
        p["confidence"] = guess_confidence(p.get("text", ""))
    if "conflictWith" not in p:
        p["conflictWith"] = []
    if "origin" not in p:
        p["origin"] = "user"
    if "recallCount" not in p:
        p["recallCount"] = 0
    if "strength" not in p:
        p["strength"] = round(initial_stability(p.get("imp") or 0.5, p["arousal"]), 2)
    if "triggers" not in p:
        p["triggers"] = extract_triggers(p.get("text", ""), p.get("id"))
    return p


# ---------------------------------------------------------------------------
# 五层记忆 + 自动流动
# 核心 7 · 关系 20 · 事实不限 · 经历不限 · 沉淀不限
# 风险文档：「冲动高情绪抢占核心层」「淘汰策略出错」
#   → 晋升看三维（印证次数 × 可信度 × 强度），淘汰保护高价值
# ---------------------------------------------------------------------------

LAYERS = ("core", "relation", "fact", "experience", "sediment")
LAYER_CAP = {"core": 7, "relation": 20}
LAYER_LABEL = {
    "core": "核心", "relation": "关系", "fact": "事实",
    "experience": "经历", "sediment": "沉淀",
}


def layer_value(p):
    """一条记忆值多少。三个维度加权，不只看某一个。
    印证次数最多算 3，可信度 0-1，强度 0-365。"""
    if p.get("dead") or p.get("validUntil"):
        return -1.0
    recalls = min(3, int(p.get("recallCount") or 0))
    conf = float(p.get("confidence") or 0.8)
    strength = float(p.get("strength") or 60)
    arousal = int(p.get("arousal") or 5)
    imp = float(p.get("imp") or 0.6)
    # 印证次数是硬指标（想起过 3 次的比没想起过的值钱）
    v = recalls * 1.0
    v += conf * 1.2
    v += min(1.0, strength / 365) * 1.0
    v += (arousal / 10.0) * 0.8
    v += imp * 0.8
    # 禁区不允许被淘汰
    if p.get("kind") == "taboo":
        v += 2.0
    if p.get("gold"):
        v += 3.0
    return v


def is_setting_layer(p):
    """这条是不是「设定」——我是谁，不是经历过什么。
    和 index.js 的 isSetting() 同一套判据：设定不参与核心层的容量淘汰。
    """
    if p.get("kind") in ("taboo", "setting"):
        return True
    if p.get("factKey"):
        return True
    if str(p.get("origin") or "") == "import":
        return True
    # 2026-11-11 删掉一条判据：原来是 `era == "ds"` 也算设定。
    # 可 era 只是「哪来的」——导入的历史全打 ds，结果一百多条老记忆全成了
    # 永不衰减的设定，衰减等于没在工作。来源不是身份，不能拿来当免死金牌。
    return False


def rebalance_layers(data):
    """重排分层。返回变动说明。
    规矩：
      1. 一条记忆只属一层
      2. 超容量时淘汰最低分的，被淘汰的去下一层（不是删）
      3. 五层永不物理删除
    """
    pts = [p for p in data.get("points", []) if not p.get("dead")]
    changes = []

    # 先兜底：layer 不合法的归到经历
    for p in pts:
        if p.get("layer") not in LAYERS:
            p["layer"] = "experience"

    # 核心层：设定不占名额、不参与淘汰。
    # 之前 118 条设定和 4 条经历一起抢 7 个位置，按分数排，
    # 结果所有设定被踩到 relation 层 —— 设定不该跟经历抢位置。
    core_all = [p for p in pts if p["layer"] == "core"]
    core_fixed = [p for p in core_all if is_setting_layer(p)]
    core_flow = sorted([p for p in core_all if not is_setting_layer(p)],
                       key=layer_value, reverse=True)
    # 流动席位 = 7 - 设定占的（最少留 1 个给经历）
    flow_cap = max(1, LAYER_CAP["core"] - 0)
    while len(core_flow) > flow_cap:
        drop = core_flow.pop()
        drop["layer"] = "relation"
        changes.append(("降级", drop, "core", "relation"))

    # 关系层：最多 20 条。
    # 2026-11-08 改：以前满了就按顺序往下压到经历层，压下去就开始淡——
    # 等于"重要，但排队排后面"被当成"不重要"。现在改成：排不上的标"待晋升"，
    # 留在关系层不进淘汰，不加速变淡；等有空位再按分数进来。
    # 2026-11-11 删掉"排队/待晋升"这一套。
    # 为什么：它给九十多条打了 pending 标记，可全库没有一处读它——
    # 标签不等于机制。一百多条的库，排序交给分数就行，不需要假的排号。
    rel = sorted([p for p in pts if p["layer"] == "relation"],
                 key=layer_value, reverse=True)

    # 升级：经历里被想起 3 次以上、可信度过 0.7 的，进关系层
    for p in pts:
        if p["layer"] != "experience":
            continue
        recalls = int(p.get("recallCount") or 0)
        conf = float(p.get("confidence") or 0)
        if recalls >= 3 and conf >= 0.7 and len(rel) < LAYER_CAP["relation"]:
            p["layer"] = "relation"
            rel.append(p)
            changes.append(("升级", p, "experience", "relation"))

    # 再升级：关系层里被想起 5 次以上、够值的，进核心
    # 2026-11-11 修：这里原来写的是 core，可 core 从来没过定义——
    # 整个函数跑到这一行就抛 NameError，所以它一次都没执行成功过，
    # 库里 core 才堆到一百三十八条（设定不占名额，但流动席位压根没被收）。
    # 现在改用上面算好的核心流动席位 core_flow，判断"还有没有空位"。
    for p in sorted(rel, key=layer_value, reverse=True):
        if len(core_flow) >= flow_cap:
            break
        recalls = int(p.get("recallCount") or 0)
        if recalls >= 5 and layer_value(p) >= 4.0 and not any(x is p for x in core_flow):
            p["layer"] = "core"
            core_flow.append(p)
            changes.append(("升级", p, "relation", "core"))

    # 沉淀：同一实体 + 同分类的经历被反复印证，升成一条沉淀
    # （这里只做「标记候选」，真正的沉淀由 AI 写，不自动生成）
    return changes


# ---------------------------------------------------------------------------
# 沉淀自动升级：同一件事在不同日子出现 3 次以上，够格变成一条认识
# 风险文档：「沉淀升级虚假触发：简单重复对话算作三次独立印证」
#   → 必须不同日子、必须不同上下文
# ---------------------------------------------------------------------------

def find_sediment_candidates(data, min_days=3):
    """找出该沉淀的组。只看经历层，不看已经是沉淀的。"""
    from collections import defaultdict
    alive = [p for p in data.get("points", [])
             if not p.get("dead") and not p.get("validUntil")]
    groups = defaultdict(list)
    for p in alive:
        if p.get("layer") in ("sediment", "core"):
            continue
        ents = (p.get("entities") or [])[:2]
        cats = (p.get("category") or [])[:1]
        if not ents or not cats:
            continue
        key = "+".join(ents) + "|" + cats[0]
        groups[key].append(p)

    out = []
    for key, lst in groups.items():
        if len(lst) < min_days:
            continue
        # 必须来自不同的日子
        days = set()
        for p in lst:
            b = int(p.get("born") or 0)
            if b:
                days.add(b // 86400000)
        if len(days) < min_days:
            continue
        # 可信度要够
        conf = sum(float(p.get("confidence") or 0.8) for p in lst) / len(lst)
        if conf < 0.6:
            continue
        ents, cat = key.split("|")
        out.append({
            "key": key,
            "count": len(lst),
            "days": len(days),
            "confidence": round(conf, 2),
            "entities": ents.split("+"),
            "category": cat,
            "titles": [p.get("title") for p in lst[:4]],
        })
    out.sort(key=lambda x: (-x["days"], -x["count"]))
    return out[:8]


# ---------------------------------------------------------------------------
# 幂律遗忘 · FSRS 家族（跟 index.js 的 retention.js 同一套）
# R(t, S) = (1 + 19/81 · t/S)^(-0.5)
# 稳定性 S 的单位是「天」，表示 R 掉到约 0.9 需要多久。
# ---------------------------------------------------------------------------

MIN_STABILITY = 0.25
MAX_STABILITY = 3650.0


def initial_stability(imp=0.3, arousal=5.0, schema=False, affect=0.0):
    """初始稳定性。重要度是主项，情绪唤醒往上加。

    跟 retention.js 一样：0.5 + 20·imp² + 8·salience + 4·|affect|
    salience = arousal / 10（把 0-10 归一到 0-1）
    """
    imp = max(0.0, min(1.0, float(imp or 0.3)))
    sal = max(0.0, min(1.0, float(arousal or 5.0) / 10.0))
    # 跟 retention.js 一致：50/20/8（原版 20/8/4 在 imp 平均 0.6 时只给 12 天）
    base = 0.5 + 50.0 * imp * imp + 20.0 * sal + 8.0 * abs(float(affect or 0.0))
    if schema:
        base *= 3.0
    return max(MIN_STABILITY, min(MAX_STABILITY, base))


def initial_difficulty(imp=0.3, errors=0):
    """初始难度 0..1：重要的、情绪清楚的更好记（难度更低）。"""
    imp = max(0.0, min(1.0, float(imp or 0.3)))
    return max(0.0, min(1.0, 0.7 - 0.35 * imp + 0.15 * min(int(errors or 0), 2)))


def retrievability(elapsed_days, stability_days):
    """过了多少天，还剩多少（0..1）。"""
    t = max(0.0, float(elapsed_days or 0))
    s = max(MIN_STABILITY, float(stability_days or MIN_STABILITY))
    return math.pow(1.0 + (19.0 / 81.0) * t / s, -0.5)


def add_one(data, title, text, kind="feeling", imp=None, gold=False, hub=False, polarity=0,
            arousal=None, category=None, entities=None, fact_key=None, layer=None,
            said=None, replied=None, after=None, her_side=None, confidence=None,
            emotion=None, target=None, origin="user", open_flag=False,
            falsifier=None, cost=None, evidence=None):
    """往里塞一条，返回 (point, 连到谁, 附加信息)。

    单条写入和批量导入共用这一份。
    新字段全部在这里落地：情绪八维、强度、分类、实体、事实键、双向、失效。
    """
    # ---- 门禁：所有写入都必须过这一关，任何调用路径都绕不过 ----
    v = validate_write(title, text, kind, polarity, arousal, imp,
                       fact_key, category, entities, emotion,
                       her_side, confidence, _SEA_HINT[0] or "main")
    title = v["title"]
    text = v["text"]
    kind = v["kind"]
    pol = v["polarity"]
    imp_v = v["imp"]
    aw = v["arousal"]
    fact_key = v["fact_key"]
    category = v["category"] or None
    entities = v["entities"] or None
    emotion = v["emotion"]
    her_side = v["her_side"]
    confidence = v["confidence"]

    pts = data["points"]
    eds = data["edges"]
    now_ms = int(time.time() * 1000)
    nid = max([p.get("id", 0) for p in pts] or [0]) + 1
    idx = len(pts)
    rnd = random.Random(nid)
    x, y, z = pick_xyz(pts, "dsh", kind, rnd)

    _decided_layer, _decided_why = decide_layer(kind, imp_v, gold, text, title)
    point = {
        "id": nid,
        "title": title.strip()[:60],
        "titleFull": title.strip(),
        "text": text.strip(),
        "kind": kind,
        "tag": TAGS.get(kind, "〔实〕"),
        "era": "dsh",
        "imp": imp_v,
        "src": "第%03d节点" % nid,
        "x": x,
        "y": y,
        "z": z,
        "born": now_ms,
        "lastSeen": now_ms,
        "polarity": pol,

        # ---- 新字段 ----
        "arousal": aw,
        "category": (list(category) if category else guess_categories(text, kind))[:3],
        "entities": (list(entities) if entities else extract_entities(text))[:6],
        # 别人会怎么问这条：写的时候顺手给一句口语问法。
        # 为什么用环境变量：参数表已经很长，加一个 flag 要动三处；
        # 这里只在"写"这一个动作里读一次，够了。2026-11-11 深夜。
        "alias": ((os.environ.get("DSH_SEA_ALIAS") or "").strip() or None),
        "layer": layer or _decided_layer,
        "layerWhy": _decided_why,
        "emotion": (dict(emotion) if emotion else guess_emotion(text, pol, kind)),
        "target": target,
        "herSide": (her_side if her_side else None),

        # 双向记忆：他说什么、她回什么、后来怎样
        "said": said,
        "replied": replied,
        "after": after,

        # 时序：什么时候成立、什么时候失效
        "validFrom": now_ms,
        "validUntil": None,
        "factKey": fact_key or None,

        "evidence": "".join(list(text.strip())[:400]),
        "confidence": float(confidence) if confidence is not None else guess_confidence(text),
        "conflictWith": [],
        "triggers": extract_triggers(text, nid),
        "falsifier": falsifier or None,
        "cost": cost or None,
        "evidenceRef": evidence or None,
        "origin": origin,
        "open": bool(locals().get("open_flag")),   # 没闭环的事（活口）
        "recallCount": 0,
        "strength": round(initial_stability(imp or 0.5, aw), 2),
        "difficulty": round(initial_difficulty(imp or 0.5), 3),
    }
    if gold:
        point["gold"] = True
    if hub:
        point["hub"] = True

    # 事实键：同一个键只留最新。旧的不删，标失效（学 Graphiti）
    superseded = []
    if fact_key:
        for old_p in find_fact_collision(pts, fact_key):
            old_p["validUntil"] = now_ms
            superseded.append({"id": old_p.get("id"), "title": old_p.get("title")})

    pts.append(point)

    # 矛盾：共实体 + 同分类 + 相反极性 + 内容像 → 双向标出来，不自动改
    conflict = None
    try:
        c = find_conflict(pts, point)
        if c is not None:
            point["conflictWith"].append(c.get("id"))
            cl = c.setdefault("conflictWith", [])
            if point["id"] not in cl:
                cl.append(point["id"])
            conflict = {"id": c.get("id"), "title": c.get("title")}
    except Exception:
        conflict = None

    added = link(pts, eds, idx, point["text"], kind, 4, same_era=True)

    # 写完重排一次分层（五层流动）
    layer_changes = []
    try:
        layer_changes = rebalance_layers(data)
    except Exception:
        layer_changes = []

    return point, added, {
        "superseded": superseded,
        "conflict": conflict,
        "layers": layer_changes,
    }


def _mk_ev(file, line, quote):
    """三个独立参数拼成证据指针。缺 file 就当没有。"""
    if not file:
        return None
    try:
        n = int(line) if line not in (None, "") else 0
    except Exception:
        n = 0
    return {"file": str(file), "line": n, "quote": (quote or "")[:200]}


def _parse_evidence(raw):
    """命令行传过来的是 JSON 字符串，解成 dict。解不开就当没有。"""
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        o = json.loads(raw)
        if isinstance(o, dict) and o.get("file"):
            return o
    except Exception:
        pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", default="")
    ap.add_argument("--text", default="")
    ap.add_argument("--kind", default="feeling", choices=list(TAGS))
    ap.add_argument("--imp", type=float, default=None)
    ap.add_argument("--edges", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--migrate", action="store_true")
    ap.add_argument("--split", action="store_true")
    ap.add_argument("--touch", action="store_true")
    ap.add_argument("--spread", type=float, default=0)
    ap.add_argument("--relink", type=int, default=0)
    ap.add_argument("--relink-all", type=int, default=0, dest="relink_all",
                    help="整个识海重连一遍：每条补到 N 根边")
    ap.add_argument("--relink-n", type=int, default=10, dest="relink_n")
    ap.add_argument("--rehub", type=int, default=0)
    ap.add_argument("--detach", type=int, default=0)
    ap.add_argument("--isolate-dsh", action="store_true", dest="isolate_dsh")
    ap.add_argument("--dedupe", action="store_true")
    ap.add_argument("--gold", action="store_true", help="标成里程碑（金色光辉）")
    ap.add_argument("--hub", action="store_true", help="标成主桥（通往旧记忆的那扇门）")
    ap.add_argument("--sea", default="main", help="往哪个识海写，默认 main")
    ap.add_argument("--import-file", default="", dest="import_file", help="批量导入：一个 JSON 数组文件")
    ap.add_argument("--polarity", type=int, default=0, choices=[-1, 0, 1],
                    help="情绪极性：1 正 / 0 中 / -1 负")
    # ---- 新字段的参数 ----
    ap.add_argument("--arousal", type=int, default=None,
                    help="强度 0-10。不给就按文本判")
    ap.add_argument("--category", action="append", default=None,
                    help="分类，可以给多次：--category 关系 --category 偏好")
    ap.add_argument("--entity", action="append", default=None,
                    help="实体，可以给多次：--entity 上海 --entity 阿宁")
    ap.add_argument("--fact-key", default=None, dest="fact_key",
                    help="事实键，如 her.weight。同键只留最新")
    ap.add_argument("--layer", default=None,
                    help="分层：core / relation / fact / experience / sediment")
    ap.add_argument("--said", default=None, help="他当时说的原话")
    ap.add_argument("--replied", default=None, help="她当时怎么回的")
    ap.add_argument("--after", default=None, help="后来怎样")
    ap.add_argument("--her-felt", default=None, dest="her_felt",
                    help="她当时感觉到什么")
    ap.add_argument("--her-wanted", default=None, dest="her_wanted",
                    help="她当时想做什么")
    ap.add_argument("--her-did", default=None, dest="her_did",
                    help="她实际做了什么")
    ap.add_argument("--her-regret", default=None, dest="her_regret",
                    help="她后悔什么")
    ap.add_argument("--confidence", type=float, default=None,
                    help="可信度 0-1。气话、玩笑给低")
    ap.add_argument("--target", default=None,
                    help="情绪对谁")
    ap.add_argument("--open", action="store_true", dest="open_flag",
                    help="标成没闭环的事（活口）。上下文交接时会被带过去")
    ap.add_argument("--falsifier", default=None,
                    help="什么会推翻这条。没有反例的记忆多半越写越像宣传册")
    ap.add_argument("--cost", default=None,
                    help="这条的代价是什么。没有 cost 的记录多半是表演")
    ap.add_argument("--ev-file", default=None, help="证据：raw 里的文件名")
    ap.add_argument("--ev-line", default=None, help="证据：第几行")
    ap.add_argument("--ev-quote", default=None, help="证据：原文摘一句")
    a = ap.parse_args()

    sea = (a.sea or "main").strip()
    if sea == "main":
        raw = load()
        pre, js, post = split_data(raw)
        # 多识海之后，data.json 才是权威；html 只是模板 + 渲染结果
        jsonp = os.path.join(SEAS, "main", "data.json")
        if os.path.exists(jsonp):
            try:
                with open(jsonp, encoding="utf-8-sig") as f:
                    data = json.load(f)
            except Exception:
                data = json.loads(js)
        else:
            data = json.loads(js)
    else:
        raw = ""
        pre = js = post = None
        data = load_sea(sea)
    pts, eds = data["points"], data["edges"]

    if a.list:
        print("共 %d 条 · %d 条突触" % (len(pts), len(eds)))
        eras = {}
        for p in pts:
            eras[p.get("era", "?")] = eras.get(p.get("era", "?"), 0) + 1
        print("  " + " · ".join("%s %d" % kv for kv in eras.items()))
        for p in pts[-15:]:
            print("  #%-4s %-4s %-6s %s" % (p.get("id"), p.get("era", "?"), p.get("kind"), p.get("title")))
        return

    if a.migrate:
        n = 0
        for p in pts:
            if "era" not in p:
                p["era"] = "ds"
                n += 1
        if not n:
            print("已经全部带 era，不用迁")
            return
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("迁了 %d 条老记忆 -> era=ds" % n)
        return

    if a.touch:
        build_touch()
        print("触屏版已重新生成：" + TOUCH)
        return

    if a.split:
        if data["stats"].get("split"):
            print("已经分过球了，跳过")
            return
        OFF = 1.55
        for p in pts:
            p["x"] = round(p["x"] + (OFF if p.get("era") == "dsh" else -OFF), 3)
        data["stats"]["split"] = 1
        data["stats"]["spread"] = OFF
        data["generatedAt"] = time.strftime("%Y-%m-%d %H:%M")
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("分成两个球：DS 左移 %.2f，DSH 右移 %.2f" % (OFF, OFF))
        return

    if a.spread:
        cur = data["stats"].get("spread", 1.55)
        delta = a.spread - cur
        if abs(delta) < 1e-6:
            print("已经这么远了，不用动")
            return
        for p in pts:
            p["x"] = round(p["x"] + (delta if p.get("era") == "dsh" else -delta), 3)
        data["stats"]["spread"] = a.spread
        data["generatedAt"] = time.strftime("%Y-%m-%d %H:%M")
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("两球间距：每边 %.2f -> %.2f（总距 %.1f）" % (cur, a.spread, a.spread * 2))
        return

    if a.import_file:
        path = a.import_file
        if not os.path.exists(path):
            raise SystemExit("找不到导入文件：" + path)
        with open(path, encoding="utf-8-sig") as f:
            items = json.load(f)
        if not isinstance(items, list):
            raise SystemExit("导入文件得是一个 JSON 数组")
        n = 0
        for it in items:
            if not isinstance(it, dict):
                continue
            title = str(it.get("title") or "").strip()
            text = str(it.get("text") or "").strip()
            if not text:
                continue
            if not title:
                title = text[:16]
            kind = str(it.get("kind") or "feeling")
            if kind not in TAGS:
                kind = "feeling"
            imp = it.get("imp")
            try:
                imp = float(imp) if imp is not None else None
            except Exception:
                imp = None
            # 导入时也走完整的新字段逻辑
            add_one(
                data, title, text, kind, imp,
                polarity=int(it.get("polarity") or 0),
                arousal=it.get("arousal"),
                category=it.get("category"),
                entities=it.get("entities"),
                fact_key=it.get("factKey") or it.get("fact_key"),
                said=it.get("said"),
                replied=it.get("replied"),
                after=it.get("after"),
                her_side=it.get("herSide") or it.get("her_side"),
                confidence=it.get("confidence"),
                origin=str(it.get("origin") or "import"),
                evidence=it.get("evidence"),
                falsifier=it.get("falsifier"),
                cost=it.get("cost"),
            )
            n += 1
        if not n:
            print("nothing to import")
            return
        restat(data)
        if sea == "main":
            newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
            save(pre + newjs + post)
        else:
            write_sea(sea, data)
        print("导入 %d 条，现在共 %d 条 · %d 条突触" % (n, len(pts), len(eds)))
        return

    if a.dedupe:
        seen = set()
        keep = []
        for e in eds:
            k = (min(e["a"], e["b"]), max(e["a"], e["b"]))
            if k in seen:
                continue
            seen.add(k)
            keep.append(e)
        n = len(eds) - len(keep)
        eds[:] = keep
        restat(data)
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("去掉 %d 条重复边，剩 %d 条" % (n, len(eds)))
        return

    if a.isolate_dsh:
        cut = 0
        for i, p in enumerate(pts):
            if p.get("era") != "dsh" or p.get("id") == HUB_ID:
                continue
            before = len(eds)
            eds[:] = [
                e
                for e in eds
                if not (
                    (e["a"] == i or e["b"] == i)
                    and pts[e["b"] if e["a"] == i else e["a"]].get("era", "ds") != "dsh"
                )
            ]
            cut += before - len(eds)
            link(pts, eds, i, p.get("text", ""), p.get("kind"), 2, same_era=True)
        restat(data)
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("摘掉 DSH 通向 DS 的 %d 条边，其余新记忆只在自家内部连" % cut)
        return

    if a.detach:
        hi = next((i for i, p in enumerate(pts) if p.get("id") == a.detach), None)
        if hi is None:
            raise SystemExit("没有 id=%d 这个节点" % a.detach)

        def other(e):
            return e["b"] if e["a"] == hi else e["a"]

        before = len(eds)
        eds[:] = [
            e
            for e in eds
            if not (
                (e["a"] == hi or e["b"] == hi) and pts[other(e)].get("era", "ds") == "dsh"
            )
        ]
        restat(data)
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("从 #%d 身上摘掉 %d 条通往 DSH 的线，剩 %d 条" % (a.detach, before - len(eds), len(eds)))
        return

    if a.rehub:
        hub = a.rehub
        hi = next((i for i, p in enumerate(pts) if p.get("id") == hub), None)
        if hi is None:
            raise SystemExit("没有 id=%d 这个节点" % hub)
        n = 0
        for i, p in enumerate(pts):
            if i == hi or p.get("era") != "dsh":
                continue
            if any((e["a"] == i and e["b"] == hi) or (e["b"] == i and e["a"] == hi) for e in eds):
                continue
            eds.append({"a": min(i, hi), "b": max(i, hi), "w": 0.26})
            n += 1
        restat(data)
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("把 %d 条 DSH 记忆钉到主干 #%d 上" % (n, hub))
        return

    if a.relink_all:
        # 整个识海重连：图太稀的话模式补全（CA3）凑不出共同邻居。
        # 实测 5.4 根/条时补全命中 18%，8.2 根/条时 41%，检索准确率一条没变。
        target = max(2, int(a.relink_all))
        before = len(eds)
        touched = 0
        for idx_, pt_ in enumerate(pts):
            if pt_.get("dead"):
                continue
            cur = sum(1 for e_ in eds if e_["a"] == idx_ or e_["b"] == idx_)
            if cur >= target:
                continue
            link(pts, eds, idx_, pt_.get("text", ""), pt_.get("kind"), target, same_era=True)
            touched += 1
        restat(data)
        write_sea(a.sea, data)
        print("重连：" + str(before) + " → " + str(len(eds)) + " 根边（动了 "
              + str(touched) + " 条记忆）")
        return
    if a.relink:
        tid = a.relink
        ti = next((i for i, p in enumerate(pts) if p.get("id") == tid), None)
        if ti is None:
            raise SystemExit("没有 id=%d 这个节点" % tid)
        old = sum(1 for e in eds if e["a"] == ti or e["b"] == ti)
        eds[:] = [e for e in eds if e["a"] != ti and e["b"] != ti]
        added = link(pts, eds, ti, pts[ti]["text"], pts[ti].get("kind"), a.relink_n)
        restat(data)
        newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))
        out = pre + newjs + post
        json.loads(split_data(out)[1])
        save(out)
        print("#%d 的边 %d -> %d 条" % (tid, old, len(added)))
        print("  连到：" + ", ".join("#%s(%.2f)" % t for t in added))
        return

    _SEA_HINT[0] = sea

    if not a.title.strip() or not a.text.strip():
        raise SystemExit("title 和 text 都得给")

    # 门禁可能拒绝，给一句人话而不是堆栈
    try:
        pass
    except WriteRejected:
        pass

    # 单条写入：走 add_one，跟批量导入用同一套逻辑
    her_side = None
    if a.her_felt or a.her_wanted or a.her_did or a.her_regret:
        her_side = {
            "felt": a.her_felt or None,
            "wanted": a.her_wanted or None,
            "did": a.her_did or None,
            "regret": a.her_regret or None,
        }

    point, added, extra = add_one(
        data,
        a.title, a.text, a.kind, a.imp,
        gold=a.gold, hub=a.hub,
        polarity=a.polarity,
        arousal=a.arousal,
        category=(a.category if a.category else None),
        entities=(a.entity if a.entity else None),
        fact_key=a.fact_key,
        layer=a.layer,
        said=a.said,
        replied=a.replied,
        after=a.after,
        her_side=her_side,
        confidence=a.confidence,
        target=a.target,
        origin="user",
        open_flag=a.open_flag,
        falsifier=getattr(a, "falsifier", None),
        cost=getattr(a, "cost", None),
        evidence=(_mk_ev(getattr(a, "ev_file", None),
                         getattr(a, "ev_line", None),
                         getattr(a, "ev_quote", None))),
    )
    nid = point["id"]
    x, y, z = point["x"], point["y"], point["z"]
    restat(data)

    newjs = json.dumps(data, ensure_ascii=False, separators=(", ", ": "))

    print("#%d  %s  [%s]" % (nid, point["title"], a.kind))
    print("  xyz = (%.2f, %.2f, %.2f)" % (x, y, z))
    print("  强度 %d/10 · 分类 %s · 层 %s · 实体 %s" % (
        point["arousal"], "/".join(point["category"]), point["layer"],
        "/".join(point["entities"]) if point["entities"] else "（无）"))
    if point.get("factKey"):
        print("  事实键 %s" % point["factKey"])
    if point.get("emotion"):
        hot = [(k, v) for k, v in point["emotion"].items() if v > 0]
        if hot:
            print("  情绪 " + " · ".join("%s %.2f" % (k, v) for k, v in hot))
    if point.get("said") or point.get("replied") or point.get("after"):
        print("  双向：他说「%s」→ 她回「%s」→ 后来 %s" % (
            (point.get("said") or "—"), (point.get("replied") or "—"),
            (point.get("after") or "—")))
    hs = point.get("herSide")
    if hs:
        print("  她的感受：%s" % (hs.get("felt") or "—"))
        if hs.get("wanted"):
            print("            想：%s" % hs["wanted"])
        if hs.get("did"):
            print("            做了：%s" % hs["did"])
        if hs.get("regret"):
            print("            后悔：%s" % hs["regret"])
    for s in (extra.get("superseded") or []):
        print("  取代了 #%s %s（旧的不删，标失效）" % (s["id"], s["title"]))
    for chg in (extra.get("layers") or [])[:4]:
        kind_, pt_, frm, to = chg
        print("  %s #%s「%s」%s → %s" % (
            kind_, pt_.get("id"), str(pt_.get("title"))[:16],
            LAYER_LABEL.get(frm, frm), LAYER_LABEL.get(to, to)))
    if extra.get("conflict"):
        c = extra["conflict"]
        print("  ⚠ 跟 #%s「%s」打架，已双向标记" % (c["id"], c["title"]))
    print("  连边 -> " + ", ".join("#%s(w=%.2f)" % t for t in added))
    print("  库里现在 %d 条 · %d 条突触" % (len(pts), len(eds)))
    if a.dry_run:
        print("  [dry-run] 没写盘")
        return

    if sea == "main":
        out = pre + newjs + post
        # 自检：改完还能解析回去
        pre2, js2, post2 = split_data(out)
        json.loads(js2)
        assert post2 == post and pre2 == pre
        save(out)
        print("  已写入识海 main（data.json）")
    else:
        write_sea(sea, data)
        print("  已写入识海 " + sea)


if __name__ == "__main__":
    try:
        main()
    except WriteRejected as e:
        print("拒绝写入：" + e.reason + (("（" + e.detail + "）") if e.detail else ""))
        print("  这条没写进去。宁可不记，也不记脏的。")
        sys.exit(2)
