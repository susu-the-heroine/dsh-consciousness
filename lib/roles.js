/**
 * 多角色与识海之间的桥
 * ====================
 *
 * 一个角色 = 一个识海 + 一份人设。角色之间记忆完全隔离，但可以建桥。
 * 桥是只读的：A 能看见 B 的某几条，但写不进 B。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeJsonAtomic } from './json-file.js'
import { ROLES_FILE, SEA_LINKS, SEAS_DIR } from './paths.js'
import { readSea, readMeta } from './store.js'

export function readRoles() {
  try {
    if (!existsSync(ROLES_FILE)) return {}
    // 2026-11-20：别处读文件都先削掉 BOM，这两处没有。这机器上拿编辑器/命令行存一次就带 BOM，
    // 一带就是整份读不出来、回空表——角色配置看着像凭空没了。跟别处对齐。
    return JSON.parse(readFileSync(ROLES_FILE, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
}

export function writeRoles(o) {
  // 2026-11-20：原子写失败只回假、不抛——这里原来照样回真，等于骗调用方。
  return writeJsonAtomic(ROLES_FILE, o) === true
}

/* 角色名 -> 识海名。没配过就用识海名当角色名。 */
export function roleOfSea(sea) {
  const roles = readRoles()
  for (const [name, info] of Object.entries(roles)) {
    if (info && info.sea === sea) return name
  }
  return sea
}

export function readLinks() {
  try {
    if (!existsSync(SEA_LINKS)) return { bridges: [], masters: {} }
    return JSON.parse(readFileSync(SEA_LINKS, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return { bridges: [], masters: {} }
  }
}

export function writeLinks(o) {
  return writeJsonAtomic(SEA_LINKS, o) === true
}

/* 桥上的记忆：两个识海都能看到，但只读（改还是改自己那边） */
export function bridgedMemories(sea) {
  const links = readLinks()
  const out = []
  for (const b of (links.bridges || [])) {
    if (b.a !== sea && b.b !== sea) continue
    const other = b.a === sea ? b.b : b.a
    const data = readSea(other)
    if (!data) continue
    const ids = new Set(b.ids || [])
    for (const p of (data.points || [])) {
      if (p.dead) continue
      if (ids.size && !ids.has(p.id)) continue
      out.push({ ...p, _from: other })
    }
  }
  return out
}
