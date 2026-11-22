/**
 * 检索子线程池
 * ============
 * 2026-11-18 夜。八路并发 p95 卡在二百四十多：一条查询单线程要四十多毫秒，
 * 八条就叠成三百多。这道池子把整条检索搬到子线程，真正并行。
 *
 * 只在工具入口用；子线程里 C2_IN_WORKER=1，不会再开池（不会无限套）。
 */
import { Worker } from 'node:worker_threads'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIZE = Math.max(2, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1))

const workers = []   // { w, busy }
let seq = 0
const pending = new Map()
// 2026-11-21：池子原先没有超时。子线程没崩、只是卡着的时候，那条请求既不回也不拒，
// 外面就一直等——这正是「卡死还是慢，谁也说不清」的那一档。给每条请求一个上限。
const TIMEOUT = Math.max(100, Number(process.env.C2_POOL_TIMEOUT_MS) || 15000)

function settle(id, fn) {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  try { clearTimeout(p.timer) } catch {}
  if (p.rec) {
    p.rec.busy = false
    // 2026-11-21：线程是活的，进程就退不出去。闲着的时候把它摘出事件循环，
    // 有活再挂回去——不然任何用它跑完就结束的脚本都会吊在那儿不退。
    try { p.rec.w.unref && p.rec.w.unref() } catch {}
  }
  fn(p)
  pump()
}

function spawn() {
  const w = new Worker(join(HERE, 'search-worker.js'))
  const rec = { w, busy: false }
  w.on('message', (m) => {
    rec.busy = false
    settle(m.id, (p) => {
      if (m.ok) p.resolve(m.r)
      else p.reject(new Error(m.e || 'worker failed'))
    })
  })
  // 2026-11-20：子线程崩了/退了，原来只把它从池里摘掉，挂在它身上的那个请求谁也不管——
  // 那条检索就永远不 resolve、也不 reject，外面一直等。现在把它名下的请求当场拒掉。
  const drop = (why) => {
    const i = workers.indexOf(rec)
    if (i >= 0) workers.splice(i, 1)
    for (const [id, p] of pending) {
      if (p.rec === rec) settle(id, (x) => { try { x.reject(new Error('worker ' + why)) } catch {} })
    }
    pump()
  }
  w.on('error', () => drop('crashed'))
  w.on('exit', () => drop('exited'))
  workers.push(rec)
  return rec
}

function pick() {
  const free = workers.find((r) => !r.busy)
  if (free) return free
  if (workers.length < SIZE) return spawn()
  return null
}

function pump() {
  for (const [id, p] of pending) {
    if (p.started) continue
    const rec = pick()
    if (!rec) break
    p.started = true
    p.rec = rec
    rec.busy = true
    try { rec.w.ref && rec.w.ref() } catch {}
    p.timer = setTimeout(() => {
      settle(id, (x) => { try { x.reject(new Error('pool timeout ' + TIMEOUT + 'ms')) } catch {} })
    }, TIMEOUT)
    try { p.timer.unref && p.timer.unref() } catch {}
    rec.w.postMessage({ id, args: p.args })
  }
}

export function search(args) {
  if (process.env.C2_IN_WORKER) return Promise.reject(new Error('in worker'))
  return new Promise((resolve, reject) => {
    const id = ++seq
    // 计时从「派到线程手里」开始算，不从排队那一刻算——排大队时不该冤枉谁。
    pending.set(id, { args, resolve, reject, started: false, timer: null, id })
    pump()
  })
}

export function stats() {
  return { size: SIZE, workers: workers.length, busy: workers.filter((r) => r.busy).length, pending: pending.size }
}
