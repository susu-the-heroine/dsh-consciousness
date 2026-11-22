// 检索子线程：开池之前先把标记立起来，免得子线程里再开池
process.env.C2_IN_WORKER = '1'

const { parentPort } = await import('node:worker_threads')
const { searchTool } = await import('./tools.js')

if (parentPort) parentPort.on('message', async (m) => {
  // 2026-11-20：收到一条不像样的消息（没 id、没参数）也回一句。
  // 原来直接往里走，拿 undefined 去查——要么回一条对不上号的回复，要么干脆沉默，主线程就一直等。
  if (!m || typeof m !== 'object' || m.id === undefined || m.id === null) {
    parentPort.postMessage({ id: m && m.id, ok: false, e: '坏消息：缺 id' })
    return
  }
  try {
    const r = await searchTool.executeInline(m.args || {})
    parentPort.postMessage({ id: m.id, ok: true, r })
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, e: String((e && e.message) || e) })
  }
})
