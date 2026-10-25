@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist dist\catalog\index.json (
  echo 没有找到 dist\catalog\index.json，请先运行: node build-repo.mjs
  pause
  exit /b 1
)
echo CC 工具箱插件仓库: http://127.0.0.1:5210/catalog/index.json
echo 保持此窗口打开，DBX 安装/更新插件时需要访问该地址。按 Ctrl+C 停止。
node serve.cjs 5210
