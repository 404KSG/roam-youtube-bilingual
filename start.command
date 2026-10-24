#!/bin/bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$project_dir"
export PATH="$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/node ]; then
    export PATH="/opt/homebrew/bin:$PATH"
  elif [ -x /usr/local/bin/node ]; then
    export PATH="/usr/local/bin:$PATH"
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo '需要 Node.js 22.10+。请先准备 Node.js，再运行此文件。'
  read -r -p '按回车关闭。' unused_input
  exit 1
fi
if ! command -v cua-driver >/dev/null 2>&1; then
  echo '需要已安装并已授权的 CuaDriver 只读桥；此脚本不会自动安装或申请权限。'
  read -r -p '按回车关闭。' unused_input
  exit 1
fi
echo 'YouTube 自带翻译，英文与译文同框两行；不需要 API。'
echo '请使用视频下方工具栏的双语图标。只读桥不会截图、保存笔记或修改权限。'
npm start
