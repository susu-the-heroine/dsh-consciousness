# -*- coding: utf-8 -*-
"""做一条 20 秒对比片。画面里的注入条数、记忆原文、两句回复，全部来自真跑。"""
import io, os, json, subprocess, urllib.request, urllib.parse, shutil, tempfile, re

FF = r"C:\Users\Administrator\tools\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"
FONT_ESCAPED = "C\\:/Windows/Fonts/msyhbd.ttc"
BASE = "http://127.0.0.1:50775"
HERE = os.path.dirname(os.path.abspath(__file__))
REPLIES = json.load(io.open(os.path.join(HERE, "demo_replies.json"), encoding="utf-8"))
OUT = os.path.join(os.path.expanduser("~"), "Desktop", "识海发版", "demo_video")
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    p = os.path.join(OUT, f)
    if os.path.isfile(p):
        os.remove(p)

TMP = os.path.join(tempfile.gettempdir(), "sea_demo_frames")
shutil.rmtree(TMP, ignore_errors=True)
os.makedirs(TMP, exist_ok=True)


def ask(sea, sid, text):
    u = "%s/consciousness/sim?text=%s&persist=0&sea=%s&sid=%s" % (
        BASE, urllib.parse.quote(text), sea, sid)
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def memlines(inj):
    out = []
    for line in str(inj or "").split("\n"):
        if "[记忆" in line and line.strip().startswith("·"):
            out.append(line.strip())
    return out


Q = REPLIES["q"]
leftN = len(memlines(ask("empty", "dvL", Q).get("inject")))
right = memlines(ask("demo", "dvR", Q).get("inject"))
print("空海注入: %d 条｜demo 注入: %d 条" % (leftN, len(right)))


def clean(s):
    s = s.replace("· ", "")
    s = re.sub(r"^\[记忆\d+\]\s*", "", s)
    s = re.sub(r"^\[[^\]]*\]\s*", "", s)
    return s


R1 = clean(right[0]) if right else ""
R2 = clean(right[1]) if len(right) > 1 else ""


def wrap(s, n=22, maxlines=3):
    s = str(s)
    return [s[i:i + n] for i in range(0, len(s), n)][:maxlines]


scenes = []
scenes.append((1.6, [("同一句话，两个结果", 62, 330, "white")]))
scenes.append((1.4, [("问：" + Q, 44, 330, "0x9ad0ff")]))

left_lines = [("没装识海 · 注入 %d 条" % leftN, 44, 140, "0xff8f8f")]
y = 240
for line in wrap(REPLIES["plain"], 24, 3):
    left_lines.append((line, 34, y, "0xe8e8e8"))
    y += 60
scenes.append((5.0, left_lines))

right_lines = [("装了识海 · 注入 %d 条" % len(right), 44, 110, "0x9dff9d")]
y = 200
for line in wrap(REPLIES["withMem"], 24, 3):
    right_lines.append((line, 34, y, "white"))
    y += 58
right_lines.append(("这次的回复是按上面两条记忆真跑出来的", 24, 430, "0x888888"))
scenes.append((6.0, right_lines))

mem_lines = [("她这一轮真捞到的是这两行", 36, 120, "0x9ad0ff")]
y = 220
for line in wrap(R1, 26, 2) + wrap(R2, 26, 2):
    mem_lines.append((line, 30, y, "0xdddddd"))
    y += 54
scenes.append((4.0, mem_lines))

scenes.append((2.0, [("不是模型变强", 52, 300, "white"),
                     ("是它记住了你", 52, 380, "white")]))
scenes.append((1.4, [("识海", 72, 320, "0xe8dfc8")]))

clips = []
for i, (dur, lines) in enumerate(scenes):
    filters = []
    for j, (txt, size, y, color) in enumerate(lines):
        tf = os.path.join(TMP, "s%d_l%d.txt" % (i, j))
        io.open(tf, "w", encoding="utf-8").write(txt)
        filters.append(
            "drawtext=fontfile='%s':textfile='%s':fontsize=%d:fontcolor=%s:"
            "x=(w-text_w)/2:y=%d" % (FONT_ESCAPED, tf.replace("\\", "/").replace(":", "\\:"), size, color, y))
    out = os.path.join(TMP, "clip%d.mp4" % i)
    cmd = [FF, "-y", "-f", "lavfi", "-i", "color=c=0x0b0f14:s=1280x720:d=%s" % dur,
           "-vf", ",".join(filters), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", out]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print("失败 scene", i, r.stderr.decode("utf-8", "ignore")[-300:])
        raise SystemExit(1)
    clips.append(out)

lst = os.path.join(TMP, "list.txt")
io.open(lst, "w", encoding="utf-8").write("\n".join("file '%s'" % c.replace("\\", "/") for c in clips))
final = os.path.join(OUT, "识海_同一句话_20秒.mp4")
r = subprocess.run([FF, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", final], capture_output=True)
if r.returncode != 0:
    print("拼接失败", r.stderr.decode("utf-8", "ignore")[-300:])
    raise SystemExit(1)

print("成片:", final)
print("大小: %.1f MB" % (os.path.getsize(final) / 1024 / 1024))
