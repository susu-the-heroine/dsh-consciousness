/**
 * dsh-sea-skin —— 客户端半边
 *
 * 三件事，全在页面里做：
 *   ① 铺一层视频当背景（压在最底下，不挡任何交互）
 *   ② 左下角放一只会动的大肥鱼（雪碧图逐帧播）
 *   ③ 把界面的底色弄成半透明，让视频透上来
 *
 * 不碰对话流、不碰任何插件的数据。坏了只会看不见背景，不会连累 DSH。
 */
window.__ModuleLoader__.load({
  id: 'consciousness-sea-skin',
  factory: (require) => {
    const PREFIX = '/consciousness/skin'

    function install() {
      try {
        if (document.getElementById('sea-skin-style')) return
        if (!document.body) return

        // ---- 样式 ----
        const style = document.createElement('style')
        style.id = 'sea-skin-style'
        style.textContent = `
/* 视频背景：压在最底下，谁也别想点它 */
#sea-bg-wrap{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;background:#05070b}
#sea-bg-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.9}

/* 立绘：8 列 × 10 行的雪碧图，只播第一行的 8 帧（在打字） */
#sea-char{
  position:fixed;left:18px;bottom:14px;width:168px;height:168px;z-index:1;
  pointer-events:none;user-select:none;
  background-image:url("${PREFIX}/sprite.webp");
  background-repeat:no-repeat;
  background-size:800% 1000%;
  background-position-y:0%;
  animation:sea-char-run 1.15s steps(8) infinite;
  filter:drop-shadow(0 6px 18px rgba(0,0,0,.55));
  opacity:.95;
}
@keyframes sea-char-run{
  from{background-position-x:0%}
  to{background-position-x:100%}
}

/* 界面半透明：只动底色，不动布局 */
#root{background-color:transparent !important;background-image:none !important}
`
        document.head.appendChild(style)

        // ---- 视频 ----
        const wrap = document.createElement('div')
        wrap.id = 'sea-bg-wrap'
        const video = document.createElement('video')
        video.id = 'sea-bg-video'
        video.src = PREFIX + '/background.mp4'
        video.muted = true
        video.defaultMuted = true
        video.loop = true
        video.playsInline = true
        video.autoplay = true
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        video.setAttribute('aria-hidden', 'true')
        wrap.appendChild(video)
        document.body.insertBefore(wrap, document.body.firstChild)
        // 自动播放被拒时，等第一次点击再放
        const tryPlay = () => {
          const p = video.play()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        }
        tryPlay()
        document.addEventListener('pointerdown', tryPlay, { once: true })

        // ---- 立绘 ----
        const char = document.createElement('div')
        char.id = 'sea-char'
        char.setAttribute('aria-hidden', 'true')
        document.body.appendChild(char)
      } catch {
        /* 皮肤出问题就当没装，绝不连累 DSH */
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install, { once: true })
    } else {
      install()
    }

    return {}
  },
})
