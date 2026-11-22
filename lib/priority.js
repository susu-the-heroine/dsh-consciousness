/**
 * 算力闸（优先级）
 * ================
 *
 * 本地嵌入一次算一条：前台搜和后台补抢同一份算力，八路并发 p95 三百零六毫秒。
 * 这里只排顺序：开一个坑，前台查询插到补库前面。
 * 不改任何计算结果，只决定谁先算。
 */
const QUEUE = []
let busyHigh = 0
let busyLow = 0

function pump() {
  if (!QUEUE.length) return
  let i = QUEUE.findIndex((x) => x.prio === 'high' && busyHigh < 2)
  if (i < 0) { if (busyLow > 0 || busyHigh > 0) return; i = 0 }
  const job = QUEUE.splice(i, 1)[0]
  if (job.prio === 'high') busyHigh++; else busyLow++
  Promise.resolve()
    .then(job.fn)
    .then(job.resolve, job.reject)
    .finally(() => { if (job.prio === 'high') busyHigh--; else busyLow--; pump() })
}

export function run(prio, fn) {
  return new Promise((resolve, reject) => {
    QUEUE.push({ prio: prio === 'high' ? 'high' : 'low', fn, resolve, reject })
    pump()
  })
}

export const high = (fn) => run('high', fn)
export const low = (fn) => run('low', fn)

export function pending() {
  return { busy: busyHigh + busyLow > 0, highBusy: busyHigh, lowBusy: busyLow, queued: QUEUE.length, high: QUEUE.filter((x) => x.prio === 'high').length }
}

export function reset() { QUEUE.length = 0; busyHigh = 0; busyLow = 0 }
