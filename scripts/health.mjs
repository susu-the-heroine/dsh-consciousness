/**
 * 自检探针：从外面看它是否还活着。
 *
 * 为什么要有这个：插件里三百多个 catch 是空的，报错被自己吞掉，
 * 界面安静得像"没这功能"。今晚我三次栽在这上面。
 * 逐个补 catch 补不完，所以换个方向——从外面敲一遍，看它答不答。
 *
 * 用法：node scripts/health.mjs [http://127.0.0.1:端口]
 * 输出：每一项 通过/失败，最后一行给
  // 向量层：health 只说"服务活着"，不证明能算。这里真算一次。
  // 2026-11-12：这台机器上 DSH 自带 Python 没装 torch，/embed 直接 500，
  // 而 /health 一直是 ok——探针只报"活着"，等于替它撒谎。
  try {
    const r = await fetch('http://127.0.0.1:8931/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '探针' }),
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) {
      const j = await r.json()
      const dim = (j.v || j.vs?.[0] || []).length
      ok('向量层', `能算 · ${dim} 维`)
    } else {
      const body = await r.text().catch(() => '')
      fail('向量层', `服务在但不给算（HTTP ${r.status}）${body.slice(0, 80)}`)
    }
  } catch (e) {
    fail('向量层', `连不上（未启动？）${String(e && e.message).slice(0, 60)}`)
  }

结论。
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:60634'
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
  const j = JSON.parse(readFileSync(join(D, 'consciousness-seas', 'main', 'data.json'), 'utf8'))
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

console.log('')
console.log(fail === 0 ? '结论：' + pass + ' 项全过' : '结论：' + pass + ' 过 / ' + fail + ' 失败')
for (const b of bad) console.log('  待查：' + b)
process.exit(fail === 0 ? 0 : 1)
