/**
 * 她今天做过什么
 * ==============
 *
 * 为什么需要它：私有念头如果全从"你和我之间的事"里来，那不叫独立，那叫痴情。
 * 她得有自己的事——今天改了几处、跑了几次测试、补了几条向量。
 *
 * 数据源是 audit 日志（已有的、每轮都在写）。这里只做统计，不写新东西。
 * **不编故事**：没做的事不许说做过。
 */
import { existsSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const LOG = join(homedir(), '.dsh', 'consciousness-audit.log')

/** 事件 → 人话 */
const LABELS = {
  'promise-add': '添约定',
  'promise-done': '兑现约定',
  'vector-sync': '补近似',
  'chain-verify': '核对原话链',
  'memory-confirm': '确认记忆',
  'memory-doubt': '标记可疑',
  'self-thought': '写念头',
  'selfmode-level': '切档位',
  'auto-recall': '自己想起',
  'search': '翻记忆',
}

function dayKey(ts) {
  const d = new Date(Number(ts) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/**
 * 统计今天的活动。
 * 返回 { counts, total, line }
 */
export function todayActivity(now) {
  const t = Number(now) || Date.now()
  const today = dayKey(t)
  const counts = {}
  let total = 0
  try {
    if (!existsSync(LOG)) return { counts, total: 0, line: '' }
    // 2026-11-20：注释写着「别把整个日志读进内存」，可原先是整份读进来再切尾巴——
    // 日志两兆就是两兆全进内存。改成只读尾部一段字节，够统计今天就行。
    const _size = statSync(LOG).size
    const _take = Math.min(_size, 256 * 1024)
    let _raw = ''
    if (_take > 0) {
      const _buf = Buffer.alloc(_take)
      const _fd = openSync(LOG, 'r')
      try {
        readSync(_fd, _buf, 0, _take, _size - _take)
        _raw = _buf.toString('utf8')
      } finally {
        try { closeSync(_fd) } catch {}
      }
    }
    // 头一行可能被切半，丢掉不完整的头
    const _cut = _raw.indexOf('\n')
    const lines = (_cut >= 0 ? _raw.slice(_cut + 1) : _raw).split('\n')
    for (const ln of lines.slice(-2000)) {
      if (!ln.trim()) continue
      let j = null
      try { j = JSON.parse(ln) } catch { continue }
      if (!j || !j.k) continue
      if (dayKey(j.t) !== today) continue
      const label = LABELS[j.k]
      if (!label) continue
      counts[label] = (counts[label] || 0) + 1
      total++
    }
  } catch {
    return { counts, total: 0, line: '' }
  }

  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => (v > 1 ? k + ' ' + v + ' 次' : k + ' 1 次'))

  return {
    counts,
    total,
    line: parts.length ? '今天她：' + parts.join('、') : '',
  }
}
