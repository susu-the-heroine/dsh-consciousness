# 识海 · 一键安装（Windows）
# 双击运行即可；也可以让 DSH 里的 AI 执行这个文件。
# 做完之后需要手动重启一次 DSH。

$ErrorActionPreference = 'Stop'

$plugin  = $PSScriptRoot
$home    = $env:USERPROFILE
$profile = Join-Path $home '.dsh\profiles\desktop'
$pkgPath = Join-Path $profile 'package.json'

# 插件名从 package.json 里读，别写死——包名从 dsh-consciousness 改成 dsh-consciousness2 那次，
# 写死的名字会让装完的 profile 指向一个不存在的依赖，重启也不出现图标。2026-11-15 修。
$pluginName = (Get-Content (Join-Path $plugin 'package.json') -Raw | ConvertFrom-Json).name
if (-not $pluginName) { Write-Host '读不出插件名（package.json 坏了？）' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '识海 · 安装' -ForegroundColor Cyan
Write-Host "插件目录：$plugin"

if (-not (Test-Path $pkgPath)) {
  Write-Host "找不到 $pkgPath —— 这台机器上 DSH 的 desktop profile 不在默认位置。" -ForegroundColor Red
  exit 1
}

# ---------- 0. 不需要 Python ----------
# 0.4 版起，拆文件、算权重、搬向量、写库全在 Node 里做；装完就能写记忆。
# 只有一种情况要 Python：把 0.3 时代的老库（add_memory.py）迁过来。没有也不影响安装。
$pyPath = 'C:\AI-DDSP\env310\Scripts\python.exe'
if (-not (Test-Path $pyPath)) {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { $pyPath = $cmd.Source } else { $pyPath = $null }
}
if ($pyPath) {
  Write-Host "Python（可选，只给迁旧库用）：$pyPath" -ForegroundColor DarkGray
} else {
  Write-Host '没装 Python —— 没事，写记忆用不上它。' -ForegroundColor DarkGray
}

# ---------- 1. 改 package.json ----------
Write-Host ''
Write-Host '[1/2] 写入 profile 配置…'

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if (-not $pkg.dependencies) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$pkg.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue "link:$plugin" -Force

if (-not $pkg.dsh) {
  Write-Host '这个 profile 没有 dsh.profile 配置，不像是标准安装。' -ForegroundColor Red
  exit 1
}
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains $pluginName) {
  $pkg.dsh.profile.bundles = @($bundles + $pluginName)
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
Write-Host "装好了（$pluginName）。现在重启 DSH，左侧会多一个「识」字。" -ForegroundColor Green
Write-Host ''
