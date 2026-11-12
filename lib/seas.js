/**
 * 识海清单
 * ========
 *
 * 有哪些识海、各自多少条、绑定到哪个窗口/工作区。
 * 页面左边的列表、每次切识海都靠这几个。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HTML, SEAS_DIR } from './paths.js'
import { readMeta } from './store.js'

/** 主识海有多少条：从页面里那个 stats 里抠 */
export function currentCount() {
  try {
    const m = readFileSync(HTML, 'utf8').match(/"stats":\s*\{\s*"points":\s*(\d+)/)
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}

export function listSeas() {  const items = []
  try {
    if (existsSync(SEAS_DIR)) {
      for (const name of readdirSync(SEAS_DIR)) {
        const metaPath = join(SEAS_DIR, name, 'meta.json')
        if (!existsSync(metaPath)) continue
        let meta = {}
        try {
          meta = JSON.parse(readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, ''))
        } catch {
          meta = {}
        }
        let count = Number(meta.count) || 0
        try {
          const dataPath = join(SEAS_DIR, name, 'data.json')
          if (existsSync(dataPath)) {
            const dd = JSON.parse(readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, ''))
            if (Array.isArray(dd.points)) count = dd.points.length
          }
        } catch {
          /* 读不出来就用 meta 里的 */
        }
        items.push({
          id: name,
          name: meta.name || name,
          count,
          mtime: meta.mtime || '',
          workspace: meta.workspace || '',
          session: meta.session || '',
        })
      }
    }
  } catch {
    /* 目录读不了就当没有 */
  }
  if (!items.length) {
    items.push({ id: 'main', name: '主识海', count: currentCount(), mtime: '' })
  }
  return items
}

/** 从 DSH 的工作区登记处拿列表，给「新建识海」当选项 */

export function listWorkspaces(ctx) {
  try {
    const reg = ctx.workspaceRegistry || (typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined)
    if (!reg || typeof reg.list !== 'function') return []
    return reg.list().map((w) => {
      const path = String((w && w.path) || '')
      const name = String((w && w.name) || path.split(/[\\/]/).filter(Boolean).pop() || (w && w.id) || '')
      return { id: String((w && w.id) || path), name, path }
    })
  } catch {
    return []
  }
}

/** 写之前留一份，保留 14 天 */



/** 窗口（会话）列表：登记处的历史窗口 + 内存里活着的，标题优先 */

export function listWindows(ctx) {
  try {
    const reg = ctx.get('workspaceRegistry') || ctx.workspaceRegistry
    const ss = ctx.get('sessions') || ctx.sessions
    const st = ctx.get('sessionTitle') || ctx.sessionTitle
    const seen = new Map()
    // 归档的会话不列：它们只是藏起来，不该出现在「绑给谁」里
    const archived = new Set()
    try {
      for (const x of (reg && reg.archivedSessionIds) || []) archived.add(String(x))
    } catch {
      /* 忽略 */
    }

    // 一、登记处里每个工作区名下的会话（历史窗口都在这儿）
    try {
      for (const w of reg && typeof reg.list === 'function' ? reg.list() : []) {
        const wname = String(
          (w && w.title) ||
            (w && w.name) ||
            String((w && w.path) || '').split(/[\\/]/).filter(Boolean).pop() ||
            '',
        )
        const label =
          wname === 'default-workspace'
            ? '默认工作区'
            : String((w && w.path) || '').split(/[\\/]/).filter(Boolean).pop() || wname
        for (const sid of (w && w.sessionIds) || []) {
          const id = String(sid)
          if (!id || archived.has(id)) continue
          if (!seen.has(id)) seen.set(id, { id, workspace: label })
        }
      }
    } catch {
      /* 忽略 */
    }

    // 二、内存里活着的会话（登记处没登记的也补上）
    try {
      for (const s of ss && typeof ss.list === 'function' ? ss.list() : []) {
        const id = String((s && s.id) || '')
        if (!id || archived.has(id) || seen.has(id)) continue
        seen.set(id, { id, workspace: '' })
      }
    } catch {
      /* 忽略 */
    }

    const out = []
    for (const item of seen.values()) {
      let title = ''
      let live = false
      try {
        const sess = ss && typeof ss.get === 'function' ? ss.get(item.id) : undefined
        if (sess) {
          live = true
          if (st && typeof st.get === 'function') {
            const snap = st.get(sess)
            title = String((snap && snap.title) || '')
          }
        }
      } catch {
        title = ''
      }
      // 没标题就别露一长串 id，取 session- 后面那 4 位当记号
      const shortId = item.id.replace(/^session-/, '').slice(0, 4) || item.id.slice(0, 4)
      const info = cachedInfo(item.id)
      const rawTitle = title || info.title
      const short = rawTitle ? String(rawTitle).replace(/\s+/g, ' ').slice(0, 10) : ''
      out.push({
        id: item.id,
        name: short || shortId,
        title: rawTitle,
        workspace: item.workspace,
        live,
        mtime: live ? Number.MAX_SAFE_INTEGER : info.mtime,
      })
    }
    // 登记处里躺着的历史记录不算「窗口」：活着的全留，历史的只留最近 8 个
    out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    const live = out.filter((x) => x.live)
    const hist = out.filter((x) => !x.live).slice(0, 8)
    return live.concat(hist)
  } catch {
    return []
  }
}

