/**
 * 恢复演练：故意把库写坏，再用备份拉回来
 * ======================================
 *   node scripts/restore-drill.mjs
 *
 * 全程在临时目录里做，不碰真库。判据三件：
 * 一、写坏之后读库确实读不出来（证明演练有效）；
 * 二、从备份恢复之后能解析；
 * 三、恢复后的条目数与备份一致。
 */
import { mkdtempSync, mkdirSync, cpSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

const src = join(homedir(), '.dsh', 'consciousness-seas', 'main')
const tmp = mkdtempSync(join(tmpdir(), 'drill-'))
const dst = join(tmp, 'main')
cpSync(src, dst, { recursive: true })

const dataFile = join(dst, 'data.json')
const before = JSON.parse(readFileSync(dataFile, 'utf8')).points.length

// 一、写坏
writeFileSync(dataFile, '{坏掉的', 'utf8')
let broken = false
try { JSON.parse(readFileSync(dataFile, 'utf8')) } catch { broken = true }

// 二、找真备份（2026-11-21 改）：
// 原来只在海目录里翻 data.json.bak*——那是几个人工留下的零碎，最新的一份还是十一月十九号的；
// 真正的备份系统写在 consciousness-backups/<海>/<时间>.json，主海那底下有三千多份、最新是今天的。
// 拿零碎当备份演练，测的是影子；一份都没有时它还现场造一份，那就更是「自己拷给自己」，永远通过。
const bakDir = join(homedir(), '.dsh', 'consciousness-backups', 'main')
let baks = []
try {
  baks = readdirSync(bakDir)
    .filter((f) => /^\d{8}-\d{6}.*\.json$/.test(f) && !f.endsWith('.vectors.json'))
    .map((f) => ({ f: join(bakDir, f), t: statSync(join(bakDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
} catch {}
if (!baks.length) {
  console.log('真备份目录里没有可用备份：' + bakDir)
  console.log('演练没做成——不能算通过。先让写入流程备份过至少一次再来。')
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
  process.exit(2)
}
// 期望值取备份自己那份的条数，不是「写坏之前」的条数——
// 备份之后库里又写过新东西的话，两个数天然对不上，那是备份晚，不是恢复坏。
let expect = before
// 备份文件现在是绝对路径，别再拿临时目录去拼。
try { expect = JSON.parse(readFileSync(baks[0].f, 'utf8')).points.length } catch {}
cpSync(baks[0].f, dataFile, { force: true })

// 三、能解析、条数对得上
let n = 0
let parsed = false
try { n = JSON.parse(readFileSync(dataFile, 'utf8')).points.length; parsed = true } catch {}

console.log(`写坏后读不出：${broken ? '是' : '否（演练无效）'}｜备份 ${baks[0].f}（${new Date(baks[0].t).toISOString().slice(0, 16).replace('T', ' ')}）｜恢复后能解析：${parsed ? '是' : '否'}｜条数 ${n}（备份那份 ${expect}）`)
const ok = broken && parsed && n === expect
console.log(ok ? '恢复演练通过' : '恢复演练没过')
rmSync(tmp, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
