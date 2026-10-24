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
echo '默认使用 YouTube 自带中文翻译，不需要 API Key、模型或配对码。'
echo '本机服务只获取英文原字幕，启动后直接点击视频内“双语”。'
npm start