/** 标题 + 最近活跃时间的后备来源：DSH 的会话投影缓存 */

export function cachedInfo(id) {
  try {
    const dir = join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')
    const bare = String(id).replace(/^session-/, '')
    const cands = [id + '.json', bare + '.json', 'session-' + bare + '.json']
    for (const c of cands) {
      const p = join(dir, c)
      if (!existsSync(p)) continue
      let mtime = 0
      try {
        mtime = statSync(p).mtimeMs
      } catch {
        mtime = 0
      }
      try {
        const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
        const t = j && j.record && j.record.rows && j.record.rows.title && j.record.rows.title.val
        return { title: t ? String(t) : '', mtime }
      } catch {
        return { title: '', mtime }
      }
    }
  } catch {
    /* 忽略 */
  }
  return { title: '', mtime: 0 }
}

/** 首次安装时把两个示例识海放进去（已存在就跳过，不覆盖用户数据） */

export function ensureSamples() {
  try {
    const src = join(HERE, 'assets', 'samples')
    if (!existsSync(src)) return
    if (!existsSync(SEAS_DIR)) mkdirSync(SEAS_DIR, { recursive: true })
    for (const name of readdirSync(src)) {
      const from = join(src, name)
      const to = join(SEAS_DIR, name)
      if (existsSync(to)) continue
      mkdirSync(to, { recursive: true })
      for (const f of readdirSync(from)) {
        const fp = join(from, f)
        if (statSync(fp).isFile()) copyFileSync(fp, join(to, f))
      }
    }
  } catch {
    /* 放不进去就算了，不影响主流程 */
  }
}





/* 中文分词：二字 + 三字。
 * 原来只有二字，「车站」会跟「车」撞上；加了停用词过滤和三字，
 * 「车站」这种具体的组合才立得住。 */



/* 图游走：从命中的几条出发，沿边往外扩。
 * 这是 HippoRAG 的思路（Personalized PageRank），衰减系数 0.85。
 * 好处：问「那次吵架」，能顺着边翻出「他骂我」和「后来和好」——
 * 不是字面撞上，是走过去的。 */

/* ---------- 多角色 ----------
 * 一个角色 = 一个识海 + 一份人设。
 * 角色之间记忆完全隔离（不同识海目录），但共用一颗心脏。
 * 风险文档：「多角色共用心脏，角色 ID 混淆，记忆串库」
 *   → 每条记忆绑角色 ID（就是它所在的识海名），读写都带过滤。
 */




/* ---------- 识海之间的关系 ----------
 * 三种：
 *   independent —— 完全隔开（默认）
 *   bridge      —— 互通：一座桥，桥上的记忆两边都看得见
 *   master/slave—— 主从：从的跟着主的走，从不能独立写
 *
 * 风险文档：「多识海主-从同步 bug；互通模式记忆互相污染」
 *   → 独立完全隔离；主从单向；互通要显式导入，不静默复制
 */




/* ---------- 向量服务自启 ----------
 * 插件起来时顺手把 embed_server.py 拉起来。
 * 已经有一个在跑就不重复起（先探一下端口）。
 * 起不来就不起——降级到字面检索，不报错。
 */
let _embedProc = null

