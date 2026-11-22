/**
 * 拒答口径
 * ========
 *
 * 同一个意思，全库只能有一种说法——不然同一个问题在四条路上会得到四种口气，
 * 听着像四个人。
 *
 * 三类：
 *   notRecorded  库里确实没有（没记过）
 *   weakScore    分低、不敢硬编（没记住）
 *   windowEmpty  那段时间没记（时间窗内空）
 *
 * 每句都只跟一句「下一步怎么问」，不许追问、不许甩锅。
 */

export function notRecorded(query) {
  // 2026-11-20：空问句会拼出一个空引号（「」），像话没说完。空的时候用「这件事」兜住。
  const q = String(query || '').trim() || '这件事'
  return '你说的「' + q + '」，我这儿没记过。\n（不是想不起来——是确实没写过。换个叫法，或者告诉我大概哪阵子。）'
}

export function weakScore(query) {
  return '没记住「' + String(query || '').trim() + '」这件事。\n（分不够，我不硬编。换个说法，或者给我一块时间我也行。）'
}

export function windowEmpty(label) {
  return String(label || '那段时间') + '，我这边什么都没记。\n（不是忘了，是那会儿真没记过。）'
}

/**
 * 有这事、没这细节（2026-11-21）
 * ========================
 * 灰区那道缝：库里明明记着这个人/这件事，但问的那个细节没写过。
 * 这时候说「没记过」是撒谎——不是没这事，是没记到这么细。
 * 只说沾边的那条标题，不替它编内容。
 */
export function knownNoDetail(query, near) {
  const q = String(query || '').trim() || '这件事'
  // 2026-11-21：他把话点破了——「从档案里翻出来的、不确定哪句是原话」这种说法一出口，
  // 用的人那点沉浸感就没了。改成人在回忆里的说法：有印象、记糊了、记不清。
  const p = near && typeof near === 'object' ? near : null
  const t = String(p ? (p.title || '') : (near || '')).trim()
  const unit = (String(query || '').match(/(播放|点赞|评论|转发|公里|米|块|元|斤|条|个|次|万|千)/) || [])[1]
  const qchk = String(query || '').replace(/[\s，。？！、的了吗呢是我他你]/g, '')
  let titleHit = false
  if (p) {
    const tt = String(p.title || '')
    for (let i = 0; i + 3 <= qchk.length; i++) { if (tt.includes(qchk.slice(i, i + 3))) { titleHit = true; break } }
  }
  let quote = ''
  if (p && unit && titleHit) {
    const segs = String(p.text || '').split(/[。；\n]/)
    const hit = segs.find((x) => x.includes(unit) && /\d/.test(x))
    if (hit) quote = hit.trim().slice(0, 80)
  }
  if (quote) {
    return '记着这么回事——《' + t + '》：' + quote + '。\n（要是数不对，你纠我一句，我改。）'
  }
  const head = t ? '你说这事我有印象——《' + t + '》——可具体那个细节，我记糊了。' : '你说这事我有点印象——可具体那个细节，我记糊了。'
  return head + '\n（事是有的，细节记不清了。你给个大概时候，或者说一句当时在哪儿，我好对上。）'
}
