/* ===== 内观浮层 · 逻辑 ===== */
(function(){
  var DIMS = ['calm','lonely','wistful','flutter','unreconciled','weary','dazed','tender'];
  var LABEL = {calm:'安宁',lonely:'寥寂',wistful:'怅然',flutter:'悸动',
    unreconciled:'不甘',weary:'倦怠',dazed:'惘然',tender:'恻隐'};
  var WARM = {calm:1, flutter:1};
  var KIND = {promise:'欠着的', question:'没答完', thought:'想不通'};
  var SAY = {
    low:'关着。她不流动，也不写念头。',
    high:'活着，但不花钱：会随时间和记忆自己动，不调模型。',
    max:'会自己写念头：一天最多三条，超预算自动退回「活着」。'
  };
  var LEVEL = 'low';
  var timer = null;

  function el(id){ return document.getElementById(id) }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c] }) }
  function ago(ts){
    var d = Date.now() - Number(ts||0);
    if (d < 0) return '';
    var m = Math.floor(d/60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m/60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h/24) + ' 天前';
  }

  function drawBars(dims){
    el('ivBars').innerHTML = DIMS.map(function(k){
      var v = Number(dims && dims[k]) || 0;
      var pct = Math.max(1, Math.min(100, Math.round(v*100*3.4)));
      return '<div class="iv-bar' + (WARM[k]?' warm':'') + '">'
        + '<div class="r"><span>' + LABEL[k] + '</span><b>' + Math.round(v*100) + '</b></div>'
        + '<div class="iv-tr"><div class="iv-fi" style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  function drawPre(list){
    var box = el('ivPre');
    if (!list || !list.length){ box.innerHTML = '<div class="iv-empty">没有挂着的事。</div>'; return }
    box.innerHTML = list.map(function(x){
      return '<div class="iv-pre"><div class="k">' + (KIND[x.kind]||'') + '</div>'
        + '<div class="x">' + esc(x.text) + '</div>'
        + '<div class="w">' + Math.round((Number(x.weight)||0)*100) + '</div></div>';
    }).join('');
  }

  function drawFlow(list){
    var box = el('ivFlow');
    if (!list || !list.length){
      box.innerHTML = '<div class="iv-empty">还没有写过念头。<br>把下面档位调到「会写念头」，她才会自己写下第一句。</div>';
      return
    }
    box.innerHTML = list.map(function(x){
      var c = WARM[x.dim] ? '#e0c48a' : '#8fa6c8';
      var kindTxt = x.origin === 'pending' ? '还没说清'
        : (x.origin === 'model' ? '自己想出来的'
        : (x.origin === 'review' ? '回头看的' : '顺带想到的'));
      var meta = [(x.dim?LABEL[x.dim]:''), kindTxt].filter(Boolean).join(' · ');
      if (x.flat) meta += ' · 偏泛';
      return '<div class="iv-th"><div class="w">' + ago(x.born) + '</div>'
        + '<div class="b"><div class="q">' + esc(x.text) + '</div>'
        + '<div class="m"><span class="iv-dot" style="background:' + c + '"></span>' + meta + '</div></div></div>';
    }).join('');
  }

  function drawLine(days){
    var svg = el('ivLine');
    if (!days || days.length < 2){
      svg.innerHTML = '<text x="6" y="40" fill="#3f4b5b" font-size="10">还没攒够两天，画不出走势</text>';
      return
    }
    var score = function(d){
      return (Number(d.avg.calm)||0) + (Number(d.avg.flutter)||0)
        - (Number(d.avg.lonely)||0) - (Number(d.avg.weary)||0);
    };
    var vals = days.map(score);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || 1;
    var n = vals.length;
    var pts = vals.map(function(v,i){
      var x = 6 + i * (588 / Math.max(1, n-1));
      var y = 58 - ((v - min) / span) * 44;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    svg.innerHTML =
      '<defs><linearGradient id="ivg" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="#e0c48a" stop-opacity=".26"/>'
      + '<stop offset="1" stop-color="#e0c48a" stop-opacity="0"/></linearGradient></defs>'
      + '<polyline points="' + pts + ' 594,70 6,70" fill="url(#ivg)" stroke="none"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="#d8bd88" stroke-width="1.4"/>';
  }

  function drawLevel(){
    var seg = el('ivSeg');
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function(b){
        b.classList.toggle('on', b.getAttribute('data-lv') === LEVEL);
      });
    }
    var say = el('ivSay');
    if (say) say.textContent = SAY[LEVEL] || '';
  }

  function tick(){
    fetch('/consciousness/inner-data', {cache:'no-store'})
      .then(function(r){ return r.json() })
      .then(function(j){
        if (!j || !j.ok) return;
        LEVEL = j.level || 'low';
        var t = j.dimText || '平';
        el('ivNow').innerHTML = '挺<em>' + esc(t.replace(/^挺/,'')) + '</em>';
        drawBars(j.dims);
        drawPre(j.preoccupations);
        drawFlow(j.thoughts);
        drawLine(j.moodline);
        el('ivTrend').textContent = j.trend || '';
        el('ivAct').textContent = j.activity || '';
        drawLevel();
      })
      .catch(function(){});
  }

  function open(){
    var v = el('innerView');
    if (!v) return;
    v.classList.add('on');
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 20000);
  }

  function close(){
    var v = el('innerView');
    if (v) v.classList.remove('on');
    if (timer) { clearInterval(timer); timer = null }
  }

  window.__openInner = open;

  function bind(){
    var btn = document.getElementById('btnInner');
    if (btn) {
      btn.removeAttribute('onclick');
      btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); open() });
    }
    var x = document.getElementById('ivClose');
    if (x) x.addEventListener('click', close);
    var seg = document.getElementById('ivSeg');
    if (seg) seg.addEventListener('click', function(ev){
      var b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b) return;
      var lv = b.getAttribute('data-lv');
      LEVEL = lv; drawLevel();
      fetch('/consciousness/inner/mood?level=' + lv, {cache:'no-store'})
        .then(function(){ tick() }).catch(function(){});
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
