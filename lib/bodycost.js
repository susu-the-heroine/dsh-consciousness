/**
 * 养分账
 * ======
 *
 * 数据源不是估算，是 DSH 自己的账本：~/.dsh/.dshw-usage.json
 *   lastBalance  当前余额（元）
 *   todayUsage   今天花掉（元）
 *   dayStart     今天开始时的余额（元）
 *
 * 这个文件是被 routes.js 用「带时间戳的动态 import」读进来的一份，
 * 所以改完这里，刷新页面就生效，不用重启 DSH。
 * 只有 routes.js 本身动过才需要重启——那是唯一躲不开的。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const USAGE = join(process.env.USERPROFILE || '', '.dsh', '.dshw-usage.json')

const CHARS_PER_TOKEN = 1.6

function readUsage() {
  try {
    if (!existsSync(USAGE)) return null
    const d = JSON.parse(readFileSync(USAGE, 'utf8').replace(/^\uFEFF/, ''))
    const balance = Number(d.lastBalance)
    const spent = Number(d.todayUsage)
    const start = Number(d.dayStart)
    if (!Number.isFinite(balance)) return null
    return {
      balance: Math.round(balance * 1000) / 1000,
      spent: Number.isFinite(spent) ? Math.round(spent * 1000) / 1000 : 0,
      cap: Number.isFinite(start) ? Math.round(start * 1000) / 1000 : balance,
      day: String(d.date || ''),
      events: Array.isArray(d.events) ? d.events.length : 0,
    }
  } catch {
    return null
  }
}

export function computeCost(chars) {
  const todayChars = Math.max(0, Number(chars) || 0)
  const tokens = Math.round(todayChars / CHARS_PER_TOKEN)

  const real = readUsage()
  if (real) {
    const used = Math.max(0, real.cap - real.balance)
    return {
      source: 'dsh',
      tokens,
      yuan: real.spent,
      chars: todayChars,
      cap: Math.round(real.cap * 100) / 100,
      spent: real.spent,
      balance: real.balance,
      used: Math.round(used * 100) / 100,
      ratio: real.cap > 0 ? Math.max(0, Math.min(1, real.balance / real.cap)) : 0,
      day: real.day,
      local: localSpend(todayChars),
    }
  }

  // 读不到账本才退回估算，并标出来
  return {
    source: 'estimate',
    tokens,
    yuan: Math.round(tokens / 1000000 * 2 * 1000) / 1000,
    chars: todayChars,
    cap: 10,
    spent: Math.round(tokens / 1000000 * 2 * 1000) / 1000,
    balance: Math.max(0, 10 - tokens / 1000000 * 2),
    used: 0,
    ratio: 1,
    day: '',
    local: localSpend(todayChars),
  }
}


/**
 * 自记账：官方账本停在 2026-11-07 之后没再更新，
 * 与其显示一个越来越过时的总消耗，不如自己每日累一行。
 * 只记「今天新写进库的字数」，按 1 token ≈ 1.6 字、2 元/百万 token 折算，
 * 名字就叫估算，不冒充官方账单。
 */
const LEDGER = join(process.env.USERPROFILE || '', '.dsh', 'consciousness-spend.json')

function localSpend(todayChars) {
  const day = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const k = `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`
  let L = { since: k, days: {} }
  try {
    if (existsSync(LEDGER)) L = { ...L, ...JSON.parse(readFileSync(LEDGER, 'utf8').replace(/^\uFEFF/, '')) }
  } catch {}
  if (!L.days || typeof L.days !== 'object') L.days = {}
  if (!L.since) L.since = k

  // 同一个数会被反复读到，取当天最大值，别重复累加
  const prev = Number(L.days[k]) || 0
  L.days[k] = Math.max(prev, todayChars)
  try { writeFileSync(LEDGER, JSON.stringify(L), 'utf8') } catch {}

  let totalChars = 0
  for (const v of Object.values(L.days)) totalChars += Number(v) || 0
  const tokens = Math.round(totalChars / CHARS_PER_TOKEN)
  return {
    since: L.since,
    days: Object.keys(L.days).length,
    today: L.days[k],
    totalChars,
    totalTokens: tokens,
    totalYuan: Math.round(tokens / 1000000 * 2 * 1000) / 1000,
  }
}
