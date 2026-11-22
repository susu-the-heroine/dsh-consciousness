#!/usr/bin/env node
/**
 * 识海 · 本地 HTTP 接口（v1）
 * ==========================
 *
 * 别的程序不用装 DSH 也能查这套记忆。用的是同一套工具实现（memory_search /
 * memory_list / memory_add / memory_sea），不是另写一套检索——避免「两套答案」。
 *
 *   node bin/sea-api.mjs --port 8765
 *
 * 鉴权：本机回环 + Bearer token。token 自动生成在
 *   ~/.dsh/consciousness-api-token
 * 端口：默认 8765，只绑 127.0.0.1。
 * 写入：默认只读；要写入设 SEA_API_WRITE=1（或 --allow-write）。
 *
 * 端点：
 *   GET  /health                    -> { ok, version, seas }
 *   GET  /seas                      -> 识海列表
 *   POST /search  {query, sea, limit, review}
 *   POST /list    {sea, limit}
 *   POST /write   {title, text, sea, ...}   （需写入开关）
 */
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib')

const { searchTool, listTool, seaTool } = await import('file:///' + join(LIB, 'tools.js').replace(/\\/g, '/'))
const { addTool } = await import('file:///' + join(LIB, 'tools.js').replace(/\\/g, '/'))

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const TOKEN_FILE = join(HOME, '.dsh', 'consciousness-api-token')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const PORT = Number(arg('port', process.env.SEA_API_PORT || 8765))
const WRITE = argv.includes('--allow-write') || process.env.SEA_API_WRITE === '1'

function loadToken() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const t = readFileSync(TOKEN_FILE, 'utf8').trim()
      if (t) return t
    }
  } catch {}
  const t = randomBytes(24).toString('hex')
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    writeFileSync(TOKEN_FILE, t, 'utf8')
  } catch {}
  return t
}
const TOKEN = loadToken()

const json = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1024 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

const auth = (req) => {
  const h = String(req.headers.authorization || '')
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : String(req.headers['x-sea-token'] || '')
  return t && t === TOKEN
}

const server = http.createServer(handler)

/** 给测试用：不 listen，自己决定端口 */
export { server, TOKEN, loadToken }
export function createServer() {
  return http.createServer(handler)
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/health') {
      // 2026-11-21：版本原先是写死的「0.4.8」，包早到 0.4.11 了——健康检查报的号是假的。
      // 改成读包清单，别再手写。
      let _ver = 'unknown'
      try {
        const _pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
        _ver = String(_pkg.version || 'unknown')
      } catch {}
      return json(res, 200, { ok: true, version: _ver, write: WRITE })
    }
    if (!auth(req)) return json(res, 401, { ok: false, error: 'unauthorized' })
    if (url.pathname === '/seas' && req.method === 'GET') {
      const r = await seaTool.execute({ action: 'list' })
      return json(res, 200, { ok: true, result: r })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (url.pathname === '/search') {
        const r = await searchTool.execute({
          query: String(body.query || ''),
          sea: body.sea,
          limit: body.limit,
          review: body.review === undefined ? false : !!body.review,
        })
        return json(res, 200, { ok: true, result: r })
      }
      if (url.pathname === '/list') {
        const r = await listTool.execute({ sea: body.sea, limit: body.limit, open: body.open, rule: body.rule })
        return json(res, 200, { ok: true, result: r })
      }
      if (url.pathname === '/write') {
        if (!WRITE) return json(res, 403, { ok: false, error: 'write disabled' })
        const r = await addTool.execute({ ...body })
        return json(res, 200, { ok: true, result: r })
      }
    }
    return json(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    return json(res, 500, { ok: false, error: String((e && e.message) || e) })
  }
}

// 只有直接跑这个文件时才监听；被测试 import 时不动端口
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`识海接口: http://127.0.0.1:${PORT}`)
    console.log(`token 文件: ${TOKEN_FILE}`)
    console.log(`写入: ${WRITE ? '开' : '关（只读）'}`)
  })
}
