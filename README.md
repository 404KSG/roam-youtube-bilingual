# Roam YouTube 双语字幕

在 Roam Research 内嵌的 YouTube 视频上，同时显示原文和译文，并保留可点击的字幕列表。默认英文 → 简体中文，可配置其他语言。

> **0.2.0-beta.2 · Draft preview only — not a production release.**
>
> 本仓库与 Roam Depot 草稿 PR 仅供 shorthand 测试，不代表正式上架。不要合并或发布，直到完成用户验收。

包含原生 Roam 插件和只监听本机的 Node.js 服务。beta.2 修复了真实 Roam 剧场模式中“只剩一个灰色按钮”的挂载错误：控制面板现在位于完整视频组件外，而不是被 iframe 遮挡的比例容器内。已核对真实桌面 DOM 并复现、修复该故障；完整翻译体验仍需配置用户自己的 API 验收。

## 包含的功能

- 视频画面内原文、译文双行显示；下方同步显示当前句。
- 完整字幕列表，每页最多渲染 100 行，支持翻页、定位当前句、点击跳转与时间偏移。
- 优先获取人工原字幕，没有人工字幕时尝试自动字幕。
- SRT / VTT / YouTube JSON3 本地导入，不依赖自动下载成功。
- 使用自己的 OpenAI-compatible Chat Completions API，也支持本机兼容模型。
- 点击“开始翻译”后，按播放位置预取约 90 秒内的字幕，每批最多 24 条；跳转后处理新的位置。不会默认翻译整条视频。
- 停止翻译、会话缓存、当前双语复制、带时间链接的 Markdown 导出；切换目标语言时保留原字幕。
- 未同步播放器或页面在后台时不新增翻译请求；已发出的请求可能已经计费。
- 不自动写入、修改或删除 Roam 的页面和块。

## 为什么需要本机服务

[YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference) 提供播放控制与时间信息，但没有完整字幕文本接口。Roam 页面也不能跨域读取 YouTube iframe 内部。

因此采用：

```text
Roam 中的 YouTube iframe ──播放时间──→ Roam 插件 ──→ 双语显示
                                          │
                                          │ 本机配对码验证
                                          ▼
                                  127.0.0.1:17321
                                  ├─ yt-dlp 获取字幕
                                  └─ 你的翻译 API
```

API Key 留在本机环境配置中，Roam 只持有当前窗口会话的配对码。本机服务仍会将请求的原字幕发送给你配置的 API 供应商；使用本机模型可避免字幕发往远程供应商。

## 1. 配置并启动服务

需要 Node.js **22.10+**。自动获取字幕还需要已安装的 `yt-dlp`；导入字幕不需要它。没有 npm 运行依赖，不用执行 `npm install`。

在 Terminal 中运行：

```bash
cd /path/to/roam-youtube-bilingual
cp -n .env.example .env
chmod 600 .env
```

用文本编辑器打开 `.env`，填写：

```dotenv
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=填写你自己的Key
OPENAI_MODEL=填写供应商支持的模型名
```

- `OPENAI_BASE_URL` 是接口根地址，程序追加 `/chat/completions`；也可填写完整的 `/chat/completions` 地址。
- 兼容的远程接口要求 HTTPS。本机模型可用 `http://127.0.0.1:11434/v1`，本机不要求 API Key。
- 原生 Claude Messages / Gemini GenerateContent 等不同协议需要兼容网关；本版未直接支持其原生协议。
- 可设置 `BRIDGE_TOKEN` 为至少 16 字符的固定配对码。留空时每次启动生成新码，插件需要重新配对。
- 模型应能按提示返回 JSON。没有绑定特定供应商或默认付费模型。

然后启动：

```bash
npm start
```

终端会显示本机地址和配对码。保持此终端打开；`Ctrl+C` 停止。修改 `.env` 后需要重启。没有创建开机启动、定时任务或后台系统服务。

Mac 也可双击 `start.command` 启动。首次运行只会从 `.env.example` 创建空配置，不会替你填写 Key。

## 2. 在 Roam 安装插件

任选一种方式，避免同时加载两份。**shorthand 只安装 Roam 界面部分；本机字幕服务仍需先按第 1 步启动。**

### 草稿 PR shorthand（用于本次测试）

