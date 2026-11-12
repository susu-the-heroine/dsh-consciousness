import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

const file = join(homedir(), '.dsh', 'consciousness-seas', '意识海_触屏版.html')
const html = readFileSync(file, 'utf8')

// 抓最后一个大 <script>（页面主逻辑）
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
console.log('内联脚本块:', scripts.length, '个，长度:', scripts.map((s) => s.length).join(' / '))
const code = scripts.sort((a, b) => b.length - a.length)[0]

// 假 DOM：任何属性都返回一个可调用的假对象，别真抛
const makeFake = () => {
  const fn = function () { return makeFake() }
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0
      if (k === 'toString') return () => ''
      if (k === 'length') return 0
      if (k === 'style' || k === 'dataset' || k === 'classList') return makeFake()
      return makeFake()
    },
    set() { return true },
    apply() { return makeFake() },
    has() { return true },
  })
}

const sandbox = {
  console,
  document: makeFake(),
  window: {},
  navigator: { userAgent: 'node' },
  location: { search: '', href: 'http://x/consciousness', hash: '' },
  URLSearchParams, URL, TextEncoder, TextDecoder, Map, Set, Promise, Math, JSON, Date, Array, Object, Number, String, Boolean, RegExp, Error, Symbol, Intl,
  devicePixelRatio: 1,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame() { return 0 },
  cancelAnimationFrame() {},
  setTimeout() { return 0 },
  clearTimeout() {},
  setInterval() { return 0 },
  clearInterval() {},
  localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
  fetch() { return Promise.resolve({ json: () => Promise.resolve({}), text: () => Promise.resolve('') }) },
  performance: { now: () => 0 },
  Image: function () { return makeFake() },
  Path2D: function () { return makeFake() },
  alert() {},
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox

try {
  vm.runInNewContext(code, sandbox, { filename: 'page.js', timeout: 4000 })
  console.log('脚本跑完了，没抛错（说明错在运行时循环里，或者需要真实 DOM）')
} catch (e) {
  console.log('抛错了:', e.message)
  const st = String(e.stack || '').split('\n').slice(1, 6).join('\n')
  console.log(st)
  const m = String(e.stack || '').match(/page\.js:(\d+):(\d+)/)
  if (m) {
    const line = Number(m[1])
    const lines = code.split('\n')
    for (let i = Math.max(0, line - 4); i < Math.min(lines.length, line + 2); i++) {
      console.log(String(i + 1).padStart(6) + ': ' + lines[i])
    }
  }
}
