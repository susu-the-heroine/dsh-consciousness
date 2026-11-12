// 防回归：发包前扫一遍，不许出现任何「本机路径」
// 用法：node scripts/check_personal_paths.mjs
// 退出码 0 = 干净；1 = 命中，不许发版

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

// 只查真正会发出去的东西（跟 package.json 的 files 对齐）
const SCAN = ['index.js', 'client.js', 'selfupdate.mjs', 'cordis.patch.yml', 'install.ps1', 'assets', 'lib']
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.wav', '.mp3', '.pyc', '.docx', '.txt', '.pfx'])

// 本机专属路径的特征
const BAD = [
  /C:\\\\Users\\\\[A-Za-z0-9._-]+/i, // 具体用户名
  /C:\/Users\/[A-Za-z0-9._-]+\//i,
  /C:\\\\AI-DDSP/i, // 本机 RVC/TTS 环境
  /C:\\\\Program Files/i, // 硬编码安装位置
  /[DE]:\\\\AISong/i,
  /[DE]:\\\\SteamLibrary/i,
]

function walk(p, out = []) {
  const st = statSync(p)
  if (st.isDirectory()) {
    for (const f of readdirSync(p)) {
      if (f === 'node_modules' || f.startsWith('.') || f.includes('.bak')) continue
      walk(join(p, f), out)
    }
  } else if (!SKIP_EXT.has(p.slice(p.lastIndexOf('.')).toLowerCase())) {
    out.push(p)
  }
  return out
}

const files = []
for (const s of SCAN) {
  const p = join(ROOT, s)
  try {
    walk(p, files)
  } catch {
    /* 没有就跳过 */
  }
}

let bad = 0
for (const f of files) {
  let text
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    // 注释里放宽：只警告不失败，避免示例配置把人卡住
    const isComment = /^\s*(\/\/|\*|\/\*|#|<!--)/.test(line)
    for (const re of BAD) {
      if (re.test(line)) {
        const tag = isComment ? 'WARN(注释)' : 'FAIL'
        if (!isComment) bad++
        console.log(`${tag} ${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 110)}`)
      }
    }
  })
}

if (bad > 0) {
  console.log(`\n发现 ${bad} 处硬编码本机路径，不许发版。`)
  process.exit(1)
}
console.log(`\n干净：扫了 ${files.length} 个文件，没有硬编码本机路径。`)
