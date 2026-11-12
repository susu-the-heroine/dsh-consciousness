// 拿题面写一句，走已有那条入库路径。
import { finishThink } from '../lib/think.js'
const line = process.argv[2]
if (!line) { console.log('没给句子'); process.exit(0) }
const r = finishThink(line, 40)
console.log(JSON.stringify(r, null, 1))
