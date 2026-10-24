#!/bin/bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$project_dir"
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
if [ ! -f .env ]; then
  (umask 077; cp .env.example .env)
  echo '已创建 .env 空配置。字幕导入和获取可用；翻译前请填写 API 地址、Key、模型并重启。'
fi
npm start
