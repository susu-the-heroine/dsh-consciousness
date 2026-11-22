#!/usr/bin/env node
/**
 * 【DEPRECATED · 2026-11-22 作废】别再拿它量「人味」。
 * 两版都验废：按句算，他自己原话 10%/5%，比我的 24%/19% 还低；
 * 按每百字密度算，他 0.7、我 2.0——量的是信息量，不是人味。
 * 只留作历史记录，脚本照原样在，但结论不许再引用。
 */
/**
 * 内容尺子：人味不在标点，在有没有东西
 * ====================================
 *   node scripts/content-check.mjs <文件> [文件2 ...]
 *
 * 三条，全部按「句」算，报比例：
 *   A 具体度：这句有没有具体物 / 数字 / 专名（薯片、经十路、25.88%、C 段、GMod、护栏……）
 *   B 判断句：这句有没有拍板（我认、不行、别、该、得、必须、停了、砍了）
 *   C 呼应：这句有没有指向对方（你 / 你这 / 你那 / 你说）+ 一个具体词——是代理指标，不是真呼应
 *
 * 背景：苏苏侠说「你把一个最没用的问题放到最大了 就是标点符号」。
 * 所以标点那条已从 ai-smell 删掉，人味改由这三条量。
 */
import { readFileSync } from 'node:fs'

const CONCRETE = /[0-9]+(\.[0-9]+)?%?|[Gg]mod|剪映|即梦|薯片|经十路|大路虎|护栏|注入|扫描器|尺子|题库|实验|记忆|流水|标点|数字|重启|版本|插件|识海|国网|路虎|济南|雪地|素材|台词|配音|成片/
const JUDGE = /我认|不认|不行|甭|别|拉倒|算了|必须|不许|该砍|得砍|停了|砍了|撤了|回滚|认了|不干|不测|不装|先别|别急/
const ECHO = /你|您/

const lines = readFileSync(process.argv[2], 'utf8').split('\n')
  .filter((l) => l.trim())
  .map((l) => l.replace(/^\d+\.\s*/, '').trim())

// v2：短句天然少词，所以具体度按「每百字几个具体词」算，不按句算
let hits = 0, chars = 0, b = 0, c = 0
for (const t of lines) {
  const m = t.match(new RegExp(CONCRETE.source, 'g'))
  hits += m ? m.length : 0
  chars += [...t].length
  if (JUDGE.test(t)) b++
  if (ECHO.test(t) && CONCRETE.test(t)) c++
}
const n = lines.length || 1
console.log('  ' + process.argv[2].split(/[\\/]/).pop() + '：' + n + ' 条 · ' + chars + ' 字')
console.log('    具体词密度 ' + (hits / Math.max(chars, 1) * 100).toFixed(1) + ' 个/百字')
console.log('    判断句率 ' + (b / n * 100).toFixed(0) + '%（' + b + '/' + n + '）')
console.log('    呼应代理 ' + (c / n * 100).toFixed(0) + '%（' + c + '/' + n + '）')
