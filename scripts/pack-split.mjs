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
const outDir = join(process.env.USERPROFILE || process.env.HOME, 'Desktop', '识海发版')
mkdirSync(outDir, { recursive: true })

const stage = join(tmpdir(), 'pack-split-' + Date.now())
const inside = join(stage, 'package')
mkdirSync(inside, { recursive: true })

// 1) 拷一份完整插件（跳过临时与备份）
cpSync(ROOT, inside, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(ROOT.length + 1)
    if (!rel) return true
    if (/(^|\\|\/)(node_modules|\.git|_legacy-py|_html-bak)(\\|\/|$)/.test(rel)) return false
    if (/\.bak|\.oldcode$|\.crashed\d*$|\.tgz$/.test(rel)) return false
    return true
  },
})

// 2) 代码包：剔掉模型目录
const codeTgz = join(outDir, `dsh-consciousness2-${ver}-code.tgz`)
rmSync(codeTgz, { force: true })
execFileSync('tar', ['-czf', codeTgz, '-C', stage, '--exclude=package/assets/embed', 'package'], { stdio: 'inherit' })

// 3) 模型包：只装 assets/embed
const modelStage = join(tmpdir(), 'pack-split-model-' + Date.now())
mkdirSync(join(modelStage, 'package', 'assets'), { recursive: true })
cpSync(join(inside, 'assets', 'embed'), join(modelStage, 'package', 'assets', 'embed'), { recursive: true })
const embedTgz = join(outDir, `dsh-consciousness2-${ver}-embed.tgz`)
rmSync(embedTgz, { force: true })
execFileSync('tar', ['-czf', embedTgz, '-C', modelStage, 'package'], { stdio: 'inherit' })

const mb = (p) => (statSync(p).size / 1048576).toFixed(1)
console.log('')
console.log(`代码包：${codeTgz}  ${mb(codeTgz)} MB`)
console.log(`模型包：${embedTgz}  ${mb(embedTgz)} MB`)

rmSync(stage, { recursive: true, force: true })
rmSync(modelStage, { recursive: true, force: true })
