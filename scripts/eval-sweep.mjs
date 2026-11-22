import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const V = await import('file:///' + join(HERE,'..','lib','vectors.js').replace(/\\/g,'/') + '?v=' + Date.now())
const E = await import('file:///' + join(HERE,'..','lib','embed-onnx.js').replace(/\\/g,'/') + '?v=' + Date.now())
const HS = JSON.parse(readFileSync(join(HERE,'data','recall-holdout.json'),'utf8')).cases
const PS = JSON.parse(readFileSync(join(HERE,'data','recall-set-v2.json'),'utf8')).cases
const dir = join(homedir(), '.dsh', 'consciousness-seas', 'main')
const data = JSON.parse(readFileSync(join(dir,'data.json'),'utf8'))
const pts = (data.points||[]).filter(p=>!p.dead)
const tk=(s0)=>{const o=new Set();const t=String(s0||'');for(const seg of (t.match(/[\u4e00-\u9fa5]+/g)||[]))for(let i=0;i+2<=seg.length;i++)o.add(seg.slice(i,i+2));for(const w of (t.toLowerCase().match(/[a-z0-9]{2,}/g)||[]))o.add(w);return o}
const txt=(p)=>[p.title,p.text,p.alias].filter(Boolean).join(' ')
const df=new Map(), toks=new Map()
for(const p of pts){const st=tk(txt(p));toks.set(p.id,st);for(const g of st)df.set(g,(df.get(g)||0)+1)}
const rareMax=Math.max(3,Math.round(pts.length*0.05))
const vecs=new Map(); for(const p of pts) vecs.set(p.id, await E.embedLocal(V.embedTextOf(p)))
const TH=0.55
// 2026-11-21：分母全是写死的。实测留出集二十条、里面一条无答案的都没有——
// 那句「误命中过线 0/25」的 25 是编的，这条指标压根没测到东西，却永远显示全对。
// 换说法那份实际九十条，却被印成「四十四/二十」（比一百还多）。分母改成真数，
// 没题可测就直说没测到。
const NEG = HS.filter(c => c.want == null).length
for (const EX of [0.62, 0.68, 0.75]) {
  let h3=0,pos=0,negOver=0
  for (const c of HS) {
    const qv = await E.embedLocal(c.q); const q=tk(c.q)
    const r = pts.map(p=>({id:p.id,s:V.cosine(qv,vecs.get(p.id))})).map(x=>{
      const mt=toks.get(x.id); let hit=false
      for(const g of q) if(mt.has(g)&&(df.get(g)||0)<=rareMax){hit=true;break}
      return {id:x.id, s:(hit||x.s>=EX)?x.s:x.s*0.55}
    }).sort((a,b)=>b.s-a.s)
    if (c.want==null) { if (r[0].s>=TH) negOver++; continue }
    pos++
    const i=r.findIndex(x=>x.id===c.want)
    if(i>=0&&i<3)h3++
  }
  let p3=0
  for (const c of PS) {
    const qv = await E.embedLocal(c.q); const q=tk(c.q)
    const r = pts.map(p=>({id:p.id,s:V.cosine(qv,vecs.get(p.id))})).map(x=>{
      const mt=toks.get(x.id); let hit=false
      for(const g of q) if(mt.has(g)&&(df.get(g)||0)<=rareMax){hit=true;break}
      return {id:x.id, s:(hit||x.s>=EX)?x.s:x.s*0.55}
    }).sort((a,b)=>b.s-a.s)
    const i=r.findIndex(x=>x.id===c.want); if(i>=0&&i<3)p3++
  }
  const negPart = NEG ? ('误命中过线 ' + negOver + '/' + NEG) : '误命中过线：这轮没测到（留出集里没有无答案的题）'
  console.log('豁免线 '+EX+'：留出集前三 '+h3+'/'+pos+'，'+negPart+'，换说法前三 '+p3+'/'+PS.length)
}
