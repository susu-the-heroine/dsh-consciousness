/**
 * dsh-consciousness —— 浏览器半端
 *
 * 抄 dsh-bili-pond 的注册方式：client bundle 不是 ESM，是自注册脚本。
 *   window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {...} })
 *
 * 挂三个位置：
 *   1. sidebar.panellist —— 侧边栏那个图标，和「B站鱼塘」并排（order 6）
 *   2. main             —— 点图标切进去的整页（key 必须等于图标 id）
 *   3. settings.section —— 设置页里也留一份，找不到侧边栏时从这儿进
 *
 * ⚠ 不用 hooks：这个面板没有状态，少一层依赖就少一个白屏的理由。
 * ⚠ 每个注册都包 try/catch：挂不上最多少个入口，绝不连累整个界面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-consciousness2',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ID = 'dsh-consciousness2'
    const SRC = '/consciousness'
    const GOLD = '#c8b282'

    function Shell({ height }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            width: '100%',
            height,
            minHeight: 320,
            boxSizing: 'border-box',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--dsw-alias-text-secondary, #7d8ea6)',
              flex: '0 0 auto',
            },
          },
          h('span', null, '拖动旋转 · 滚轮缩放 · 右侧搜索记忆'),
          h(
            'a',
            {
              href: SRC,
              target: '_blank',
              rel: 'noreferrer',
              style: { color: GOLD, textDecoration: 'none', cursor: 'pointer' },
            },
            '新窗口打开 ↗',
          ),
        ),
        h(
          'div',
          {
            style: {
              flex: 1,
              minHeight: 0,
              borderRadius: 12,
              overflow: 'hidden',
              border: '1px solid rgba(120,180,240,.18)',
              background: '#05070b',
            },
          },
          h('iframe', {
            src: SRC,
            title: '识海',
            style: { width: '100%', height: '100%', border: 0, display: 'block' },
          }),
        ),
      )
    }

    /** 设置页里的版本 */
    function SettingsPanel() {
      return h(Shell, { height: 'calc(100vh - 170px)' })
    }

    /** 侧边栏整页版本 */
    function MainPage() {
      return h(Shell, { height: '100%' })
    }

    /** 侧边栏图标：一个金色圆环里一个字，不依赖图片资源 */
    function Icon({ size = 20, active }) {
      const s = Number(size) || 20
      return h(
        'div',
        {
          style: {
            width: s,
            height: s,
            borderRadius: Math.round(s * 0.3),
            border: '1.5px solid ' + GOLD,
            background: 'rgba(200,178,130,.10)',
            color: GOLD,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(10, Math.round(s * 0.52)),
            lineHeight: 1,
            fontFamily: '"Noto Serif SC","SimSun",serif',
            opacity: active ? 1 : 0.78,
            boxSizing: 'border-box',
          },
        },
        '识',
      )
    }

    function safe(label, fn) {
      try {
        fn()
      } catch (error) {
        console.warn('[dsh-consciousness] ' + label + ' 注册失败', error)
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) {
          console.warn('[dsh-consciousness] 拿不到 slots，入口没挂上')
          return
        }

        safe('sidebar.panellist', () =>
          slots.inject('sidebar.panellist', () =>
            slots.register({ name: 'sidebar.panellist', id: ID, order: 6, label: '识海' }, () =>
              h(Icon),
            ),
          ),
        )

        safe('main', () =>
          slots.inject('main', () =>
            slots.register({ name: 'main', key: ID }, () => h(MainPage)),
          ),
        )

        safe('settings.section', () =>
          slots.inject('settings.section', () =>
            slots.register(
              { name: 'settings.section', id: ID, order: 41, label: '识海' },
              () => h(SettingsPanel),
            ),
          ),
        )
      },
    }
  },
})
