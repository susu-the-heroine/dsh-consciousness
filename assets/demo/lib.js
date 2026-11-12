/* 和识海完全同一套神经元绘制代码，从 意识海.html 原样搬出来的。
 * 演示页引用这个文件，画出来和识海一模一样。 */
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

function vectorize(color, size, seed, kind){
  const rnd=mulberry(seed);
  const buckets={};
  const boutons=[];
  const push=(w,draw)=>{
    const key=Math.round(w*100)/100;
    if(!buckets[key]) buckets[key]={w:key, path:new Path2D()};
    draw(buckets[key].path);
  };
  const spines=new Path2D();

  let apical=1, basalN=3, spread=0.9, lenK=1.0, spineK=1.0, taper=0.55;
  if(kind==='fact'){ apical=1; basalN=3; spread=0.62; lenK=1.15; spineK=1.0; }
  else if(kind==='feeling'){ apical=0; basalN=6; spread=1.35; lenK=0.78; spineK=1.4; }
  else if(kind==='taboo'){ apical=2; basalN=5; spread=1.15; lenK=1.0; spineK=1.8; taper=0.62; }

  function br(x,y,ang,len,w,depth){
    if(depth<=0 || len<size*0.12) return;
    const a = ang + (rnd()-0.5)*0.34;
    const cx = x + Math.cos(a-0.22)*len*0.5;
    const cy = y + Math.sin(a-0.22)*len*0.5;
    const ex = x + Math.cos(a)*len;
    const ey = y + Math.sin(a)*len;
    push(w, p=>{ p.moveTo(x,y); p.quadraticCurveTo(cx,cy,ex,ey); });

    if(depth<=3){
      const sn = Math.max(1, Math.round(2*spineK*rnd()));
      for(let s=0;s<sn;s++){
        const tt=0.25+rnd()*0.7;
        const sx=x+(ex-x)*tt, sy=y+(ey-y)*tt;
        const sa=a+(rnd()<.5?1.5:-1.5)+(rnd()-.5)*.4;
        spines.moveTo(sx,sy);
        spines.lineTo(sx+Math.cos(sa)*size*0.16*(0.6+rnd()), sy+Math.sin(sa)*size*0.16*(0.6+rnd()));
      }
    }
    if(depth===1) boutons.push([ex, ey, Math.max(0.27, w*1.5)]);

    const kids = depth>=4 ? (rnd()<0.7?1:2) : (rnd()<0.42?1:2);
    for(let i=0;i<kids;i++){
      br(ex,ey, a+(rnd()-0.5)*spread, len*(0.70+rnd()*0.12), w*(1-taper*0.42), depth-1);
    }
  }

  if(apical>0){
    const base=(rnd()*Math.PI*2);
    for(let i=0;i<apical;i++){
      const a=base + i*2.1 + (rnd()-.5)*.4;
      br(Math.cos(a)*size*0.4, Math.sin(a)*size*0.4, a,
         size*(2.4+rnd()*1.4)*lenK, Math.max(0.62,size*0.042), 6);
    }
  }
  for(let i=0;i<basalN;i++){
    const a = (Math.PI*2/basalN)*i + (rnd()-0.5)*0.7 + (apical?2.2:0);
    br(0,0, a, size*(1.05+rnd()*0.8)*lenK, Math.max(0.44,size*0.030), 4);
  }
  br(Math.cos(1.2)*size*0.3, Math.sin(1.2)*size*0.3, 1.2+(rnd()-.5)*.6,
     size*(3.4+rnd()*2.0), Math.max(0.40,size*0.026), 3);

  return {buckets:Object.values(buckets), spines, boutons,
          soma:Math.max(1.25,size*0.40), color, size};
}

const SEA_COLOR={event:'#a9c6ff', feeling:'#d98aa6', fact:'#79c7c0',
  plan:'#ffab3f', conclusion:'#a97cff', taboo:'#e0a45a'};

