/**
 * 自检探针：从外面看它是否还活着。
 *
 * 为什么要有这个：插件里三百多个 catch 是空的，报错被自己吞掉，
 * 界面安静得像"没这功能"。今晚我三次栽在这上面。
 * 逐个补 catch 补不完，所以换个方向——从外面敲一遍，看它答不答。
 *
 * 用法：node scripts/health.mjs [http://127.0.0.1:端口]
 * 输出：每一项 通过/失败，最后一行给结论。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 端口每次重启都会变，写死就会误报一堆"失败"。
// 不给参数时自己找：扫本机在监听的端口，哪个答得上 /consciousness/inner-data 就用哪个。
async function autoBase() {
  const { execFileSync } = await import('node:child_process')
  let ports = []
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 8000 })
    for (const line of out.split('\n')) {
      const m = line.match(/127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING/i)
      if (m) ports.push(Number(m[1]))
    }
  } catch {}
  ports = [...new Set(ports)].slice(0, 40)
  for (const p0 of ports) {
    try {
      const r = await fetch('http://127.0.0.1:' + p0 + '/consciousness/inner-data', { signal: AbortSignal.timeout(700) })
      if (!r.ok) continue
      // 只看状态码会认错人：本机别的服务也会回 200。按字段认。
      const j = await r.json().catch(() => null)
      if (j && j.moodline !== undefined && j.dims !== undefined) return 'http://127.0.0.1:' + p0
    } catch {}
  }
  return null
}
const arg = process.argv[2]
const base = arg && !arg.startsWith('--') ? arg : (await autoBase()) || 'http://127.0.0.1:60634'
const D = join(homedir(), '.dsh')
let pass = 0
let fail = 0
const bad = []

function ok(name, detail) {
  pass++
  console.log('  通过  ' + name + (detail ? '  ' + detail : ''))
}
function no(name, why) {
  fail++
  bad.push(name + '：' + why)
  console.log('  失败  ' + name + '  ' + why)
}
// 2026-11-21：跳过以前直接算通过——向量服务没起也报「10 项全过」，这正是这份文件开头骂的那件事：
// 探针替它撒谎。跳过就单独记一笔，不进通过数。
let skips = 0
function skip(name, why) {
  skips++
  console.log('  跳过  ' + name + '  ' + why)
}

async function get(path) {
  const r = await fetch(base + path, { redirect: 'manual' })
  return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => null) : null }
}

console.log('探针 ' + base)

// 一、接口还答不答
for (const [name, path] of [
  ['识海数据', '/consciousness/body-data?id=main'],
  ['内观数据', '/consciousness/inner-data'],
  ['念头列表', '/consciousness/thoughts'],
]) {
  try {
    const { status, json } = await get(path)
    if (status !== 200 || !json || json.ok === false) no(name, '状态 ' + status + (json && json.error ? ' ' + json.error : ''))
    else ok(name, '状态 ' + status)
  } catch (e) {
    no(name, String(e.message || e))
  }
}

// 二、内观那份必须带态度字段（缺字段 = 代码被回退或报错被吞）
try {
  const { json } = await get('/consciousness/inner-data')
  if (json && Object.prototype.hasOwnProperty.call(json, 'stance')) ok('态度字段', json.stance ? json.stance.label : '（暂无，正常）')
  else no('态度字段', '返回里没有 stance')
} catch (e) {
  no('态度字段', String(e.message || e))
}

// 三、关键文件在不在、读得开
for (const [name, file] of [
  ['识海本体', join(D, 'consciousness-seas', 'main', 'data.json')],
  ['心脏存档', join(D, 'consciousness-heart.json')],
  ['激素存档', join(D, 'consciousness-body.json')],
]) {
  try {
    if (!existsSync(file)) { no(name, '文件不在'); continue }
    const j = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    ok(name, '可解析')
    void j
  } catch (e) {
    no(name, String(e.message || e))
  }
}

// 四、规矩栏该有的东西还在（新规矩不许被截掉）
try {
  const j = JSON.parse(readFileSync(join(D, 'consciousness-seas', 'main', 'data.json'), 'utf8').replace(/^\uFEFF/, ''))
  const rules = (j.points || []).filter((p) => p.rule === true && !p.dead)
  const newest = rules.sort((a, b) => (b.id || 0) - (a.id || 0))[0]
  if (!rules.length) no('规矩', '一条都没有')
  else ok('规矩', rules.length + ' 条，最新 #' + newest.id)
} catch (e) {
  no('规矩', String(e.message || e))
}

// 五、重复页面有没有又长出来（今晚刚合并过）
import { statSync } from 'node:fs'
try {
  const dup = join(D, 'plugin-src', 'dsh-consciousness', 'assets', '内观.html')
  if (existsSync(dup)) no('内观重复', '又出现第二份了')
  else ok('内观重复', '只有一份')
} catch { /* 没有就是好事 */ }

// 六、向量层：前面那些只证明"服务活着"，不证明能算。这里真算一次。
// 2026-11-21：这一段原来整块贴在文件开头的注释里——二十年没跑过，探针只报"活着"，等于替它撒谎。
// 2026-11-12 欠的账：那台机器上 /embed 直接 500，/health 却一直 ok。
{
  const _base = process.env.DSH_EMBED_URL || 'http://127.0.0.1:8931'
  try {
    const r = await fetch(_base + '/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '探针' }),
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) {
      const j = await r.json()
      const dim = (j.v || (j.vs && j.vs[0]) || []).length
      ok('向量层', '能算 · ' + dim + ' 维')
    } else {
      const body = await r.text().catch(() => '')
      no('向量层', '服务在但不给算（HTTP ' + r.status + '）' + body.slice(0, 80))
    }
  } catch (e) {
    // 连不上 = 这个服务没起，属于机器状态，不是「探针撒谎」。记通过并写明，别判红。
    // 真正要抓的是下一条：服务活着、却算不出来。
    skip('向量层', '未启动（' + String((e && e.message) || e).slice(0, 40) + '）')
  }
}

console.log('')
console.log(
  fail === 0
    ? '结论：' + pass + ' 项全过' + (skips ? ' · ' + skips + ' 项跳过（没验到）' : '')
    : '结论：' + pass + ' 过 / ' + fail + ' 失败' + (skips ? ' · ' + skips + ' 项跳过' : '')
)
for (const b of bad) console.log('  待查：' + b)
process.exit(fail === 0 ? 0 : 1)
