/**
 * 路径与常量
 * ==========
 *
 * 原先这些都写在 index.js 开头。拆出来是因为：
 *   · 五个模块都要用 SEAS_DIR / HOME / ASSETS
 *   · 它们散在 5209 行的文件头，改一个路径要翻半天
 *
 * 注意 HERE 的语义：这里是插件的**根目录**（index.js 那一层），
 * 不是 lib/ 这一层。所以用 '..' 往上退一级。
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))

/** 插件根目录（index.js 所在的那层） */
export const HERE = join(LIB_DIR, '..')

/** 用户主目录 */
export const HOME = process.env.USERPROFILE || homedir()

/** 插件自带的 assets */
export const ASSETS = join(HERE, 'assets')

/** 老环境可以用环境变量指过去，代码里不写死任何人的路径 */
export const LEGACY = String(process.env.CONSCIOUSNESS_ASSETS || '').trim()

/** 真正用的脚本目录：优先插件自带，其次环境变量 */
export const BASE = existsSync(join(ASSETS, 'add_memory.py')) ? ASSETS : LEGACY || ASSETS

/** 识海页面 */
export const HTML = join(BASE, '意识海.html')

/** 写入脚本 */
export const SCRIPT = join(BASE, 'add_memory.py')

/** 分词词典 */
export const DICT_PATH = join(ASSETS, '词典.txt')

/** 多识海目录：一个子目录一个识海，里面放 meta.json */
export const SEAS_DIR = join(HOME, '.dsh', 'consciousness-seas')

/** 备份目录 */
export const BACKUP_DIR = join(HOME, '.dsh', 'consciousness-backups')

/** 心脏状态（情绪、能量、疲惫） */
export const HEART_FILE = join(HOME, '.dsh', 'consciousness-heart.json')

/** 审计日志 */
export const AUDIT_FILE = join(HOME, '.dsh', 'consciousness-audit.log')
export const AUDIT_MAX_BYTES = 2 * 1024 * 1024

/** 档位配置 */
export const QUALITY_FILE = join(HOME, '.dsh', 'consciousness-quality.json')

/** 检索日志（append-only）。每次 memory_search 一行，标注再一行 */
export const SEARCH_LOG_FILE = join(HOME, '.dsh', 'consciousness-search-log.jsonl')

/** 多角色配置 */
export const ROLES_FILE = join(HOME, '.dsh', 'consciousness-roles.json')

/** 识海之间的桥 */
export const SEA_LINKS = join(HOME, '.dsh', 'consciousness-links.json')

/** 向量查询服务 */
export const EMBED_URL = 'http://127.0.0.1:8931'

/** Python 候选路径 */
/** Python 候选路径
 *  顺序：环境变量 → DSH 自带运行时 → 老本机环境 → 系统 PATH
 *  DSH 装完就自带一个 python，不必让用户另装。两种布局都扫：
 *    <LOCALAPPDATA>\Programs\DeepSeek Harness\resources\runtime\<名字>\dependencies\python\python.exe
 *    ~\.dsh\dsh-runtimes\<名字>\dependencies\python\python.exe
 */
function scanRuntimePython() {
  const out = []
  const roots = []
  const la = process.env.LOCALAPPDATA || ''
  if (la) roots.push(join(la, 'Programs', 'DeepSeek Harness', 'resources', 'runtime'))
  roots.push(join(HOME, '.dsh', 'dsh-runtimes'))
  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
      for (const d of readdirSync(root)) {
        for (const c of [
          join(root, d, 'dependencies', 'python', 'python.exe'),
          join(root, d, 'python', 'python.exe'),
        ]) {
          if (existsSync(c)) out.push(c)
        }
      }
    } catch {
      /* 忽略，继续找下一个根 */
    }
  }
  return out
}

export const PY_CANDIDATES = [
  process.env.MEMORY_PYTHON,
  ...scanRuntimePython(),
  // Linux/macOS 上一律叫 python3；Windows 上 python 更常见。两个都带上（2026-11-12）
  'python3',
  'python',
].filter(Boolean)

/** 临时目录（备份时用） */
export const TMP_DIR = tmpdir()

/** 写入锁的存活时间 */
export const LOCK_TTL = 60 * 1000

/** 归档判据 */
export const ARCHIVE_DAYS = 120
export const ARCHIVE_IMP = 0.5
export const ARCHIVE_R = 0.18