/* 画一颗。opt: {st 强度 0~1, alpha, aura 光晕色, gold 金圈, dead} */
function drawNeuron(ctx, x, y, k, v, opt){
  opt = opt || {};
  const st = opt.st===undefined ? 1 : opt.st;
  const alpha = opt.alpha===undefined ? 1 : opt.alpha;
  const aura = opt.aura || v.color;

  ctx.save();
  ctx.translate(x,y);
  ctx.scale(k,k);
  ctx.globalAlpha = alpha;

  // 光晕
  const g = v.size*2.4*Math.max(0.12, st)*(opt.glow||1);
  const ggKey = aura+'|'+Math.round(g*2);
  if(!v._gg || v._gg.key!==ggKey){
    const gg=ctx.createRadialGradient(0,0,0,0,0,g);
    gg.addColorStop(0,aura+'7a'); gg.addColorStop(.3,aura+'2e');
    gg.addColorStop(.7,aura+'08'); gg.addColorStop(1,aura+'00');
    v._gg={key:ggKey, g:gg};
  }
  ctx.fillStyle=v._gg.g; ctx.beginPath(); ctx.arc(0,0,g,0,7); ctx.fill();

  // 树突
  const faint = st < 0.4;
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(!faint){
    for(const b of v.buckets){
      const lw = Math.max(b.w, 0.55/Math.max(k,0.0001));
      ctx.lineWidth = lw*2.6;
      ctx.strokeStyle = v.color + '14';
      ctx.stroke(b.path);
      ctx.lineWidth = lw;
      ctx.strokeStyle = v.color + (b.w>v.size*0.035?'9c':(b.w>v.size*0.030?'78':'52'));
      ctx.stroke(b.path);
    }
    ctx.lineWidth=Math.max(0.22,0.42/Math.max(k,0.0001));
    ctx.strokeStyle=v.color+'30';
    ctx.stroke(v.spines);
    if(v.boutons && v.boutons.length){
      ctx.fillStyle=v.color+'9a';
      for(const b of v.boutons){
        ctx.beginPath(); ctx.arc(b[0],b[1],Math.max(0.5,b[2]),0,7); ctx.fill();
      }
    }
  }

  // 胞体
  const sr=v.soma*(0.62+0.38*st);
  const srKey=Math.round(sr*10);
  if(!v._sg || v._sg.key!==srKey){
    const sg=ctx.createRadialGradient(0,0,0,0,0,sr*1.55);
    sg.addColorStop(0,'#ffffff'); sg.addColorStop(.45,v.color); sg.addColorStop(1,v.color+'00');
    v._sg={key:srKey, g:sg};
  }
  ctx.fillStyle=v._sg.g; ctx.beginPath(); ctx.arc(0,0,sr*1.55,0,7); ctx.fill();
  ctx.fillStyle='#fbffff'; ctx.beginPath(); ctx.arc(0,0,sr*0.45,0,7); ctx.fill();

  if(opt.dead){
    ctx.strokeStyle='rgba(150,160,175,.35)';
    ctx.lineWidth=0.8/Math.max(k,0.0001);
    ctx.beginPath(); ctx.arc(0,0,sr*2.1,0,7); ctx.stroke();
  }

  if(opt.gold){
    const ts=performance.now()/1000;
    const breath=0.5+0.5*Math.sin(ts*1.7);
    ctx.beginPath(); ctx.arc(0,0,v.soma*(2.35+0.30*breath),0,7);
    ctx.strokeStyle='rgba(216,190,134,'+(0.40+0.34*breath).toFixed(3)+')';
    ctx.lineWidth=1.5/Math.max(k,0.0001); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,v.soma*(3.4+0.6*breath),0,7);
    ctx.strokeStyle='rgba(216,190,134,'+(0.12+0.12*breath).toFixed(3)+')';
    ctx.lineWidth=1/Math.max(k,0.0001); ctx.stroke();
  }

  ctx.restore();
}
