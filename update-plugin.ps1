param(
  [string]$Version = "",
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$pagesBase = 'https://fangmingzhao69-glitch.github.io/dbx-cc-toolbox'
$repoSlug = 'https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox.git'
$repoWeb = 'https://github.com/fangmingzhao69-glitch/dbx-cc-toolbox'
$ghExe = Join-Path $env:LOCALAPPDATA 'Programs\gh-cli\bin\gh.exe'

if (-not (Get-Command gh -ErrorAction SilentlyContinue) -and (Test-Path $ghExe)) {
  $env:Path = (Split-Path $ghExe) + ';' + $env:Path
}
if (Get-Command gh -ErrorAction SilentlyContinue) {
  try { gh auth setup-git 2>$null | Out-Null } catch { }
}

$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$oldVersion = $manifest.version
if (-not $Version) {
  $parts = $oldVersion.Split('.')
  if ($parts.Length -lt 3) { throw "manifest.version 不是语义化版本: $oldVersion" }
  $parts[2] = [string]([int]$parts[2] + 1)
  $Version = ($parts -join '.')
}
$hasBackend = $null -ne $manifest.entrypoints.backend
$target = if ($hasBackend) { 'windows-x64' } else { 'universal' }
$releaseTag = "repo-v$Version"
$releaseBase = "$repoWeb/releases/download/$releaseTag"

Write-Host "版本: $oldVersion -> $Version（目标: $target）" -ForegroundColor Cyan
if ($DryRun) {
  Write-Host 'DryRun：只显示步骤。'
  exit 0
}

$manifest.version = $Version
[System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 30) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
Write-Host '[1/6] manifest 版本已更新'

if ($hasBackend) {
  Write-Host '[2/6] 编译发票打印原生侧车…' -ForegroundColor Cyan
  $binDir = Join-Path $root 'bin\win-x64'
  if (Test-Path $binDir) { Remove-Item $binDir -Recurse -Force }
  New-Item -ItemType Directory -Force $binDir | Out-Null
  dotnet publish (Join-Path $root 'sidecar\InvoiceSidecarNoWf') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:Version=$Version -o $binDir 2>&1 | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { throw '侧车编译失败' }
} else {
  Write-Host '[2/6] 跳过侧车编译（纯前端插件）'
}

Write-Host '[3/6] 打包插件…' -ForegroundColor Cyan
if ($hasBackend) {
  if (-not (Test-Path (Join-Path $root "bin\win-x64\cc-invoice-sidecar.exe"))) { throw '侧车可执行文件不存在' }
  Write-Host '  原生插件：跳过 dbx-plugin package（由 repo/build-repo.mjs 直接打包签名）'
} else {
  if (Get-Command dbx-plugin -ErrorAction SilentlyContinue) { dbx-plugin package . }
  else { npx --yes @dbx-app/plugin-cli@0.1.9 package . }
  if ($LASTEXITCODE -ne 0) { throw 'dbx-plugin package 失败' }
}

Write-Host '[4/6] 签名并生成 catalog…' -ForegroundColor Cyan
Push-Location (Join-Path $root 'repo')
try { node build-repo.mjs --base-url $pagesBase --release-url-base $releaseBase } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'build-repo.mjs 失败' }

$signed = Get-ChildItem (Join-Path $root "repo\dist\plugins\$($manifest.id)\$Version") -Filter '*.signed.dbxp' | Select-Object -First 1
if (-not $signed) { throw '没有找到签名包' }

Write-Host '[5/6] 上传签名包到 GitHub Release…' -ForegroundColor Cyan
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh release view $releaseTag 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    gh release create $releaseTag --title "插件仓库 v$Version" --notes "CC 工具箱自托管插件仓库签名产物 v$Version（$target）"
  }
  gh release upload $releaseTag $signed.FullName --clobber
  if ($LASTEXITCODE -ne 0) { throw '上传 Release 失败' }
} else {
  Write-Warning '未找到 gh，跳过 Release 上传（catalog 里的地址会不可用）'
}

Write-Host '[6/6] 发布 catalog 到 GitHub Pages 并提交 main…' -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP ('cc-pages-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Copy-Item (Join-Path $root 'repo\dist\catalog') (Join-Path $tmp 'catalog') -Recurse -Force
  New-Item -ItemType Directory -Force (Join-Path $tmp "plugins\$($manifest.id)\$Version") | Out-Null
  Copy-Item (Join-Path $root "repo\dist\plugins\$($manifest.id)\$Version\plugin.svg") (Join-Path $tmp "plugins\$($manifest.id)\$Version\plugin.svg") -Force
  Copy-Item (Join-Path $root 'repo\dist\repo-info.json') (Join-Path $tmp 'repo-info.json') -Force
  Set-Content (Join-Path $tmp '.nojekyll') '' -Encoding ascii
  Push-Location $tmp
  try {
    git init -b gh-pages | Out-Null
    git config user.name 'seren z'
    git config user.email 'fangmingzhao69@gmail.com'
    git add -A | Out-Null
    git commit -m "Publish plugin catalog v$Version" | Out-Null
    git remote add origin $repoSlug
    git push -f origin gh-pages
    if ($LASTEXITCODE -ne 0) { throw '推送 gh-pages 失败' }
  } finally { Pop-Location }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

git add manifest.json dbx-plugin.toml .gitignore sidecar repo update-plugin.ps1
git commit -m "chore: 发布 v$Version（侧车打包）" 2>&1 | Out-Null
git push origin main
if ($LASTEXITCODE -ne 0) { throw '推送 main 失败' }

Write-Host ''
Write-Host "完成：v$Version 已发布（$target）" -ForegroundColor Green
Write-Host "Catalog: $pagesBase/catalog/index.json"
Write-Host "签名包: $releaseBase/$($signed.Name)"
Write-Host '下一步：DBX 插件中心 → 设置 → 插件仓库 → 刷新 → 更新插件。'