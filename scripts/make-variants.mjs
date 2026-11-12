/**
 * 从触屏版拆出两版：双板块、手机版。
 *
 * 为什么要这个脚本：2026-11-08 我把这三份用同一份覆盖了，版式全毁。
 * 以后不许手工拷——要版式就跑这里，规则写在代码里，能重跑。
 *
 * 做法只加 CSS，不动原来的 JS 和数据：
 *   触屏版结构是「左边一个球（canvas）+ 右边 360px 面板（#side）」。
 *   手机版：面板铺满、藏掉状态/时间轴/缩放条、字号放大。
 *   双板块：面板加宽到近一半，画布和面板各占一边，中间加一道光。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SRC = join(homedir(), '.dsh', 'consciousness-seas', '意识海_触屏版.html')
const DESK = join(homedir(), 'Desktop')

if (!existsSync(SRC)) {
  console.log('没找到触屏版：' + SRC)
  process.exit(1)
}
const html = readFileSync(SRC, 'utf8')

function inject(style, note) {
  const tag = `<style id="layout-variant">/* ${note} */\n${style}\n</style>\n</head>`
  return html.replace('</head>', tag)
}

const MOBILE = `
  /* 手机版：一列到底，面板铺满，藏掉桌面上才看得清的小件 */
  body{font-size:15px}
  #top{left:14px !important;top:12px !important}
  #top h1{font-size:17px !important;letter-spacing:.32em !important}
  #side{width:100vw !important;left:0 !important;right:0 !important;
        background:linear-gradient(180deg,rgba(5,9,16,.96),rgba(4,8,14,.99)) !important;
        backdrop-filter:none !important}
  #stat,#legend,#timebar,#zoombar,#seas,#guideBtn,#demoReset{display:none !important}
  #stream{max-height:180px !important}
  #emoPanel .ep-word{font-size:16px !important}
  #emoPanel .ep-sub{font-size:10.5px !important}
  canvas{cursor:default}
`

const DUAL = `
  /* 双板块：左边球，右边板块，各占一半，中间一道光分开 */
  #side{width:min(580px,48vw) !important;
        box-shadow:-1px 0 0 rgba(200,178,130,.18), -30px 0 80px rgba(200,178,130,.05) !important}
  #stat,#timebar,#zoombar{right:calc(min(580px,48vw) + 24px) !important}
  #top{left:26px !important}
  #side::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;
        background:linear-gradient(180deg,transparent,rgba(200,178,130,.35),transparent)}
`

const REAL = `
  /* 真实版：只看真数据。把引导、首次提示、演示重置、提示气泡全关掉，统计留着。 */
  #firstRun,#guide,#guideBtn,#demoReset,#snapNote,#tooltip{display:none !important}
  #side{width:400px !important}
  #stat,#timebar,#zoombar{right:432px !important}
`

const out = [
  ['意识海_手机版.html', inject(MOBILE, '手机版 · 2026-11-08 重做'), '手机版'],
  ['意识海_双板块.html', inject(DUAL, '双板块 · 2026-11-08 重做'), '双板块'],
  ['意识海_真实版.html', inject(REAL, '真实版 · 2026-11-08 重做'), '真实版'],
]

for (const [name, body, label] of out) {
  const p = join(DESK, name)
  writeFileSync(p, body, 'utf8')
  console.log(`${label} → ${p}（${Math.round(body.length / 1024)} KB）`)
}
