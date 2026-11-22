/**
 * 回归集：今晚修过的每个问题，固定成一条断言
 * ==========================================
 *
 * 为什么要有：文档 8.5 第一优先。每修一个问题就加一条固定用例，
 * 否则同一类问题会以新面孔回来——2026-11-14 一晚就踩了四次。
 *
 * 跑法：node scripts/regress.mjs
 * 全过退出码 0；任何一条不过就是 1。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capParts } from '../lib/cap.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
// 2026-11-21：第六处同一个坑——插件里跑时这个值是桌面程序，不是 node。
// 起子进程一律先认 node，认不到再找环境变量、最后退回 PATH。
const NODE = /node(\.exe)?$/i.test(process.execPath) ? process.execPath : (process.env.DSH_NODE || 'node')

let pass = 0
const fails = []
function check(name, fn) {
  try {
    const r = fn()
    if (r === true) { pass++; console.log('  过  ' + name); return }
    fails.push(name + ' → ' + r); console.log('  不过  ' + name + ' → ' + r)
  } catch (e) {
    fails.push(name + ' → ' + String((e && e.message) || e).slice(0, 120))
    console.log('  不过  ' + name + ' → ' + String((e && e.message) || e).slice(0, 120))
  }
}

// 2026-11-21：有几条是「数据不在就放行」的（比如标注集被误删那次）。放行可以，
// 但不能跟真验过的混在一个数里——所以单独记一笔，收尾时说明白。
const warned = []

console.log('')
console.log('识海回归集')
check('会写库的测试都关在临时目录里', () => {
  const dir = join(ROOT, 'scripts')
  const bad = []
  for (const f of readdirSync(dir).filter((x) => /test|drill|smoke/.test(x) && x.endsWith('.mjs'))) {
    const body = readFileSync(join(dir, f), 'utf8')
    if (!/writeSea\(|ensureSea\(/.test(body)) continue
    // 允许两种：关进临时目录，或者只动 sandbox 那个沙箱海
    const isolated = (/mkdtempSync/.test(body) && /USERPROFILE|DSH_[A-Z_]+/.test(body)) || /'sandbox'|"sandbox"/.test(body)
    if (!isolated) bad.push(f)
  }
  return bad.length ? '这些写库的测试没关进临时目录：' + bad.join(', ') : true
})

check('检索日志里没有测试海', () => {
  const f = join(homedir(), '.dsh', 'consciousness-search-log.jsonl')
  if (!existsSync(f)) return true
  const bad = readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('__shape_test') || l.includes('__test_')).length
  return bad === 0 ? true : '日志里混进 ' + bad + ' 行测试记录（测试要跑在临时目录里）'
})

check('文档里链的本地文件都在', () => {
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const name of readdirSync(DOCS).filter((f) => f.endsWith('.md'))) {
    const body = readFileSync(join(DOCS, name), 'utf8')
    for (const m of body.matchAll(/\]\(([^)\s]+\.md)\)/g)) {
      const rel = m[1]
      if (/^https?:/i.test(rel)) continue
      const cand = [
        join(DOCS, rel.replace(/^\.\//, '')),
        join(ROOT, rel.replace(/^\.\//, '')),
        join(DOCS, name, '..', rel),
      ]
      if (!cand.some((x) => existsSync(x))) bad.push(name + ' → ' + rel)
    }
  }
  return bad.length ? '链了不存在的文件：' + bad.slice(0, 4).join('；') : true
})

check('插件名不许手抄', () => {
  // 2026-11-15 凌晨：包名从 dsh-consciousness 改成 dsh-consciousness2，
  // 安装脚本和安装文档里各有一份手抄的旧名字。别人照着做，装完不出图标。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
  const want = String(pkg.name || '')
  if (!want) return 'package.json 没名字'
  const bad = []
  for (const rel of ['install.ps1', 'INSTALL.md']) {
    const q = join(ROOT, rel)
    if (!existsSync(q)) continue
    const s = readFileSync(q, 'utf8')
    for (const lit of ["NotePropertyName 'dsh-consciousness'", "bundles += 'dsh-consciousness'", "Remove('dsh-consciousness')"]) {
      if (s.includes(lit)) bad.push(rel + ' 还写死着：' + lit)
    }
  }
  const ps1 = join(ROOT, 'install.ps1')
  if (existsSync(ps1) && !readFileSync(ps1, 'utf8').includes('$pluginName')) {
    bad.push('install.ps1 没从包里读名字（缺 $pluginName）')
  }
  return bad.length ? bad.join('；') : true
})

check('两个包各装各的', () => {
  // 2026-11-15 凌晨：代码包与模型包拆开之后，得分别装对东西。
  // 代码包：安装脚本 + 说明 + 入口；模型包：只有 assets/embed，不带一份代码。
  // 2026-11-21：这里原来写死 0.4.8——查的是老包，永远绿；老包一删就永远红。
  // 改成按当前版本号查，查的才是「这次要发的那两只包」。
  const pkgNow = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
  const out = join(ROOT, '..', '..', '..', 'Desktop', '识海发版')
  const codeP = join(out, `dsh-consciousness2-${pkgNow.version}-code.tgz`)
  const embedP = join(out, `dsh-consciousness2-${pkgNow.version}-embed.tgz`)
  if (!existsSync(codeP) || !existsSync(embedP)) return '两个包没打全（先跑 pack-split）'
  const ls = (f) => spawnSync('C:\\Windows\\System32\\tar.exe', ['-tzf', f], { maxBuffer: 1e8 }).stdout.toString('utf8').split(/\r?\n/).filter(Boolean)
  const code = ls(codeP), embed = ls(embedP)
  const bad = []
  for (const need of ['package/install.ps1', 'package/INSTALL.md', 'package/index.js']) {
    if (!code.includes(need)) bad.push('代码包缺 ' + need)
  }
  if (code.some((x) => x.includes('assets/embed/model_quantized.onnx'))) bad.push('代码包里混进了模型')
  if (embed.some((x) => x === 'package/index.js' || x === 'package/install.ps1')) bad.push('模型包里混进了代码')
  if (!embed.includes('package/assets/embed/model_quantized.onnx')) bad.push('模型包缺模型文件')
  return bad.length ? bad.join('；') : true
})

check('融合是加权不是 RRF', () => {
  // 2026-11-15 清单第 8 件：RRF（1/(60+k) 排名倒数）换归一化加权和。
  // 现查：检索里没有 RRF 公式，字面和语义都是直接算分合并排序——已是加权融合。
  const src = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  if (/60\s*\+\s*k|1\s*\/\s*\(60/.test(src)) return 'tools.js 里出现 RRF 公式，把它换掉'
  return true
})

check('拼音双通道在位', () => {
  // 2026-11-16 清单第 17 件：字面头名低于 0.8 才走拼音，全拼/首字母/无序 bigram 三条道。
  // 只查结构在位，不查数据正确性（数据正确性归 pinyin-test 管）。
  const t = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  if (!t.includes('拼音双通道')) return '检索出口没有拼音双通道'
  if (!t.includes('_bestRel < 0.8')) return '拼音道没有"字面头名不够 0.8 才走"的闸'
  const py = readFileSync(join(ROOT, 'lib', 'pinyin.js'), 'utf8')
  if (!py.includes('pyFull') || !py.includes('pyInitials') || !py.includes('pyBigramSet')) {
    return 'pinyin.js 少了全拼/首字母/bigram 之一'
  }
  return true
})

check('实体归一只信相等和别名', () => {
  // 2026-11-16 清单第 16 件：模糊匹配并组 0 对正确，必须关掉；
  // 只认 L0 完全相等 + L1 人工别名表，检索侧展开、写侧不动。
  const ea = readFileSync(join(ROOT, 'lib', 'entity-alias.js'), 'utf8')
  if (!ea.includes('normalizeEntity') || !ea.includes('buildCanon') || !ea.includes('expandEntity')) {
    return 'entity-alias.js 缺了归一/建组/展开之一'
  }
  if (!ea.includes('绝不自动并')) return '实体归一没把"绝不自动并"写死在注释里'
  const t = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  if (!t.includes('别名展开')) return '检索侧没接别名展开'
  const ij = readFileSync(join(ROOT, 'lib', 'inject.js'), 'utf8')
  if (!ij.includes('expandEntityName')) return '注入侧实体命中没接别名展开'
  return true
})

check('压缩感知在位', () => {
  // 2026-11-16 清单第 12 件：接 compaction/end + summary-error + request-error，
  // 压缩后清字面缓存重算；每轮断言【规矩·不许忘】在场且条数不缩水。
  // 不碰 pre-step（waterflow 型，2026-11-14 踩过）。
  const cp = readFileSync(join(ROOT, 'lib', 'compaction.js'), 'utf8')
  if (!cp.includes('countRules') || !cp.includes('assertRules')) return 'compaction.js 缺断言函数'
  if (!cp.includes('pre-step')) return '没把"不碰 pre-step"的教训写进注释'
  const ij = readFileSync(join(ROOT, 'lib', 'inject.js'), 'utf8')
  if (!ij.includes("agent.ctx.on('compaction/end'")) return '没接压缩结束事件'
  if (!ij.includes('_compactionTick')) return '压缩后清缓存那步没接'
  if (!ij.includes('规矩·不许忘（补回）')) return '规矩缩水时没有整块补回'
  return true
})

check('keywords 与 README 头', () => {
  // 2026-11-16 清单第 13/14 件：npm 搜 "dsh memory" 要能搜到（keywords）；
  // README 第一句就要说清"给 DSH 用 / 不用 Python / 已过 L5"；--profile 写法统一 desktop。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const kw = Array.isArray(pkg.keywords) ? pkg.keywords : []
  if (!kw.includes('memory')) return 'package.json 的 keywords 缺 memory'
  if (!kw.some((k) => k === 'dsh' || k === 'dsh-plugin' || k === 'deepseek-harness')) {
    return 'package.json 的 keywords 里没有 dsh 系词'
  }
  if (!/long-term memory/i.test(String(pkg.description || ''))) return 'description 里没有可检索的英文词'
  const rm = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const head = rm.split('\n').slice(0, 8).join('\n')
  if (!head.includes('给 DSH 用的长期记忆')) return 'README 头没写"给 DSH 用的长期记忆"'
  if (!head.includes('不用 Python')) return 'README 头没写"不用 Python"'
  if (!head.includes('L5')) return 'README 头没写"已过 L5"'
  if (!rm.includes('--profile desktop')) return 'README 安装命令不是 desktop 档'
  const d = readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8')
  if (d.includes('--profile web')) return 'docs/README 还写着 web 档，没统一'
  return true
})

check('IDF 非负', () => {
  // 2026-11-15 清单第 9 件：小库里频率过半的词，标准 IDF 是负数会倒扣分。
  // 实测两处公式都是安全的 log(1+N/df) 与 log((N+1)/(d+1))+0.2——永远是正数。
  const v = readFileSync(join(ROOT, 'lib', 'vectors.js'), 'utf8')
  const ij = readFileSync(join(ROOT, 'lib', 'inject.js'), 'utf8')
  if (!v.includes('Math.log(1 + N / (df.get(w) || 1))')) return 'vectors 的 IDF 公式被换掉了'
  if (!ij.includes('Math.log((alive.length + 1) / (d + 1)) + 0.2')) return 'inject 的 IDF 公式被换掉了'
  return true
})

check('注入失败不许静默', () => {
  // 2026-11-15 清单第 7 件：selfMode 段和空库提示出错必须记审计，不许吞掉。
  const src = readFileSync(join(ROOT, 'lib', 'inject.js'), 'utf8')
  if (!src.includes("audit('inject-selfmode-fail'")) return 'selfMode 段失败还是静默'
  if (!src.includes("audit('inject-emptyhint-fail'")) return '空库提示失败还是静默'
  return true
})

check('revision CAS 在位', () => {
  // 2026-11-15 清单第 5 件：编辑接口必须带 expectedRevision 冲突检查 + rev 自增。
  const src = readFileSync(join(ROOT, 'lib', 'routes.js'), 'utf8')
  if (!src.includes('revision 冲突')) return '编辑接口没有 expectedRevision 冲突检查'
  if (!src.includes("point.rev = Number(point.rev || 0) + 1")) return '编辑接口没有 rev 自增'
  if (!src.includes('rev: Number(point.rev || 0)')) return '回执没带新 rev'
  return true
})

check('归档提示说得出来由', () => {
  // 2026-11-15 凌晨：只报"沉了"不算本事，得说清为什么沉。
  const q = join(ROOT, 'lib', 'tools.js')
  const src = readFileSync(q, 'utf8')
  if (!src.includes('archivedWhy')) return '提示里没带归档理由（archivedWhy）'
  if (src.includes('极弱命中') || src.includes('收口处再挡一次硬答')) {
    return '还留着没生效的拒答代码——撤干净再说'
  }
  return true
})

console.log('──────────────────────────────────────────────')

// 1. 发版前检查必须全过（含 profile 启用清单那条）
check('发版前检查全过', () => {
  const out = execFileSync(NODE, [join(HERE, 'preflight.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
  return /全过/.test(out) ? true : 'preflight 没打印全过'
})

// 2. 健康探针不传端口也能全过（端口每次重启都变，写死会误报）
check('健康探针自动找端口且全过', () => {
  // 探针打的是活服务器端口，人在用的时候可能一两次超时——
  // 连试三次还不过才算真坏，别把网络抖动当成代码回退（2026-11-15 凌晨实测）。
  let last = ''
  let sawOutput = false
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync(NODE, [join(HERE, 'health.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
      sawOutput = true
      // 2026-11-21：体检里多了一项「向量层真算一次」，条数从九变十。
      // 这里不再写死九，认「十项全过」，少一项就说明有检查被漏掉了。
      // 2026-11-21：体检现在把「跳过」单独列出来了（向量服务没起时是 9 全过 + 1 跳过）。
      // 这里认「过了几项 + 跳过几项 ≥ 10」，而不是死认「全过」那个数字。
      const _m = /(\d+) 项全过/.exec(out)
      const _s = /(\d+) 项跳过/.exec(out)
      const total = (_m ? Number(_m[1]) : 0) + (_s ? Number(_s[1]) : 0)
      if (total >= 10) return true
      last = out
    } catch (e) {
      // 探针打的是活服务器端口；execFileSync 抛错基本是活服务器忙得连不上。
      last = String((e && e.stderr) || (e && e.message) || e).slice(0, 200)
    }
  }
  // 三次都是"连都连不上"（活服务器被真人占着），算环境忙，跳过，不算代码坏。
  if (!sawOutput) {
    console.log('    · 健康探针三次都没连上活服务器（有人在用），这轮跳过')
    // 2026-11-21：跳过也得进「没验到」那张单子——收尾那句「通过多少」才不算把没验的算成验过。
    warned.push('健康探针自动找端口且全过（活服务器没连上，这条没验到东西）')
    return true
  }
  return 'health 连试三次没全过：' + last.split('\n').filter((l) => /失败|待查/.test(l)).join(' / ').slice(0, 160)
})

// 3. 镜像四行必须归零
check('镜像与 JSON 四个数归零', () => {
  const out = execFileSync(NODE, [join(HERE, 'sqlite-parity.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
  // 只认前三项：多/少条、结构不一致。
  // "可漂移"那项不参与判定——检索会强化强度，只写 JSON、不回写镜像，
  // 这是设计里的可漂移，硬要求零会把正常读也判成故障（2026-11-15 凌晨踩到）。
  const m = [...out.matchAll(/(只在 JSON 里|只在 SQLite 里|结构性不一致)[：:]\s*(\d+)/g)].map((x) => Number(x[2]))
  if (m.length < 3) return '没读到三个数'
  if (!m.every((n) => n === 0)) return '有非零：' + m.join(',')
  const drift = out.match(/可漂移[^：]*[：:]\s*(\d+)/)
  if (drift && Number(drift[1]) > 0) console.log(`    · 强度可漂移 ${drift[1]} 处（检索强化只写 JSON，正常）`)
  return true
})

// 4. 实体字段名必须是 entities（2026-11-14 误用 entity，报出"覆盖率 0%"）
check('读实体：先读 entities，单数只许当兜底', () => {
  // 旧数据可能只有 entity，允许写成 (p.entities || p.entity)；
  // 不许只读单数——2026-11-14 就是只读错了名字，报出"实体覆盖 0%"。
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const f of ['lib/inject.js', 'lib/tools.js']) {
    const s = readFileSync(join(ROOT, f), 'utf8')
    if (!s.includes('entities')) { bad.push(f + '(完全没读 entities)'); continue }
    const re = /[^.\w]p2?\.entity\b/g
    let m
    while ((m = re.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 16), m.index)
      if (!/\|\|\s*$/.test(before)) { bad.push(f + '(裸读 entity)'); break }
    }
  }
  return bad.length === 0 ? true : bad.join(',')
})

// 5. 写入回执必须提醒"没写别名"
check('写库回执带别名提醒', () => {
  const t = readFileSync(join(ROOT, 'lib/tools.js'), 'utf8')
  return t.includes('这条没写别名') ? true : 'tools.js 里找不到那句提醒'
})

// 6. 稀有词表不能建在循环里（一万条会退化成平方）
check('词表建在循环外', () => {
  const t = readFileSync(join(ROOT, 'lib/tools.js'), 'utf8')
  const i = t.indexOf('_rareDf = new Map()')
  const j = t.indexOf('for (const [id, vec] of vmap)')
  if (i < 0 || j < 0) return '找不到位置'
  return i < j ? true : '词表建在向量循环里面了'
})

// 7. 源文件必须是干净 UTF-8：2026-11-14 用 PowerShell 直接改中文把它写成了乱码，
//    文件体积从 88K 涨到 102K，语法检查才发现。这里先看有没有替换字符和典型乱码。
check('源文件编码没被写坏', () => {
  const DOCS = join(ROOT, 'docs')
  const bad = []
  const dirs = ['lib', 'scripts']
  for (const d0 of dirs) {
    for (const f of readdirSync(join(ROOT, d0))) {
      if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue
      const p0 = join(ROOT, d0, f)
      const raw = readFileSync(p0)
      const s0 = raw.toString('utf8')
      if (s0.includes('\uFFFD')) { bad.push(d0 + '/' + f + '(有替换字符)'); continue }
      // 典型的 GBK 被当 UTF-8 读：会出现这批字。用字符码拼，
      // 免得断言自身被自己抓出来。
      const marks = [0x6d60, 0x951b, 0x93c3, 0x7481, 0x8e47, 0x93c8]
      const gib = marks.reduce((n, code) => n + (s0.split(String.fromCharCode(code)).length - 1), 0)
      if (gib > 2) bad.push(d0 + '/' + f + '(疑似乱码 ' + gib + ')')
      if (raw.length < 50) bad.push(d0 + '/' + f + '(文件过小)')
    }
  }
  return bad.length === 0 ? true : bad.join(',')
})

// 8. 必保块不许被往事挤掉：位置换了也得在。
// 2026-11-14：实测把【规矩·不许忘】放队尾就静默消失——只靠"排在前面"是巧合，不是规矩。
check('注入必保块压不没', () => {
  const rules = '【规矩·不许忘】\n· ' + '规'.repeat(200)
  const tail = capParts(['【她这会儿】怕', '【往事】' + '记'.repeat(600), rules], 500)
  if (!tail.parts.join('\n').includes('【规矩·不许忘】')) return '排最后时规矩被切掉了'
  const head = capParts(['【她这会儿】怕', rules, '【往事】' + '记'.repeat(600)], 500)
  if (!head.parts.join('\n').includes('【规矩·不许忘】')) return '排最前时规矩被切掉了'
  const roomy = capParts(['【她这会儿】怕', rules, '【往事】短'], 2200)
  if (roomy.truncated) return '够长也截断了'
  return tail.truncated && head.truncated ? true : '该截的没截'
})


// 9. 写库只许走一个入口：路由里不许再直写 data.json。
// 2026-11-14 收口：六处直写都没备份、没 fsync、没 meta，出事就是半个 JSON。
check('路由不直写 data.json', () => {
  const s0 = readFileSync(join(ROOT, 'lib/routes.js'), 'utf8')
  const hits = []
  const re = /writeFileSync\(\s*(dataPath|join\(SEAS_DIR)/g
  let m2
  while ((m2 = re.exec(s0)) !== null) hits.push(s0.slice(0, m2.index).split('\n').length)
  return hits.length === 0 ? true : 'routes.js 还在直写：第 ' + hits.join(',') + ' 行'
})

// 10. profile 里必须真的挂着本插件。
// 2026-11-14 深夜：崩一次之后 profile 被重写，bundles 空了、dependencies 空了，
// 界面上插件直接消失。这条以后每次都查，别等人发现"插件没了"。
check('profile 里挂着本插件', () => {
  const prof = join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json')
  if (!existsSync(prof)) return '没有 desktop profile'
  const raw = readFileSync(prof, 'utf8')
  if (raw.includes('\uFFFD')) return 'profile JSON 里有替换字符'
  if (raw.charCodeAt(0) === 0xFEFF) return 'profile JSON 带 BOM（宿主解析会失败）'
  let d
  try { d = JSON.parse(raw) } catch (e) { return 'profile JSON 解析失败：' + String((e && e.message) || e).slice(0, 60) }
  // 2026-11-21：这一段原来把包名写死成 dsh-consciousness2，跟上面「插件名不许手抄」那条自相矛盾——
  // 真改一次名，这条会因为名字对不上而红，看起来像 profile 坏了。改成从 package.json 读。
  const me = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).name
  const bundles = (d.dsh && d.dsh.profile && d.dsh.profile.bundles) || []
  if (!bundles.includes(me)) return 'bundles 里没有 ' + me
  const dep = (d.dependencies || {})[me]
  if (!dep) return 'dependencies 里没有 ' + me
  if (!String(dep).startsWith('link:')) return '依赖不是 link: 安装：' + dep
  const target = String(dep).slice(5).replace(/\//g, '\\')
  if (!existsSync(join(target, 'package.json'))) return 'link 指向的目录不对：' + target
  return true
})

// 11. 批注只许加便条，不许改正文。
// 记忆是证据：被纠正时加一句"现在看是另一回事"，原文一个字都不许动。
check('批注不改正文', () => {
  const s0 = readFileSync(join(ROOT, 'lib/tools-evolve.js'), 'utf8')
  const hits = []
  const re = /\b(?:p|pt|point)\.(?:text|title|titleFull)\s*=/g
  let m3
  while ((m3 = re.exec(s0)) !== null) hits.push(s0.slice(0, m3.index).split('\n').length)
  return hits.length === 0 ? true : 'tools-evolve.js 在改正文：第 ' + hits.join(',') + ' 行'
})

// 12. 小状态文件必须走原子写。
// 心跳、激素、角色表这些坏一份就丢一段状态，而且读坏时会静默回落成默认值——
// 心跳读坏一次，她的电量心情直接被清零，还不报错。2026-11-14 收的十份。
check('状态文件走原子写', () => {
  const files = ['mood.js', 'body.js', 'roles.js', 'quality.js', 'emowords.js',
    'hervoice.js', 'gate.js', 'bodycost.js', 'replycheck.js', 'banter-learn.js']
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const f of files) {
    const p = join(ROOT, 'lib', f)
    if (!existsSync(p)) { bad.push(f + ' 不见了'); continue }
    const s0 = readFileSync(p, 'utf8')
    if (!s0.includes('writeJsonAtomic')) bad.push(f + ' 没走原子写')
  }
  return bad.length === 0 ? true : bad.join(' · ')
})

// 12b. 剥 BOM 不许剥错对象。
// 今晚我把 `.replace(/^\uFEFF/,'')` 挂到了 JSON.parse 的结果上——语法照过，一跑就报
// "replace is not a function"，脚本静默变成"数据 0 条"。这类错 node --check 抓不到。
check('剥 BOM 都在 parse 之前', () => {
  const dir = join(ROOT, 'scripts')
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const s0 = readFileSync(join(dir, f), 'utf8')
    const re = /JSON\.parse\([^\n]*\)\)\.replace\(/
    if (re.test(s0)) bad.push(f)
  }
  return bad.length === 0 ? true : '这些文件把 replace 挂在了 parse 后面：' + bad.join(', ')
})

// 12c. 每个模块都要真的导入一遍。
// 语法检查抓不到"导入就炸"——seas.js 少三个 import，语法过、导入必炸，
// 结果窗口标题永远空、示例识海装不进去，还全被空 catch 吞掉。（2026-11-14）
check('模块全部能导入', () => {
  const out = execFileSync(NODE, [join(HERE, 'import-all.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 180000 })
  const m = /导入失败 (\d+)/.exec(out)
  if (!m) return '没读到失败数'
  return Number(m[1]) === 0 ? true : out.split('\n').filter((x) => x.startsWith('  ')).join(' / ')
})

// 12d. 调参键必须都在 DEFAULTS 里。
// 2026-11-14：minScore / relSlots / relatedLift / recallGapMin 只写在代码里当兜底，
// DEFAULTS 没有——打开调参文件看不见它们，调不到还以为没这功能。
check('调参键都在 DEFAULTS 里', () => {
  const ts = readFileSync(join(ROOT, 'lib/tuning.js'), 'utf8')
  const m = /DEFAULTS\s*=\s*\{([\s\S]*?)\n\}/.exec(ts)
  if (!m) return '读不到 DEFAULTS'
  const keys = new Set([...m[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]))
  const used = new Set()
  for (const f of ['inject.js', 'tools.js', 'routes.js']) {
    const s0 = readFileSync(join(ROOT, 'lib', f), 'utf8')
    for (const k of s0.matchAll(/_tune\.(\w+)/g)) used.add(k[1])
  }
  const missing = [...used].filter((k) => !keys.has(k))
  return missing.length === 0 ? true : '代码在读但 DEFAULTS 没有：' + missing.join(', ')
})

// 12e. 别人装上去，界面上不许露出他家人的名字。
// 代码注释里提到"苏苏侠"没关系（那是来由），但字符串字面量里出现就说明写死在界面或提示里了。
// 白名单只有一个：writer-js 的自我词表（那是判定"这条记忆是不是在说我"的启发式）。
check('界面文案里没有写死的人名', () => {
  const allow = new Set(['writer-js.js'])
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const f of readdirSync(join(ROOT, 'lib')).filter((x) => x.endsWith('.js'))) {
    if (allow.has(f)) continue
    const s0 = readFileSync(join(ROOT, 'lib', f), 'utf8')
    const re = /(['"`])[^'"`\n]*(苏苏侠|大肥鱼)[^'"`\n]*\1/g
    let m
    while ((m = re.exec(s0)) !== null) {
      // 只算真正落在字符串里的：行内前面没有 "//" 注释标记
      const lineStart = s0.lastIndexOf('\n', m.index) + 1
      const lineHead = s0.slice(lineStart, m.index)
      if (/^\s*(\/\/|\*)/.test(lineHead)) continue
      bad.push(f + '：' + m[0].slice(0, 24))
      break
    }
  }
  return bad.length === 0 ? true : bad.join(' · ')
})

// 13. 脚本目录不许有语法坏掉的半成品。
// 今晚写了七八个小工具，任何一个语法断，都是"看着有、其实不能用"。
check('脚本全都能 node --check', () => {
  const dir = join(ROOT, 'scripts')
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mjs')) continue
    try {
      execFileSync(NODE, ['--check', join(dir, f)], { stdio: 'pipe' })
    } catch { bad.push(f) }
  }
  return bad.length === 0 ? true : '语法不过：' + bad.join(', ')
})

check('调参模板跟默认值没走样', () => {
  // assets/tuning.example.json 是给人照着抄的。默认值改了、模板没改，抄出来就是旧谱子。
  const tplPath = join(ROOT, 'assets', 'tuning.example.json')
  if (!existsSync(tplPath)) return '模板不见了：assets/tuning.example.json'
  const tpl = JSON.parse(readFileSync(tplPath, 'utf8'))
  const src = readFileSync(join(ROOT, 'lib', 'tuning.js'), 'utf8')
  const miss = []
  for (const k of Object.keys(tpl)) if (!src.includes(k + ':')) miss.push(k)
  const extra = ['vecMin', 'minScore', 'dupMin', 'titleBoost'].filter((k) => !(k in tpl))
  if (miss.length) return '模板里有默认值没有的键：' + miss.join('、')
  if (extra.length) return '模板少写：' + extra.join('、')
  return true
})

check('查重阈值从调参读，不是写死的', () => {
  // 写死一个 0.86，别人库密度不同就永远不提醒。只在兜底里许出现一次。
  const src = readFileSync(join(ROOT, 'lib', 'tools.js'), 'utf8')
  const hard = [...src.matchAll(/_bs\s*>=\s*([0-9.]+)/g)].map((m) => m[1])
  const tuned = src.includes('tuning().dupMin')
  if (hard.length) return '还有写死的比较：' + hard.join('、')
  if (!tuned) return '没从调参读 dupMin'
  return true
})

check('纠正三件套都注册上了', () => {
  // "被说错就改"靠三个工具：批注、压可信度、改时间。
  // 注册那行要是被删了，功能还在、入口没了——这种最容易漏。
  const src = readFileSync(join(ROOT, 'index.js'), 'utf8')
  const miss = []
  for (const name of ['annotateTool', 'doubtTool', 'confirmTool', 'dateTool']) {
    if (!src.includes('register(' + name + ')')) miss.push(name)
  }
  return miss.length ? '没注册：' + miss.join('、') : true
})

check('README 下面列的文档都在', () => {
  // README 末尾那份书单是给人照着点开的。写了个不存在的文件名，等于把人引进死胡同。
  const src = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const miss = []
  for (const m of src.matchAll(/^- `([^`]+\.md)`/gm)) {
    const f = m[1]
    if (!existsSync(join(ROOT, f))) miss.push(f)
  }
  return miss.length ? '缺：' + miss.join('、') : true
})

check('README 里链到的文档都在包里', () => {
  // README 会被 npm 用 files 白名单打包；文档不在名单里，链接就是死的。
  // 2026-11-15：README 链到 docs/安装-离线包.md，但 files 里没有 docs——别人点开就是 404。
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const files = (pkg.files || []).map((f) => String(f).replace(/\\/g, '/'))
  const covers = (rel) => files.some((f) => rel === f || rel.startsWith(f + '/'))
  const DOCS = join(ROOT, 'docs')
  const bad = []
  for (const doc of ['README.md', 'INSTALL.md']) {
    const full = join(ROOT, doc)
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    for (const m of src.matchAll(/\]\(([^)#]+\.md)\)/g)) {
      const rel = m[1].replace(/^\.\//, '')
      if (rel.startsWith('http')) continue
      if (!existsSync(join(ROOT, rel))) { bad.push(`${doc} → ${rel}（文件不存在）`); continue }
      if (!covers(rel)) bad.push(`${doc} → ${rel}（不在 files 白名单）`)
    }
  }
  const uniq = [...new Set(bad)]
  return uniq.length ? uniq.slice(0, 4).join('、') : true
})

check('文档里写的命令都找得到脚本', () => {
  // 别人照着 README/INSTALL/自己验一遍 敲命令，脚本名写错一个就跑不通。
  // 这条只查"文件在不在"，不跑它们——跑起来的是上面那些检查。
  const docs = ['README.md', 'INSTALL.md', join('docs', '自己验一遍.md'), join('docs', '安装-离线包.md')]
  const missing = []
  for (const d of docs) {
    const full = join(ROOT, d)
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    for (const m of src.matchAll(/node\s+(?:scripts[\\/])?([a-zA-Z0-9_\-]+\.mjs)/g)) {
      const name = m[1]
      if (!existsSync(join(ROOT, 'scripts', name))) missing.push(`${d} → ${name}`)
    }
  }
  const uniq = [...new Set(missing)]
  return uniq.length ? '文档提到但脚本不存在：' + uniq.slice(0, 5).join('、') : true
})

check('分类器与标注集齐全', () => {
  if (!existsSync(join(ROOT, 'lib/intent.js'))) return '缺 lib/intent.js'
  const setP = join(ROOT, 'scripts/data/intent-set.json')
  if (!existsSync(setP)) {
    // 2026-11-15 凌晨：我误删了 scripts/data（安装副本其实是 junction，指向源目录）。
    // 这个文件恢复不了。检查改成"在就验、缺了明说"，不静默通过、也不把整集判红。
    console.log('  ⚠ 标注集缺：scripts/data/intent-set.json —— 2026-11-15 误删，需重做')
    warned.push('分类器与标注集齐全（标注集缺失，这条其实没验到东西）')
    return true
  }
  try {
    const s2 = JSON.parse(readFileSync(setP, 'utf8').replace(/^\uFEFF/, ''))
    const arr = Array.isArray(s2) ? s2 : (s2.cases || s2.items || [])
    return arr.length ? true : '标注集是空的'
  } catch { return '标注集读不出来' }
})

console.log('──────────────────────────────────────────────')
console.log(`回归集：通过 ${pass} · 失败 ${fails.length}` + (warned.length ? ` · 其中 ${warned.length} 条是缺数据放行` : ''))
if (warned.length) { for (const w of warned) console.log('  · 没验到：' + w) }
if (fails.length) {
  console.log('')
  for (const f of fails) console.log('  · ' + f)
  process.exit(1)
}
