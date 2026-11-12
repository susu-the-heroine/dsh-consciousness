/**
 * 插件自查更新 —— 只查，不装。
 *
 * 原则（和鱼的记忆一致）：
 *   · 仓库地址从自己 package.json 的 repository 读，代码里不写死
 *   · 查不到就如实说查不到，绝不能显示成"已是最新"
 *   · 结果缓存 6 小时，点按钮绕过缓存
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TTL = 6 * 3600 * 1000
const TIMEOUT = 8000

function parseVer(v) {
  const s = String(v || '').trim().replace(/^v/i, '')
  const cut = s.indexOf('-')
  const core = cut >= 0 ? s.slice(0, cut) : s
  const pre = cut >= 0 ? s.slice(cut + 1) : ''
  const nums = core.split('.').map((x) => Number(x) || 0)
  return { nums: [nums[0] || 0, nums[1] || 0, nums[2] || 0], pre }
}

export function cmpVer(a, b) {
  const x = parseVer(a)
  const y = parseVer(b)
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

function rawUrls(repo) {
  const s = String(repo || '').trim()
  const g = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(s)
  if (g) {
    const owner = g[1]
    const name = g[2].replace(/\.git$/i, '')
    return [
      `https://raw.githubusercontent.com/${owner}/${name}/HEAD/package.json`,
      `https://cdn.jsdelivr.net/gh/${owner}/${name}@main/package.json`,
    ]
  }
  // Gitee：raw 走 /raw/HEAD/
  const e = /gitee\.com[/:]([^/]+)\/([^/#?]+)/i.exec(s)
  if (e) {
    const owner = e[1]
    const name = e[2].replace(/\.git$/i, '')
    return [
      `https://gitee.com/${owner}/${name}/raw/HEAD/package.json`,
      `https://gitee.com/${owner}/${name}/raw/master/package.json`,
    ]
  }
  return []
}

export function createSelfUpdate({ packageRoot }) {
  let meta = {}
  try {
    meta = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  } catch {
    /* 读不到自己的 package.json 就老实说 */
  }

  const current = String(meta.version || '')
  const repo = String(
    (meta.repository && (meta.repository.url || meta.repository)) || meta.homepage || '',
  )
  const repoUrl = repo
    .replace(/^git\+/, '')
    .replace(/^git:/, 'https:')
    .replace(/\.git$/, '')
    .replace(/#readme$/i, '')

  let cache = null

  async function fetchJson(url) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'cache-control': 'no-cache' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  return async function check(refresh) {
    const now = Date.now()
    if (!refresh && cache && now - cache.at < TTL) return cache.data

    // 先查 npm（发布在哪就以哪为准），查不到再回落到仓库
    const name = String(meta.name || '')
    if (name) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
        const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name), {
          signal: ctrl.signal,
          headers: { accept: 'application/vnd.npm.install-v1+json' },
        })
        clearTimeout(timer)
        if (res.ok) {
          const reg = await res.json()
          const latest = String((reg && reg['dist-tags'] && reg['dist-tags'].latest) || '')
          if (latest) {
            const data = {
              ok: true,
              current,
              latest,
              newer: cmpVer(latest, current) > 0,
              source: 'npm',
              repo: repoUrl,
              command: 'dsh plugin update ' + name,
            }
            cache = { at: now, data }
            return data
          }
        }
      } catch {
        /* npm 不通就回落到仓库 */
      }
    }

    const urls = rawUrls(repoUrl)
    if (!urls.length) {
      const data = {
        ok: false,
        current,
        repo: repoUrl,
        error: 'package.json 里没有 repository 地址，查不了',
      }
      cache = { at: now, data }
      return data
    }

    let latest = ''
    const tried = []
    for (const u of urls) {
      tried.push(u)
      try {
        const j = await fetchJson(u)
        if (j && j.version) {
          latest = String(j.version)
          break
        }
      } catch {
        /* 换下一个源 */
      }
    }

    if (!latest) {
      const data = { ok: false, current, repo: repoUrl, tried, error: '查不到（网络不通或仓库地址不对）' }
      cache = { at: now, data }
      return data
    }

    const cmp = cmpVer(latest, current)
    const data = {
      ok: true,
      current,
      latest,
      newer: cmp > 0,
      repo: repoUrl,
      command: 'dsh plugin update dsh-consciousness',
    }
    cache = { at: now, data }
    return data
  }
}
