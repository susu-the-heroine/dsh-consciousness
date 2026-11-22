# 识海 GL 复刻 · 交接（2026-11-13 夜）

> 目标：**同一页，只换渲染**。现在的进度：layout 已对齐，器官/面板/树突还没上。

## 一、已核实的事实（别再来回猜）

1. **坐标不在前端算**。`data.json` 每条记忆自带 `x / y / z`（如 #1 = -2.269 / 0.006 / 1.259）。
   排版是服务端算好落库的。客户端只做投影。
2. **两个球**。`era` 字段：`ds` = DeepSeek（冻结，113 条）、`dsh` = DeepSeek Harness（会长，91 条）。
   球心是两个 era 各自坐标的均值（源码 3864 行 `balls`）。
3. **投影**（源码 3836 `proj()`，四行旋转，照抄别改）：

```js
x1 = p.x*cy - p.z*sy;  z1 = p.x*sy + p.z*cy;
y1 = p.y*cx - z1*sx;   z2 = p.y*sx + z1*cx;
base = Math.min(W,H)*0.62/3.2;
den  = Math.max(1.05, 3.2 + z2);
s    = Math.min(base*2.35, base*3.2*zoom/den) * breath * AGE_SCALE * (1 - lungBreath*0.014);
屏幕 = { x: CX + x1*s, y: CY + y1*s, s, z: z2, k: s/base };
// breath = 1 + 0.013*Math.sin(BREATH_T);  BREATH_T = t*0.55
```

4. **自转**：`if(spin) tRy += .00018`（每帧），取 `ry += (tRy-ry)*0.06` 缓动。
5. **六色**（875 行）：event `#a9c6ff`、feeling `#d98aa6`、fact `#79c7c0`、plan `#ffab3f`、
   conclusion `#a97cff`、taboo `#e0a45a`。
6. **连线颜色跟源神经**，透明度按权重分档（4412 行）：`v.color + '9c' / '78' / '52'`。
7. **神经形态**（2160 `vectorize()`）：递归分枝 + 二次曲线 + 树突棘 + 末梢小结；
   三类参数见 2171–2175（fact 锥体 / feeling 星形 / taboo 带刺）。
   末梢小结 `max(0.27, w*1.5)`；胞体 `max(1.25, size*0.40)`。
8. **器官底图**：`drawAmy` 3260、`drawLiver` 3291、`drawHippo` 3327、`drawLungs` 3381 与 3534、
   `drawHeart` 3612。画在最底层，线只连到心脏。
9. **标签**：`ctx.fillText`（1851 起气泡文字、3528 器官标签）；避让用 `placed` 矩形数组。

## 二、当前产物

- `C:\Users\Administrator\Desktop\识海_GL复刻.html` —— WebGL 复刻页，**已用真坐标**。
- `C:\Users\Administrator\Desktop\sea_gl_data2.js` —— 带 x/y/z/era/kind/imp 的数据。
- `C:\Users\Administrator\Desktop\复刻_v1.png` —— 第一次截图：左边 ds 大团、右边 dsh 小团，
  **结构和真页一致**；缺器官、缺面板、缺树突、标签没夹住边界。

## 三、下一步（照顺序）

1. 把器官五个函数搬进来（2D canvas 压在 GL 上，或直接 GL 贴图）。
2. 标签：加边界夹取 + 完整避让（现在是简化版）。
3. 神经树突：把原型里那套 `vectorize` 移植到本页，尺寸用 `s`（投影缩放）乘常数。
4. 面板/工具栏：原页 DOM 直接复制，别重画。
5. 逐处比对：原页截图 vs 复刻截图，同尺寸、同数据、同相机角度。

## 四、截图方法（踩过坑）

无头 Edge 必须带 `--user-data-dir=<临时目录>`，否则和正在跑的 GUI 抢 profile，直接不出图。

```
msedge --headless=new --user-data-dir=%TEMP%\x --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=1600,1000 --virtual-time-budget=4000 --screenshot=out.png "file:///...html#t=1500"
```

`#t=毫秒` 把时间钉死，保证两次截图可复现。