查看 [Draft PR #1509](https://github.com/Roam-Research/roam-depot/pull/1509)，确认最新预览构建成功后，在 **Settings → Roam Depot → Developer mode → Install extension by shorthand** 输入：

```text
404KSG+roam-youtube-bilingual+1509
```

已经安装此 shorthand 的用户只需重新加载该开发扩展，不必再添加一份。加载后视频下方应显示完整面板及版本号 `0.2.0-beta.2`。

保持 PR 为 Draft 即可继续测试，无需合并。若已安装 0.1.0 本地版本，先停用旧副本，再加载 shorthand。插件和本机服务必须一起更新至本版本。

### 方式 A：本地文件夹开发加载

1. 在 Roam 打开 **Settings → Roam Depot**，开启 developer mode。
2. 点击 **Load extension**，选择本项目文件夹，其中已有 `extension.js` 和 `README.md`。
3. 浏览器/桌面应用如果要求文件夹访问，请手动允许。
4. 打开包含 YouTube 嵌入视频的页面，应出现“**双语字幕**”面板。

本地文件夹扩展在完整刷新后可能需要从 Developer Extensions 再次加载。该方式是本地开发加载，并非 Depot 商店安装。

### 方式 B：手动 roam/js

把 `dist/roam-youtube-bilingual.js` 的**全部内容**放入你启用的 `{{[[roam/js]]}}` JavaScript 代码块中，按 Roam 的提示允许运行。

也可以在服务运行时使用短加载器：

```javascript
const script = document.createElement('script');
script.src = 'http://127.0.0.1:17321/roam-youtube-bilingual.js';
script.onerror = () => console.error('请先启动 Roam 双语字幕本机服务');
document.head.appendChild(script);
```

若 Roam 当前版本的 CSP / 本地网络限制阻止短加载器，使用方式 A 或粘贴完整脚本。无需把 API Key 粘贴到代码块中。

## 3. 连接并使用

1. 点击视频下方的 **设置**。也可从 Roam 命令面板运行“**YouTube 双语字幕：连接与设置**”。
2. 填写本机地址和终端显示的**配对码**，点击 **连接并检查**，然后关闭设置。
3. 原字幕语言默认 `en`，目标语言默认 `zh-CN`。原字幕代码需要与视频实际轨道匹配，例如部分视频使用 `en-US`。
4. 点击 **获取字幕**；若失败，点击 **导入字幕** 选择 SRT / VTT / JSON3。
5. 点击 **开始翻译**，开始播放视频。每次只允许一个视频面板自动翻译。
6. 展开 **字幕列表**，点击某句跳转；每页 100 行，用“上一页 / 下一页”浏览，或“定位当前句”回到播放位置。开启跟随播放后可自动换页。
7. 字幕偏早时，把 **时间偏移** 调为正数，使其延后。这个偏移也用于点击跳转。
8. 使用 **复制当前双语** 或 **导出双语 Markdown** 取走结果。导出只包含已经得到的译文，未翻译部分保留原文。

原生 YouTube CC 若与叠加字幕重复，可在播放器里关闭原生 CC；插件使用独立字幕，不会主动改动你的 YouTube 字幕偏好。

第一次连接到没有 `enablejsapi=1` 的嵌入视频时，会重新加载该播放器一次。卸载时恢复由插件修改过的 iframe 地址，也可能重新加载播放器。

## 演示

```bash
npm run demo
```

打开 `http://127.0.0.1:17321/demo`，从终端复制演示服务配对码。此模式只用 5 条人工测试字幕和预置中文，不请求真实 YouTube 字幕或翻译 API。视频本身仍是真实 YouTube 播放器，用来验证播放和跳转。

正式 `npm start` 也提供 `/demo` 页面，此时“获取字幕”和“开始翻译”会使用真实字幕与 API。页面右侧的示例文本始终标注为测试材料。

`/roam-layout` 是原生 Roam 布局回归页，复刻真实桌面端的类名、绝对定位、零高度比例容器、裁剪和剧场工具栏，不包含任何用户笔记。它用于检查面板位置、按钮命中、侧栏切换和小窗口滚动，不能替代真实 API 翻译验收。

## 已知限制

- **真实模型翻译、其他主题与第三方视频插件仍需验收。** 本次诊断只读取桌面端播放器/插件 DOM 和样式，并临时调整插件面板位置以确认根因，没有修改笔记或图谱块。
- 仅处理真实 YouTube `/embed/` iframe；不会给普通 YouTube 文本链接添加播放器。
- **YouTube 原生全屏、原生画中画不显示外层叠加字幕。** 普通 Roam 主窗视频布局支持；可通过扩大 Roam 播放区域观看。
- 为了共享 Roam 现有播放器，时间同步使用 YouTube iframe 的消息协议，未创建第二个播放器实例。该协议不是官方承诺的稳定接口，YouTube 更新可能需要适配；连接失败会显示状态，提供“重新连接”。
- yt-dlp 属于非官方字幕获取方式，可能遇到地区限制、登录要求、429 或 YouTube 改版。没有下载到字幕时请导入文件；不绕过登录、会员和付费限制。
- **无字幕视频不自动语音转写**，直播实时字幕也未支持。本版不使用音频识别 API。
- 两小时访谈不会整条立即翻译；译文第一次出现可能受 API 延迟影响。源字幕的断句也会影响翻译效果。字幕导入上限为 5 MB / 20000 条，单条原文最多 5500 字符。
- 配对码和连接设置只存在当前窗口会话中；原文与译文缓存只在内存中，刷新会丢失。需要保留时手动导出。
- 浏览器若弹出本地网络访问提示，需要你手动处理。服务不监听局域网，不修改网络、安全或浏览器权限配置。

## 验证记录

2026-10-25 本机验证：

- `npm test`：37 项通过。新增回归覆盖字幕二次解码丢字、同时间多行、时间字段校验、暂停与倍速同步、断流冻结、就绪前跳转、设置失效范围、分页边界、服务身份与供应商响应过滤。
- `npm run build` 和 `npm run check`：通过，生成物无第三方运行依赖。
- 在真实 Chromium / YouTube embed 上验证配对、字幕载入、双语显示、点击跳转和播放时间反馈；收到 YouTube `infoDelivery` 的 `currentTime: 19.202534`，同步显示 16–22 秒的对应字幕。另已验证原生 Depot ES 模块加载、反复加载/卸载、动态添加/移除视频、文件导入以及 390px 窄屏无横向溢出。
- 对 YouTube 官方示例视频 `M7lc1UVf-VE` 真实获取 **466 条英文字幕**；开头包括 `JEFF POSNICK: Hey, everybody.`。
- 新增 12 项浏览器回归：5001 条字幕只挂载 100 行、翻页、定位末页、切换语言保留原文、取消设置、遮挡隐藏、取消后的迟到响应、卸载清理、重复加载、视频切换及 Depot 模块加载。可复用脚本位于 `test/browser-regressions.mjs`，仅允许在隔离 `/demo` 页面运行。
- beta.2 新增 13 项原生布局生命周期检查，以及 1440×900、900×420、390×700 三种视口的按钮可达性检查。旧版本在同一夹具中只有“开始翻译”命中成功；修复后 7 个控制按钮全部可达。
- 真实用户报告的视频 `vif8NQcjVf0` 成功获取 **2108 条英文字幕**，开头与截图中的 Jensen Huang 访谈一致。
- 翻译 API 使用模拟响应及真实本地 HTTP 链路验证；未调用用户真实模型，未产生模型 API 费用。

本地测试日志位于 `artifacts/`，由 `.gitignore` 排除，不上传 GitHub。

## 开发与卸载

```bash
./build.sh  # 构建、语法检查、全部 Node 回归测试
# 或分别运行：
npm test
npm run build
npm run check
```

- `src/core.mjs`：字幕解析、时间查找、翻译编号验证和导出。
- `src/clock.mjs`：隔离的 iframe 时钟适配器。
- `src/mount.mjs`：原生 Roam 视频组件外部挂载、侧栏重挂载和剧场滚动布局生命周期。
- `src/protocol.mjs`：版本、服务握手、设置校验、缓存失效范围与分页规则。
- `src/extension.mjs`、`src/style.css`：Roam 插件和界面。
- `server/`：仅监听 127.0.0.1 的字幕与翻译服务。
- `extension.js`：供 Roam Depot 开发加载的生成物。
- `dist/roam-youtube-bilingual.js`：供 roam/js 使用的完整生成物。

停用 Depot 开发扩展，或禁用相应 roam/js 代码块后刷新，即可移除插件。当前窗口也可运行 `window.roamYouTubeBilingual?.onunload()` 来卸载 roam/js 版本。停止服务终端即可结束本机进程。

本项目为原创实现，借鉴沉浸式翻译/流畅阅读的双语观看交互思路，没有复制其代码、品牌素材或私有接口。
