/**
 * 「这是不是主海」的唯一判据（2026-11-19 夜 · P145）
 * =================================================
 * 以前各个脚本自己写 `sea === 'main'`，只比字符串。换个写法就绕过去：
 * main/../main、./main、MAIN、带空格的 ' main '。
 * 这里统一按路径算：归一化、去尾斜杠、Windows 下不分大小写，再比。
 */
import { resolve } from 'node:path'

export function normSea(name) {
  let s = String(name == null ? '' : name).trim()
  if (!s) return ''
  s = s.replace(/[\\/]+$/, '')
  try {
    s = resolve('/', s).replace(/^[A-Za-z]:[\\/]/, '').replace(/^[\\/]+/, '')
  } catch {}
  if (process.platform === 'win32') s = s.toLowerCase()
  return s
}

export function isMainSea(name) {
  return normSea(name) === 'main'
}
