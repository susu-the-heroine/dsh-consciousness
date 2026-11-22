/**
 * 钉子清单
 * ========
 *
 * 什么进这里：**错一次就完**的东西——问一句就要对（名字、暗号、住哪）、
 * 答应过的、禁忌。别的都别钉。
 *
 * 为什么单独一份文件：真的写记忆是靠 add_memory.py 那个脚本跑的，
 * 往里加字段要动那个脚本；动不好会把库写坏。钉子只是"管理名单"，
 * 够用就行，先放外面，等这层稳了再并进库。
 *
 * 上限 15 条：超了就是全钉，等于没钉。
 *
 * 用法：
 *   node scripts/pins.mjs                 # 看清单
 *   node scripts/pins.mjs --add 153 暗号 暗号换了就该拔
 *   node scripts/pins.mjs --remove 153
 *   node scripts/pins.mjs --check         # 只检查，不改
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FILE = join(homedir(), '.dsh', 'consciousness-pins.json')
const CAP = 15

function load() {
  // 2026-11-21：文件坏了以前也当「一颗都没有」，接着 --add 就把坏文件覆盖成只剩新钉——
  // 旧的钉子一条不剩，而且不吭声。钉子又是「错一次就完」的那类东西，丢不起。
  // 现在分开说：没文件是没文件，读不动是读不动，读不动就不许写。
  if (!existsSync(FILE)) return { pins: [] }
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''))
    return { pins: Array.isArray(j.pins) ? j.pins : [] }
  } catch (e) {
    return { pins: [], broken: String((e && e.message) || e).slice(0, 80) }
  }
}

/** 读不动就别往下走：只读的动作可以继续（会显示空），写的动作一律拦下。 */
function stopIfBroken(o) {
  if (!o.broken) return
  console.log('钉子文件读不动：' + o.broken)
  console.log('文件在：' + FILE)
  console.log('先把它修好或挪走再加——我不拿一个空名单去覆盖它。')
  process.exit(3)
}

function save(o) {
  writeFileSync(FILE, JSON.stringify(o, null, 1), 'utf8')
}

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)

if (has('--add')) {
  const i = argv.indexOf('--add')
  const id = Number(argv[i + 1])
  const why = String(argv[i + 2] || '').trim()
  const until = String(argv[i + 3] || '').trim()
  if (!Number.isFinite(id) || !why || !until) {
    console.log('要三个东西：编号、为什么钉、什么时候该拔')
    process.exit(1)
  }
  const o = load()
  stopIfBroken(o)
  const exists = o.pins.find((x) => Number(x.id) === id)
  if (exists) {
    exists.why = why
    exists.until = until
    save(o)
    console.log('已更新 #' + id)
  } else {
    if (o.pins.length >= CAP) {
      console.log('已经有 ' + o.pins.length + ' 条了，上限 ' + CAP + '。先拔一条再加。')
      process.exit(1)
    }
    o.pins.push({ id, why, until, at: Date.now() })
    save(o)
    console.log('已钉 #' + id + '（' + o.pins.length + '/' + CAP + '）')
  }
} else if (has('--remove')) {
  const i = argv.indexOf('--remove')
  const id = Number(argv[i + 1])
  const o = load()
  stopIfBroken(o)
  const n = o.pins.length
  o.pins = o.pins.filter((x) => Number(x.id) !== id)
  save(o)
  console.log(n === o.pins.length ? '没这条' : '已拔 #' + id)
} else if (has('--due')) {
  // 该拔提醒：不猜语义，只看"挂上去多久了"。
  // 三个月没回来看过的钉子，自动提醒核一遍——不然钉子只会越来越多。
  const o = load()
  if (!o.pins.length) {
    console.log('一颗钉子都没有，没什么该拔的。')
  } else {
    const DAY = 86400000
    const now = Date.now()
    let due = 0
    for (const p of o.pins) {
      const days = p.at ? Math.floor((now - Number(p.at)) / DAY) : 999
      const flag = days >= 90 ? '该核了' : (days >= 60 ? '快三个月' : '还新')
      if (days >= 90) due++
      console.log('  #' + p.id + '  挂了 ' + days + ' 天  ' + flag + '  该拔：' + (p.until || '（没写）'))
    }
    console.log(due ? ('\n有 ' + due + ' 颗挂了超过三个月，逐条核一遍：条件到了就 --remove。') : '\n都还新，不用动。')
  }
} else {
  const o = load()
  if (!o.pins.length) {
    console.log('一颗钉子都没有。')
    console.log('钉子只钉三种：问一句就要对的、答应过的、禁忌。别的别往里塞。')
  } else {
    console.log('钉子 ' + o.pins.length + '/' + CAP)
    for (const p of o.pins) {
      console.log('  #' + p.id + '  为什么：' + p.why + '  该拔：' + p.until)
    }
  }
  if (has('--check')) {
    let bad = 0
    if (o.pins.length > CAP) { console.log('超上限了：' + o.pins.length + ' > ' + CAP); bad++ }
    for (const p of o.pins) {
      if (!p.why || !p.until) { console.log('#' + p.id + ' 缺字段'); bad++ }
    }
    console.log(bad ? '检查没过：' + bad + ' 处' : '检查通过')
    process.exit(bad ? 1 : 0)
  }
}
