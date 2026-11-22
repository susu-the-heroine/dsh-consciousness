/**
 * 拆包发布：代码包 + 模型包
 * ========================
 *
 * 痛点在"改一行代码要重下 38 MB 模型"。拆成两个包：
 *   dsh-consciousness2-<ver>-code.tgz   代码，约 18 MB
 *   dsh-consciousness2-<ver>-embed.tgz  模型与引擎，约 24 MB
 *
 * 装法：两个包解到同一个插件目录即可（模型包解出来是 assets/embed/...）。
 *
 * 跑法：node scripts/pack-split.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const ver = pkg.version
// 2026-11-21：两处硬编码要收拾。其一，家目录取不到时这里会拿 undefined 去拼路径，
// 直接抛「path must be string」；其二，包名在文件里手抄了两遍，改名就打包出旧名字的文件。
// 家目录没有就报明白话，包名从 package.json 读。
const HOME_DIR = process.env.USERPROFILE || process.env.HOME
if (!HOME_DIR) {
  console.error('找不到家目录（USERPROFILE / HOME 都没设），没法决定打包输出到哪')
  process.exit(2)
}
const outDir = join(HOME_DIR, 'Desktop', '识海发版')
mkdirSync(outDir, { recursive: true })

const stage = join(tmpdir(), 'pack-split-' + Date.now())
const inside = join(stage, 'package')
mkdirSync(inside, { recursive: true })

// 1) 按白名单拷（和 pack.mjs 一套规矩）：只放运行要用的。
// 2026-11-22 改：原来是整目录拷，结果 _backups、给他、test、人味知识库 全进了包。
const WHITELIST_FILES = [
  'package.json', 'index.js', 'client.js', 'cordis.patch.yml',
  'README.md', 'README.en.md', 'CHANGELOG.md', 'INSTALL.md', 'LICENSE', 'LICENSE.md',
  'install.ps1', 'selfupdate.mjs', '安装卡.docx',
]
const WHITELIST_DIRS = ['lib', 'assets', 'docs']
const FORBIDDEN_NAME = /^(运行规则|记忆规则|测试清单|发给谁|人格与记忆_学习笔记)\.md$/
// 申报稿点了他名字、还提了病史，不能跟包走（2026-11-22 体检逮到）
const FORBIDDEN_FILES = new Set(['docs/识海_项目说明材料.docx'])
for (const f of WHITELIST_FILES) {
  const src = join(ROOT, f)
  if (existsSync(src)) cpSync(src, join(inside, f))
}
for (const d of WHITELIST_DIRS) {
  const src = join(ROOT, d)
  if (!existsSync(src)) continue
  cpSync(src, join(inside, d), {
    recursive: true,
    filter: (s2) => {
      const rel = s2.slice(ROOT.length + 1).replace(/\\/g, '/')
      if (/(^|\/)(node_modules|\.git|_backups|_local-backups|给他|test|data|私人|人味知识库)(\/|$)/.test(rel)) return false
      if (FORBIDDEN_NAME.test(rel.split('/').pop())) return false
      if (FORBIDDEN_FILES.has(rel)) return false
      if (/\.bak|\.oldcode$|\.tgz$/.test(rel)) return false
      return true
    },
  })
}

// 2) 代码包：剔掉模型目录
const codeTgz = join(outDir, `${pkg.name}-${ver}-code.tgz`)
rmSync(codeTgz, { force: true })
execFileSync('tar', ['-czf', codeTgz, '-C', stage, '--exclude=package/assets/embed', 'package'], { stdio: 'inherit' })

// 3) 模型包：只装 assets/embed
const modelStage = join(tmpdir(), 'pack-split-model-' + Date.now())
mkdirSync(join(modelStage, 'package', 'assets'), { recursive: true })
cpSync(join(inside, 'assets', 'embed'), join(modelStage, 'package', 'assets', 'embed'), { recursive: true })
const embedTgz = join(outDir, `${pkg.name}-${ver}-embed.tgz`)
rmSync(embedTgz, { force: true })
execFileSync('tar', ['-czf', embedTgz, '-C', modelStage, 'package'], { stdio: 'inherit' })

const mb = (p) => (statSync(p).size / 1048576).toFixed(1)
console.log('')
console.log(`代码包：${codeTgz}  ${mb(codeTgz)} MB`)
console.log(`模型包：${embedTgz}  ${mb(embedTgz)} MB`)

rmSync(stage, { recursive: true, force: true })
rmSync(modelStage, { recursive: true, force: true })
