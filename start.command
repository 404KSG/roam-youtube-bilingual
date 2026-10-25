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
  echo 'Node.js 22.10 or newer is required.'
  read -r -p 'Press Return to close.' unused_input
  exit 1
fi
if ! command -v cua-driver >/dev/null 2>&1; then
  echo 'An existing CuaDriver installation with Accessibility access is required. No software or permissions will be changed automatically.'
  read -r -p 'Press Return to close.' unused_input
  exit 1
fi
echo 'Bilingual YouTube subtitles. No AI API credentials required.'
echo 'Use the subtitle icon below the video. The read-only helper does not capture screenshots, save notes, or change permissions.'
npm start
