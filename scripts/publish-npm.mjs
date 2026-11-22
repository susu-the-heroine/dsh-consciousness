/**
 * 直接把 tgz 发到 npm（这台机没有 npm 命令，只能走 HTTP）
 * ==================================================
 *
 *   node scripts/publish-npm.mjs <tgz 路径> [--dry]
 *
 * 凭据从 ~/.npmrc 的 _authToken 读，不打印。
 */
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const tgz = args.find((a) => a && !a.startsWith('--'))
const dry = args.includes('--dry')
if (!tgz) {
  console.log('用法：node scripts/publish-npm.mjs <tgz 路径> [--dry]')
  process.exit(1)
}

const root = join(process.cwd())
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.name
const version = pkg.version

let token = ''
try {
  const npmrc = readFileSync(join(homedir(), '.npmrc'), 'utf8')
  const m = npmrc.match(/_authToken\s*=\s*(\S+)/)
  token = m ? m[1].trim() : ''
} catch {}
if (!token) {
  console.log('没有凭据：~/.npmrc 里找不到 _authToken')
  process.exit(1)
}

// 2026-11-21：原来拿到哪只包就发哪只，版本号却读当前清单——一只旧包能被当成新版发出去。
// 发之前先把包里那份清单掏出来对一遍，名字或版本对不上就不发。
{
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8', timeout: 120000 })
  if (r.status !== 0) {
    console.log('读不了这只包的清单，不发：' + String(r.stderr || '').slice(0, 120))
    process.exit(1)
  }
  let inner = null
  try { inner = JSON.parse(String(r.stdout || '')) } catch {}
  if (!inner || !inner.name || !inner.version) {
    console.log('包里那份清单读不出来，不发。')
    process.exit(1)
  }
  if (inner.name !== name || inner.version !== version) {
    console.log(`对不上，不发：包是 ${inner.name}@${inner.version}，当前清单是 ${name}@${version}`)
    process.exit(1)
  }
  console.log(`包里清单：${inner.name}@${inner.version}（与当前一致）`)
}

const buf = readFileSync(tgz)
const shasum = createHash('sha1').update(buf).digest('hex')
const integrity = 'sha512-' + createHash('sha512').update(buf).digest('base64')

const body = {
  _id: name,
  name,
  description: pkg.description || '',
  'dist-tags': { latest: version },
  versions: {
    [version]: {
      name,
      version,
      description: pkg.description || '',
      main: pkg.main || 'index.js',
      license: pkg.license || '',
      author: pkg.author || '',
      repository: pkg.repository || undefined,
      homepage: pkg.homepage || undefined,
      keywords: pkg.keywords || undefined,
      engines: pkg.engines || undefined,
      dependencies: pkg.dependencies || {},
      peerDependencies: pkg.peerDependencies || undefined,
      dist: {
        shasum,
        integrity,
        tarball: 'https://registry.npmjs.org/' + name + '/-/' + basename(tgz).replace(/^.*?-(\d+\.\d+\.\d+.*\.tgz)$/, name + '-' + version + '.tgz'),
      },
    },
  },
  _attachments: {
    [name + '-' + version + '.tgz']: {
      content_type: 'application/octet-stream',
      data: buf.toString('base64'),
      length: buf.length,
    },
  },
}

// tarball 地址按 npm 的规则拼，别依赖文件名
body.versions[version].dist.tarball =
  'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz'

console.log(`要发：${name}@${version} · ${(buf.length / 1048576).toFixed(1)} MB · shasum ${shasum.slice(0, 12)}`)
if (dry) {
  console.log('（只演一遍，不发）')
  process.exit(0)
}

const url = 'https://registry.npmjs.org/' + encodeURIComponent(name).replace('%40', '@')
const res = await fetch(url, {
  method: 'PUT',
  headers: {
    authorization: 'Bearer ' + token,
    'content-type': 'application/json',
    accept: 'application/json',
  },
  body: JSON.stringify(body),
})
const text = await res.text()
console.log('HTTP ' + res.status)
console.log(text.slice(0, 600))
if (res.ok) console.log('发出去了：' + name + '@' + version)
else process.exit(2)
