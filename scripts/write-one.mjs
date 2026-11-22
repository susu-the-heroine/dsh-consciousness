// 拿题面写一句，走已有那条入库路径。
import { finishThink } from '../lib/think.js'
const line = process.argv[2]
// 2026-11-21：没给句子原来退零——跟别处「没做事就退非零」的规矩不一致，
// 让调用方以为写成功了。改成退二。
if (!line) { console.log('没给句子（用法：node scripts/write-one.mjs "一句话"）'); process.exit(2) }
// 2026-11-21：这份直连真库，没有沙箱开关。写之前把这件事说一句，
// 免得有谁当它是测试脚本、随手一跑就往真库里塞一条。
console.log('注意：这份是直写真库（不是沙箱）。真要试，先想清楚这一句要不要落进去。')
const r = finishThink(line, 40)
console.log(JSON.stringify(r, null, 1))
