"""文档结构自检（按《文档撰写规范》能自动查的那几条）。

跑法：python scripts/doc_check.py [docx 路径]
"""
import os
import re
import sys

from docx import Document

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def cn2num(s):
    """九十一 → 91，八十三 → 83，十 → 10，二十三 → 23"""
    s = (s or "").strip()
    if not s:
        return -1
    if "十" in s:
        left, _, right = s.partition("十")
        tens = CN.get(left, 1) if left else 1
        ones = CN.get(right, 0) if right else 0
        return tens * 10 + ones
    n = 0
    for ch in s:
        if ch not in CN:
            return -1
        n = n * 10 + CN[ch]
    return n


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.expanduser("~"), "Desktop", "识海_项目说明材料.docx")
    if not os.path.exists(path):
        print("找不到文档:", path)
        return 1
    d = Document(path)
    ps = [p.text.strip() for p in d.paragraphs]

    passed, fails = 0, []

    def ok(name, cond, extra=""):
        nonlocal passed
        if cond:
            passed += 1
            print("  通过  " + name)
        else:
            fails.append(name + (" → " + extra if extra else ""))
            print("  失败  " + name + (" → " + extra if extra else ""))

    def idx(pred):
        for i, t in enumerate(ps):
            if pred(t):
                return i
        return -1

    i_cover = idx(lambda t: t == "识　海")
    i_toc = idx(lambda t: t == "目　录")
    i_p1 = idx(lambda t: t == "第一部分　正文")
    # 目录里也有"第二部分…"这些字，所以只在第一部分之后找
    def idx_after(pred, start):
        for i in range(start, len(ps)):
            if pred(ps[i]):
                return i
        return -1

    i_design = idx_after(lambda t: t.startswith("第二部分"), max(i_p1, 0) + 1)
    i_ref = idx_after(lambda t: t.startswith("第三部分"), max(i_design, 0) + 1)
    i_log = idx_after(lambda t: t.startswith("第四部分"), max(i_ref, 0) + 1)

    ok("有封面", i_cover >= 0)
    ok("封面在目录之前", 0 <= i_cover < i_toc)
    ok("目录在第一部分之前", 0 <= i_toc < i_p1)
    ok("四部分标题齐全且顺序对", 0 <= i_p1 < i_design < i_ref < i_log)
    ok("参考手册在修订记录之前", 0 < i_ref < i_log)

    # 附录只在目录之后算，别把目录里那几行列进来
    apps = [(i, t) for i, t in enumerate(ps) if re.match(r"^附录 [A-P]　", t)]
    letters = "".join(t[3:4] for _, t in apps)
    ok("附录集合正确", letters == "ABCEJKLMNOPDFGHI", "实际 " + letters)
    in_ref = "".join(t[3:4] for i, t in apps if i_ref < i < i_log)
    ok("参考手册八个附录齐", in_ref == "EJKLMNOP", "实际 " + in_ref)
    in_log = "".join(t[3:4] for i, t in apps if i > i_log)
    ok("修订记录五个且按日期升序", in_log == "DFGHI", "实际 " + in_log)

    def body_of(letter):
        start = next(i for i, t in apps if t[3:4] == letter)
        nxt = next((i for i, t in apps if i > start), len(ps))
        return [t for t in ps[start + 1:nxt] if t]

    k_title = next(t for _, t in apps if t[3:4] == "K")
    k_body = [t for t in body_of("K") if t.startswith("lib/")]
    m = re.search(r"（(.+?)个文件", k_title)
    ok("附录 K 标题数量与实际一致", m and cn2num(m.group(1)) == len(k_body),
       "标题 %s / 实际 %d" % (m.group(1) if m else "?", len(k_body)))

    l_body = [t for t in body_of("L") if t.startswith("memory_")]
    l_title = next(t for _, t in apps if t[3:4] == "L")
    ok("附录 L 工具数与标题一致", str(len(l_body)) in l_title, "标题 %s / 实际 %d" % (l_title[-12:], len(l_body)))

    o_body = [t for t in ps if t.startswith("/consciousness")]
    o_title = next(t for _, t in apps if t[3:4] == "O")
    ok("附录 O 接口数与标题一致", str(len(o_body)) in o_title, "标题 %s / 实际 %d" % (o_title[-12:], len(o_body)))

    ok("有覆盖声明", any("覆盖声明" in t for t in ps))
    ok("写了没验过的", any("没验过" in t or "Linux" in t for t in ps))

    print("")
    print("通过 %d · 失败 %d" % (passed, len(fails)))
    for f in fails:
        print("  · " + f)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
