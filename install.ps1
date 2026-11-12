# 识海 · 一键安装（Windows）
# 双击运行即可；也可以让 DSH 里的 AI 执行这个文件。
# 做完之后需要手动重启一次 DSH。

$ErrorActionPreference = 'Stop'

$plugin  = $PSScriptRoot
$home    = $env:USERPROFILE
$profile = Join-Path $home '.dsh\profiles\desktop'
$pkgPath = Join-Path $profile 'package.json'

Write-Host ''
Write-Host '识海 · 安装' -ForegroundColor Cyan
Write-Host "插件目录：$plugin"

if (-not (Test-Path $pkgPath)) {
  Write-Host "找不到 $pkgPath —— 这台机器上 DSH 的 desktop profile 不在默认位置。" -ForegroundColor Red
  exit 1
}

# ---------- 0. 先看 Python（没有的话提前说，别等按了才报错） ----------
$pyPath = 'C:\AI-DDSP\env310\Scripts\python.exe'
if (-not (Test-Path $pyPath)) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $pyPath = $cmd.Source } else { $pyPath = $null }
}
if ($pyPath) {
  Write-Host "Python：$pyPath" -ForegroundColor Green
} else {
  Write-Host '警告：没找到 Python。' -ForegroundColor Yellow
  Write-Host '      插件照样能装，页面也能看，但写不了记忆（按写入会报错）。' -ForegroundColor Yellow
  Write-Host '      想正常用，先装 Python 3.9+，再跑一次这个脚本。' -ForegroundColor Yellow
}

# ---------- 1. 改 package.json ----------
Write-Host ''
Write-Host '[1/2] 写入 profile 配置…'

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if (-not $pkg.dependencies) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$pkg.dependencies | Add-Member -NotePropertyName 'dsh-consciousness' -NotePropertyValue "link:$plugin" -Force

if (-not $pkg.dsh) {
  Write-Host '这个 profile 没有 dsh.profile 配置，不像是标准安装。' -ForegroundColor Red
  exit 1
}
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-consciousness') {
  $pkg.dsh.profile.bundles = @($bundles + 'dsh-consciousness')
}

$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding utf8
Write-Host '      已写入。'

# ---------- 2. pnpm install ----------
Write-Host '[2/2] 安装依赖…'

$runtimes = Join-Path $home '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
$node = Join-Path $runtimes 'node\bin\node.exe'
$pnpm = Join-Path $runtimes 'pnpm\bin\pnpm.mjs'

if (-not (Test-Path $node) -or -not (Test-Path $pnpm)) {
  Write-Host "找不到 DSH 自带的 node/pnpm：$runtimes" -ForegroundColor Red
  Write-Host '你可以自己跑一次：pnpm install（工作目录必须是 profile 目录）' -ForegroundColor Yellow
} else {
  Push-Location $profile
  try {
    & $node $pnpm install --reporter=append-only
  } finally {
    Pop-Location
  }
}

Write-Host ''
Write-Host '装好了。现在重启 DSH，左侧会多一个「识」字。' -ForegroundColor Green
Write-Host ''
