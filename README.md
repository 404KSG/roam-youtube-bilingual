# Roam YouTube 原生双语字幕

> **0.4.0-beta.1 · Draft 测试版，未正式上架。**

默认直接使用 **YouTube 自带的中文自动翻译**，同时在画面内叠加同步的英文原字幕。**不需要 AI API、API Key、模型或配对码。**

中文由 YouTube 原生播放器负责；插件不是把示例译文放上去，也不在视频下方创建字幕面板。

## 使用

1. 首次使用，双击本项目的 **`start.command`**，或在项目目录运行 `npm start`。这个本机服务只获取英文原字幕，不负责翻译。
2. 在 Roam Depot 的 Developer Extensions 中加载或重新加载：

   ```text
   404KSG+roam-youtube-bilingual+1509
   ```

3. 打开视频，点画面右上角小“**双语**”开关。英文取自原字幕，中文由 YouTube 自动翻译显示。

**请保留 YouTube 原生 CC。** 这版由它显示真正的中文，不能按旧版说明把它关掉。插件会请求开启中文；如果某个播放器没有自动切换，在 YouTube 齿轮 → 字幕 → 自动翻译 → 中文（简体）中选择一次。

关闭“**双语**”只收起英文叠层，保留 YouTube 的中文字幕。不修改笔记或图谱块。

[Draft PR #1509](https://github.com/Roam-Research/roam-depot/pull/1509) 保持 Draft；没有合并、正式上架或创建 Release。已经安装同一 shorthand 不必重复添加，重新加载后“⋯”设置顶部应显示 `0.4.0-beta.1`。

## 为什么这样实现

YouTube 一次只能原生显示一条字幕轨道，而 Roam 页面不能跨域读取播放器内部 DOM。

```text
YouTube 播放器：英文轨道 → 自带自动翻译 → 原生中文字幕
        │ 播放时间
        ▼
Roam 插件：英文原字幕 → 同步英文叠层
        ▲
本机只读服务：获取原字幕（不翻译、不用 Key）
```

实测中，外部下载中文自动翻译接口可能返回 429，但同一个视频在 YouTube 原生播放器内可以正常显示中文。因此不再把外部下载中文字幕或 AI API 当成前提，直接使用播放器已有的翻译功能。

原生语言切换使用隔离的 YouTube 轨道适配器，实际验证的参数形态是 `captions.track.translationLanguage.languageCode`。这不是官方承诺稳定的公开 IFrame 选项，YouTube 改版时可能需要适配；手动选择中文是明确的备用操作，不会偷偷换成付费翻译。

## 本机服务

需要 Node.js **22.10+**，自动获取原字幕还需已安装的 `yt-dlp`。无 npm 运行依赖，不需要 `npm install`。

```bash
cd /path/to/roam-youtube-bilingual
npm start
```

默认监听 `http://127.0.0.1:17321`。无需创建 `.env`。保持服务运行；`Ctrl+C` 停止。没有创建开机启动、定时任务或系统常驻服务，电脑重启后需重新运行。

- 默认 YouTube 模式只访问本机只读字幕接口，无需配对码。
- 只读接口限制 Host、Origin、JSON 请求和 YouTube 视频 ID，不提供任意 URL 抓取、本地文件读取或付费翻译。
- 原有自定义 API 接口仍要求配对码认证，不因 YouTube 模式而开放。
- 如果已有 SRT / VTT 英文字幕，可以从“⋯ → 字幕文件、同步与全屏”导入；导入后 YouTube 模式无需本机服务即可叠加。

## 调整显示

视频内“**⋯**”可以设置：

- **翻译来源**：默认“YouTube 自带翻译”；自定义 API 只是可选项。
- **语言**：默认英文 `en` → 简体中文 `zh-CN`，会映射到 YouTube 的 `zh-Hans`。繁体中文可用 `zh-TW`。
- **英文大小与位置**：英文距底部默认 0.18，放在原生中文上方；可根据画面和 YouTube 字幕大小调整。
- **时间偏移**：只调整英文叠层，正数让英文延后。
- **双语全屏**：在原生 Roam 视频容器上将视频与英文叠层一起全屏，退出后恢复原样。

YouTube 自带的全屏按钮和画中画不包含 Roam 外层英文；需要两种语言时使用插件的“双语全屏”。无论普通还是全屏模式，都不会在视频下方插入常驻卡片。

旧版“样式预览”入口和示例句子已移除，避免把预览当作真正的双语翻译。

## 可选：自定义 AI API

只有主动选择“自定义 API”模式时才需要：

```dotenv
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=你的Key
OPENAI_MODEL=供应商实际支持的模型
```

将 `.env.example` 复制为 `.env`，在本机填写并限制文件权限，再重启服务。终端会提供 API 模式配对码，在弹出设置中填写。支持 OpenAI-compatible Chat Completions，本机兼容模型可不填 Key。

此模式会将所需原字幕发送给你的供应商，并可能产生费用；不会作为 YouTube 模式失败后的自动退路。API 模式如果与原生 CC 重复，才需要手动关闭原生 CC。**默认 YouTube 模式不需要这些步骤。**

## 验证

- 真实视频 `vif8NQcjVf0` 成功获取 2108 条英文原字幕。
- 已在真实 YouTube iframe 中通过原生轨道选择显示中文，并与对应英文在画面内同时出现；不是样式预览或模型生成的替代示例。
- Node 测试覆盖只读原文接口、保留的付费接口认证、来源验证、默认模式迁移、中文语言代码、原生轨道参数及有界重试。
- 浏览器测试区分 YouTube 模式与可选 API 模式，检查无 Key 一键开启、没有 AI 请求、同步英文、文件导入、无下方面板、错误反馈和清理。
- `npm run demo` 仅用于可选 API 模式的开发回归；YouTube 模式会拒绝演示服务，不会把预置字幕冒充真实字幕。

## 限制

- 需要视频具备可用的原字幕和 YouTube 自动翻译。没有字幕的视频不自动语音识别。
- `yt-dlp` 可能限流或受地区、登录、版本变动影响；可导入原字幕作为备用，不绕过限制。
- 中文内容、断句和时机由 YouTube 决定，插件只同步英文；自动翻译初次载入可能需要几秒。
- 对某些未公开支持的播放器版本，自动语言选择可能失效，届时手动从原生字幕菜单选择中文。
- 原文轨道代码需与视频匹配，例如部分视频使用 `en-US`。
- 字幕上限为 5 MB / 20000 条，单条原文最多 5500 字符。
- 连接和显示设置只保留在当前窗口会话，字幕缓存只在内存中。没有遥测或图谱内容上传。

## 开发与卸载

```bash
./build.sh
```

- `src/clock.mjs`：播放同步与 YouTube 原生轨道选择。
- `src/extension.mjs`：默认 YouTube 模式、可选 API 模式及画面内 UI。
- `src/surface.mjs`：叠层定位和双语全屏。
- `server/`：原字幕读取与隔离的可选 API 服务。
- `test/native-browser.mjs`：无需 Key / 不调用 AI 的默认路径。
- `test/overlay-browser.mjs`：可选 API 路径回归。

停用 Depot 扩展可移除英文叠层，YouTube 自带中文会保留。roam/js 版本可调用 `window.roamYouTubeBilingual?.onunload()`。停止服务终端可结束本机服务。私有截图、原始日志及测试产物位于被 Git 排除的 `artifacts/`。
