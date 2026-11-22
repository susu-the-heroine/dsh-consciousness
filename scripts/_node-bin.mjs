/**
 * 找 node 可执行文件（2026-11-21）
 * ==========================
 *
 * 插件里跑脚本时，process.execPath 指的是桌面那个程序，不是 node。
 * 拿它去起子进程，起出来的是本体——脚本一句结果都不给，报错还说不出所以然。
 * 这个坑在脚本里出现过几十次，所以收成一个地方：
 *   在 node 里跑 → 就用它自己
 *   否则        → 认 DSH_NODE 环境变量
 *   再不行      → 退回 PATH 上的 node
 */
// 2026-11-21 补：退回 PATH 上那个 node 是个死胡同——实测本机 PATH 里根本没有 node
// （DSH 带着自己的运行时，但不往 PATH 里放）。真在桌面程序里跑到这条退回，
// 起子进程会失败，而报错只说「起不来」，看不出是找错了可执行文件。
// 所以按顺序试：先认自己 → 再认环境变量 → 再认就挨着自己找 → 最后才认 PATH。
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const execPath = String(process.execPath || '')

function findNode() {
  if (/node(\.exe)?$/i.test(execPath)) return execPath
  const env = String(process.env.DSH_NODE || '').trim()
  if (env) return env
  // 桌面程序旁边常带着一份自己的运行时；往上找两层，命中就用。
  const near = [
    join(dirname(execPath), 'node.exe'),
    join(dirname(execPath), 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    join(dirname(execPath), '..', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
  ]
  for (const c of near) {
    try { if (existsSync(c)) return c } catch {}
  }
  if (!existsSync(execPath)) {
    console.log('找不到 node 可执行文件：设一下 DSH_NODE，指向 node.exe 的完整路径。')
    console.log('（当前这个进程的可执行文件是：' + (execPath || '(空)') + '）')
  }
  return 'node'
}

export const NODE = findNode()
