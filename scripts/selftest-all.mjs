/**
 * 一键自检：把散在各处的验证一次跑完
 * ==================================
 *
 * 2026-11-12 一天里改了写入链路、双写、镜像导出、工具注册、候选路径。
 * 这些各自都有自测，但散在五六个脚本里，容易漏跑。
 * 这个脚本只负责"叫齐"和"汇总"，不重复实现任何检查。
 *
 * 跑法：node scripts/selftest-all.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 别人的机器上不一定有 main，更不会有 sandbox。缺了就别跑依赖它的那几条，
// 说清楚"跳过"，别让人第一次自检就看到五条红。2026-11-15。
function seaExists(name) {
  return existsSync(join(homedir(), '.dsh', 'consciousness-seas', name, 'data.json'))
}
const HAS = { main: seaExists('main'), sandbox: seaExists('sandbox') }
// 2026-11-21：在插件里跑的时候，这个值是桌面那个程序，不是 node。
// 拿它去起一百多组测试，起出来的全是本体，整排红。跟前面几处同源，这里也改成先认 node。
const NODE = /node(\.exe)?$/i.test(process.execPath) ? process.execPath : (process.env.DSH_NODE || 'node')

const suites = [
  { name: '写入链路（21 项）', script: 'writer-verify.mjs', args: [] },
  // 2026-11-20 夜：四个并发测试从手跑改成每天跑（向量那条早就在，见「向量账本」）
  { name: '并发 · 念头池', script: 'thought-lock-test.mjs', args: [] },
  { name: '并发 · 绑定表', script: 'bind-lock-test.mjs', args: [] },
  { name: '绑定表清理', script: 'bind-prune-test.mjs', args: [] },
  { name: '情绪线', script: 'moodline-test.mjs', args: [] },
  { name: '路由方法审计', script: 'routes-method-audit.mjs', args: [] },
  { name: '脚本真库守卫', script: 'sea-guard-audit.mjs', args: [] },
  { name: '写入去重闸', script: 'dedupe-gate-test.mjs', args: [] },
  { name: '多海路由', script: 'sea-routing-test.mjs', args: [] },
  { name: '名字题拒答', script: 'name-gate-test.mjs', args: [] },
  { name: '本地日期', script: 'day-test.mjs', args: [] },
  { name: '念头垃圾输入', script: 'thought-junk-test.mjs', args: [] },
  { name: '海名大小写撞车', script: 'sea-case-test.mjs', args: [] },
  { name: '并发 · 自模式', script: 'mode-lock-test.mjs', args: [] },
  { name: '新旧打架', script: 'fresh-test.mjs', args: [] },
  { name: '恢复演练', script: 'restore-drill.mjs', args: [] },
  { name: '词闸（5 项）', script: 'gate-selftest.mjs', args: [] },
  { name: 'SQLite 镜像（8 项）', script: 'sqlite-mirror-test.mjs', args: [] },
  { name: '候选两路（6 项）', script: 'candidates-test.mjs', args: ['main'], needs: 'main' },
  { name: 'JSON 与 SQLite 一致', script: 'sqlite-parity.mjs', args: ['main'], needs: 'main' },
  // 情绪这一圈：本来就有，只是一直没人跑
  { name: '口语情绪判定', script: '../test/emotion-colloquial.test.mjs', args: [] },
  { name: '情绪同频', script: '../test/affinity.test.mjs', args: [] },
  { name: '情绪动力学（回落/阻尼）', script: '../test/dynamics.test.mjs', args: [] },
  { name: '情绪标签', script: '../test/labels.test.mjs', args: [] },
  { name: '共情', script: '../test/empathy.test.mjs', args: [] },
  { name: '自我状态', script: '../test/selfstate.test.mjs', args: [] },
  // 2026-11-14：这两条一直在，但从没被叫齐过——它们是「一个人代表不了所有人」唯一的执行者。
  { name: '问句形状泛化（陌生人库）', script: 'test-shape-general.mjs', args: [] },
  { name: '陌生识海端到端', script: 'test-shape-other-sea.mjs', args: [] },
  { name: '给看的话像人话', script: 'lint-human-voice.mjs', args: [] },
  // 写库压测：只对沙箱海写三十次，每次读回来对一遍。证明"写进去"和"读得回"是一回事。
  { name: '写库压测（沙箱）', script: 'write-fuzz.mjs', args: ['sandbox', '30'], needs: 'sandbox' },
  // 四个进程同时写一个海：验证"尽力而为的锁"不是嘴上说说。
  { name: '并发写不坏（沙箱）', script: 'write-race.mjs', args: ['sandbox', '12', '4'], needs: 'sandbox' },
  // 两条写库路抢同一把锁：原先一边用硬链接建锁、一边用 open('wx') 写内容，能互相偷锁
  { name: '两条写库路抢锁', script: 'lock-interop-test.mjs', args: ['sandbox', '10'], needs: 'sandbox' },
  // 锁被占住时：主链路该等过再写、且不能删别人的锁；哪天统一语义这条会红
  { name: '锁被占时的反应', script: 'lock-wait-test.mjs', args: ['sandbox'], needs: 'sandbox' },
  // 进程崩了留下的锁：下一次写入必须立刻清掉照写，别让每次写入白等 3 秒
  { name: '死锁不拖累写入', script: 'dead-lock-test.mjs', args: ['sandbox'], needs: 'sandbox' },
  // 故障注入：锁被别人攥着不许硬写、目录被占要报错不崩、两轮过后原库还得完好（2026-11-19）
  { name: '故障注入（锁与目录）', script: 'fault-inject-test.mjs', args: [], needs: 'main' },
  // 调参文件改了要不要重启：期望当场生效（假家目录里试，不碰真的那份）
  { name: '调参改了不用重启', script: 'tuning-live-test.mjs', args: [] },
  // 检索速度的底线：只防塌方式变慢（中位 50ms、p90 200ms 的宽阈值）
  { name: '检索没变慢', script: 'recall-latency-test.mjs', args: ['sandbox'], needs: 'sandbox' },
  // 日志会自己收着：不无限长、不从半行切开
  { name: '日志有上限', script: 'logfile-test.mjs', args: [] },
  // 批注：能加一句、不改正文；空批注和乱编号要被拒
  { name: '批注不改正文', script: 'annotate-test.mjs', args: [] },
  // 换机演练：卸成文本、在干净环境装回去，条数与标题对得上（真库只读）
  { name: '换机能走得通', script: 'migration-drill.mjs', args: [], needs: 'main' },
  // 陌生人第一小时：空家目录里建海、写、列、搜、再写、导出，一步不卡
  { name: '第一小时能走完', script: 'first-hour-test.mjs', args: [] },
  // 两个海会不会串味：A 搜不到 B 的事，删 B 不动 A
  { name: '海与海不串味', script: 'sea-isolation-test.mjs', args: [] },
  // 海名带中文、空格、点：别人不会起英文名
  { name: '中文海名能用', script: 'sea-name-test.mjs', args: [] },
  // 检索自查能跑通（只看不写，主库只读）
  { name: '检索自查能跑', script: 'search-doctor.mjs', args: ['main'], needs: 'main' },
  // 换四种问法（问号/客套/空格/去疑问词），结论要稳
  { name: '换问法结论不翻', script: 'query-noise-test.mjs', args: [], needs: 'main' },
  // 记错了三种改法：批注、压可信度、钉时间，正文都不许动
  { name: '纠正三件套都真能改', script: 'correction-test.mjs', args: [] },
  // 只装代码包、不装模型包：检索要降级成直扫，不能塌
  { name: '没模型包也能搜', script: 'no-embed-test.mjs', args: [] },
  // 库里没有的事：说没有，不许硬编、不许拿不相干的顶包
  { name: '没记过就说没有', script: 'no-fabricate-test.mjs', args: [] },
  // 网页那条写库：锁被占着要在 3 秒内明说，不许让人干等两分钟
  { name: '网页写库不等两分钟', script: 'lock-web-test.mjs', args: [] },
  // 写了就必须搜得到：缺向量的条目，标题原话也要捞得回来
  { name: '归档不冒充活记忆', script: 'rescue-test.mjs', args: [], needs: 'main' },
  // 写前近重复检测：重复挡、不同放、force 硬写
  { name: '写前近重复检测', script: 'dup-gate-test.mjs', args: [] },
  // 时间说法：该模糊的模糊（前几天/上周），该准的还准（今天/昨天），估出来的仍说未知
  { name: '时间说法（正反）', script: 'test-fuzzy-time.mjs', args: [] },
  // 本机接口：健康不用令牌、没令牌 401、带令牌能查、答案与工具逐字一致、只读拒写
  { name: '本机接口（5 项）', script: 'test-api.mjs', args: [] },
  { name: '慢查询清单（9 项）', script: 'test-slowlog.mjs', args: [] },
  { name: '历史查询回放（10 项）', script: 'test-replay.mjs', args: [] },
  { name: '线程池探活（4 项）', script: 'test-pool-alive.mjs', args: [] },
  { name: '小题库切分（10 项）', script: 'test-small-qa.mjs', args: [] },
  { name: '结果多样性（9 项）', script: 'test-diversity.mjs', args: [] },
  { name: '置信标记（8 项）', script: 'test-uncertainty.mjs', args: [] },
  { name: '拒答口径（8 项）', script: 'test-refusal.mjs', args: [] },
  { name: '对得不准提示（4 项）', script: 'test-weaknote.mjs', args: [] },
  { name: '时间窗标记（6 项）', script: 'test-timewindow.mjs', args: [] },
  { name: '大跨度时间说明（3 项）', script: 'test-timewindow-note.mjs', args: [] },
  { name: '慢查询清单（8 项）', script: 'test-slowlog-recent.mjs', args: [] },
  { name: '重排护栏（7 项）', script: 'test-rerankguard.mjs', args: [] },
  { name: '语义拒答闸（3 项）', script: 'test-refuse-cos.mjs', args: [] },
  { name: '词门保底（4 项）', script: 'test-keep-last.mjs', args: [] },
  { name: '接口与工具一致（4 项）', script: 'test-route-parity.mjs', args: [] },
  { name: '时态择向（9 项）', script: 'test-tense.mjs', args: [] },
  { name: '判错落盘（5 项）', script: 'test-judge-feedback.mjs', args: [] },
  { name: '嵌入降级（5 项）', script: 'test-embed-off.mjs', args: [] },
  { name: '长问句拆意图（9 项）', script: 'test-splitintent.mjs', args: [] },
  { name: '数值归一（10 项）', script: 'test-numeric.mjs', args: [] },
  { name: '并发不崩（软）', script: 'test-concurrency-soft.mjs', args: [] },
  // 说法会变、事实不变：隔天换开口那句，正文逐字相同
  { name: '说法会变（正反）', script: 'test-voice-vary.mjs', args: [] },
  // 详略：情绪强/重要度高的记得清，琐事只剩个大概；三档长度递减
  { name: '详略（正反）', script: 'test-detail-grain.mjs', args: [] },
  // 改过口要说出来：有冲突提一句、没冲突不提、脏数据不炸、不带编号、不替人拿主意
  { name: '改口提示（正反）', script: 'test-conflict-note.mjs', args: [] },
  // 顺带想起：有边且邻居没在结果里就提一句；没边、已出现、归档、脏数据都不提
  { name: '顺带想起（正反）', script: 'test-aside.mjs', args: [] },
  // 问过就认得：两三周内问过同一句提一句；同一天、超三十天、别的海、脏数据都不提
  { name: '问过提示（正反）', script: 'test-recall-before.mjs', args: [] },
  // 盖过标记：旧条被新条盖了就挂个牌子，不删；空值脏值不炸，自己盖自己不许
  { name: '盖过标记（正反）', script: 'test-supersede.mjs', args: [] },
  // 偏心与残温：熟人记得细、生人一句带过；火气未散时开口那句不一样
  { name: '偏心残温（正反）', script: 'test-humanness2.mjs', args: [] },
  // 记粗：底气不足就说印象里，底气足一个字不加
  { name: '记粗（正反）', script: 'test-vague.mjs', args: [] },
  // 指着说：那个东西/它 要接回上一句，接不到就原样不许乱接
  { name: '指着说（正反）', script: 'test-context.mjs', args: [] },
  // 问的类型：问时间抬有日子的、问后来抬说清结果的、问有没有不动
  { name: '问的类型（正反）', script: 'test-asktype.mjs', args: [] },
  // 并错喊一声：并得干净不出声，并得可疑要说
  { name: '并错提醒（正反）', script: 'test-mergenote.mjs', args: [] },
  // 接话：问句里的字对上别处才接一句，短句不接、十分钟一次
  { name: '接话（正反）', script: 'test-contact.mjs', args: [] },
  // 显式缺口：问的物件库里没有就直说没记过，不许拿人名顶上
  { name: '显式缺口（正反）', script: 'test-gap.mjs', args: [] },
  // 一致性：一条事换三种问法，指的还是同一条（歧义题先剔）
  { name: '一致性反证', script: 'test-consistency.mjs', args: [] },
  // 物件名册：切得出名字、少一个字能补、换一个字不乱补
  { name: '物件名册（正反）', script: 'test-objects.mjs', args: [] },
  // 哪一件：同人同事多件时摆名字让人挑，不猜
  { name: '哪一件（正反）', script: 'test-ambiguity.mjs', args: [] },
  // 跨会话：中间又记了三十条，旧的还得认得出来
  { name: '隔几天再问', script: 'test-cross-session.mjs', args: [] },
  // 数条数：桌面版 execPath 是 .exe，不许再起子进程
  { name: '数条数（正反）', script: 'test-count.mjs', args: [] },
  { name: '向量补齐', script: 'test-vector-backfill.mjs', args: [] },
  // 向量账本：有没有缺的、正文改过之后有没有过期（只读，不重算）
  { name: '向量账本', script: 'vector-audit.mjs', args: ['main', '--strict'], needs: 'main' },
  { name: '向量粗筛', script: 'test-ann.mjs', args: [] , retries: 2 },
  // 学习重排默认关，且开着跑全量会挂住（2026-11-19 记的 P204）。
  // 不再挂进日常自检：日常自检要的是"每次十分钟内跑完"，它现在跑不完。
  // 要试的时候单独跑：node scripts/test-rerank.mjs
  // { name: '学习重排', script: 'test-rerank.mjs', args: [] },
  { name: '反馈回流', script: 'test-feedback.mjs', args: [] },
  { name: '改口裁决', script: 'test-verdict.mjs', args: [] },
  { name: '索引健康度与界面', script: 'test-vector-health.mjs', args: [] },
  { name: '体检快照与周检', script: 'test-monitor.mjs', args: [] },
  { name: '算力优先级闸', script: 'test-priority.mjs', args: [] },
  { name: '查询合并', script: 'test-qbatch.mjs', args: [] },
  { name: '备份带向量与账本', script: 'test-backup-vectors.mjs', args: [] },
  { name: '二进制块校验和', script: 'test-blob-checksum.mjs', args: [] },
  { name: '低分第二道闸', script: 'test-rerank-gate.mjs', args: [] },
  { name: '索引落盘与增量', script: 'test-ann-disk.mjs', args: [] },
  { name: '写入查重', script: 'test-dup.mjs', args: [] },
  { name: '跨海检索', script: 'test-crosssea.mjs', args: [] },
  { name: '换模型双写', script: 'test-dualwrite.mjs', args: [] },
  { name: '按需读向量', script: 'test-ondemand.mjs', args: [] },
  { name: '多进程写库', script: 'test-mutate.mjs', args: [] },

  // 版本号一套收口：老海能读、写入归一、太新拒读
  { name: '版本号一套收口', script: 'versioning-test.mjs', args: [] },

  // 拼音双通道：错别字、纯首字母、倒装 bigram 都捞得回，不搭的给 0
  { name: '拼音双通道', script: 'pinyin-test.mjs', args: [] },

  // 实体归一：完全相等和人工别名表才并，相似不等绝不并
  { name: '实体归一', script: 'entity-alias-test.mjs', args: [] },

  // 压缩感知：规矩栏在不在、条数缩没缩，都能当场查出来
  { name: '压缩感知断言', script: 'compaction-test.mjs', args: [] },

  // 幽灵拒答：开关有效、默认不响
  { name: '幽灵拒答开关', script: 'ghost-test.mjs', args: [], needs: 'main' },
  // 拒答四道闸：各拦一类、真问题不误拒、总开关关掉全放行（2026-11-19）
  { name: '拒答四道闸', script: 'refusal-gates-test.mjs', args: [], needs: 'main' },
  // 别名的四道闸：空着和坏了看起来一样，得拿假日志正反各验一次。
  { name: '别名四道闸（正反）', script: 'alias-gate-test.mjs', args: [] },
  // 空白机器第一次用：目录都没有的时候，能不能自己长出来
  { name: '空白机器首次运行', script: 'fresh-home-test.mjs', args: [] },
  // 打包完整性：入口引到的东西，files 白名单里有没有。漏了的话别人装上就缺件。
  { name: '打包完整（别人装得上）', script: 'pack-graph-test.mjs', args: [] },
  // 空库：新装的人第一分钟就是空库，检索得能正常说"没有"，别炸也别落盘
  { name: '空库不炸（新人第一分钟）', script: 'empty-sea-smoke.mjs', args: [] },
  // 十三个海都得读得出来：2026-11-14 查出「演示」只有目录没有 data.json，页面上是个空壳。
  { name: '全部识海能读', script: 'seas-check.mjs', args: [] },
]

// 文档结构（可选）：只在本机存在那份 docx 时跑。用 Python 做，因为 docx 包在 Python 那边。
const DOC = join(homedir(), "Desktop", "识海_项目说明材料.docx")

const results = []
const skipped = []
for (const s of suites) {
  // 有 needs 的套件要先有对应的海；没有就跳过（记一笔"跳过"，不算失败）
  if (s.needs && !HAS[s.needs]) {
    skipped.push(`${s.name}（缺 ${s.needs} 海）`)
    console.log(`跳过  ${s.name}  —— 这台机器还没有 ${s.needs} 海`)
    continue
  }
  const f = join(HERE, s.script)
  if (!existsSync(f)) {
    results.push({ name: s.name, ok: false, note: '脚本不存在' })
    continue
  }
  // 2026-11-20：个别测试是概率性的（粗筛抽查），单跑偶发红、连跑十遍全绿。
  // 给这类条目加了重试：第一次红就再跑一遍，仍红才算真红。
  // 2026-11-21：一批测试是按「当前目录」拼路径去找模块的（脚本里有九十多处这么写）。
  // 从别处叫自检，它们集体找不着家、集体红。这里统一把子进程的工作目录钉在包根——
  // 一条改动护住那一整批，不用挨个去改测试。
  const RUN_CWD = join(HERE, '..')
  let r = spawnSync(NODE, [f, ...s.args], { encoding: 'utf8', timeout: 600000, cwd: RUN_CWD })
  for (let _try = 1; _try < (s.retries || 1) && r.status !== 0; _try++) {
    r = spawnSync(NODE, [f, ...s.args], { encoding: 'utf8', timeout: 600000, cwd: RUN_CWD })
  }
  const out = String(r.stdout || '') + String(r.stderr || '')
  const tail = out.trim().split(/\n/).slice(-1)[0] || ''
  const ok = r.status === 0
  results.push({ name: s.name, ok, note: tail.slice(0, 60) })
  console.log(`${ok ? '通过' : '失败'}  ${s.name}  ${tail.slice(0, 60)}`)
}

if (existsSync(DOC)) {
  // 2026-11-21：这里原来写死了本机那个 python.exe 的绝对路径。换台机器上，文档结构这一组就永远红，
  // 而且看不出是「没装 Python」还是「文档真坏了」。改成：先认环境变量，再认这台机器默认位置；
  // 都找不到就明说跳过——跳过要写清原因，不算通过，也不算坏。
  const py = process.env.DSH_PYTHON
    || "C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe"
  if (!existsSync(py)) {
    skipped.push('文档结构（没找到 Python，可设 DSH_PYTHON 指定）')
    console.log('跳过  文档结构  —— 没找到 Python，可设 DSH_PYTHON 指定一个')
  } else {
    const r = spawnSync(py, [join(HERE, "doc_check.py"), DOC], { encoding: "utf8", timeout: 300000 })
    const out = String(r.stdout || "") + String(r.stderr || "")
    const tail = out.trim().split(/\n/).slice(-1)[0] || ""
    const good = r.status === 0
    results.push({ name: "文档结构", ok: good, note: tail.slice(0, 60) })
    console.log(`${good ? "通过" : "失败"}  文档结构  ${tail.slice(0, 60)}`)
  }
}

const bad = results.filter((r) => !r.ok)
console.log('')
console.log(`共 ${results.length} 组 · 通过 ${results.length - bad.length} · 失败 ${bad.length}` + (skipped.length ? ` · 跳过 ${skipped.length}` : ''))
if (skipped.length) console.log('跳过的是：' + skipped.join('、'))
if (bad.length) {
  console.log('失败的有：')
  for (const b of bad) console.log('  · ' + b.name + ' → ' + b.note)
}
process.exit(bad.length ? 1 : 0)
