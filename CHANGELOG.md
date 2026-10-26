# Changelog

## 0.5.0-beta.12 — 白色 20/18 默认样式与自适应卡片

- 新视频与 Reset style 默认使用英文 20 px、译文 18 px，两者均为白色。保留已有逐视频手动选择和语言偏好，不让旧临时全局字号覆盖新默认值。
- 修正卡片在固定高度 Roam 视频区被压在底部的问题：下方优先，空间不足完整向上展开；整张卡片始终受可视区约束，仅极小视口使用内部滚动。
- 删除临时撑页占位、自动滚动和滚动恢复逻辑，不再改变页面布局来给卡片腾位置。
- 跟随窗口/视觉视口变化、视频尺寸和位置变化、颜色展开及状态内容更新重新定位；关闭时清理观察器与动画帧。
- 108 项 Node 测试、69 项隔离界面检查与 7 项真实 Blueprint CSS 颜色检查通过；包含固定不可滚动面板复现、旧设置保留、样式重置、侧栏尺寸变化、上/下翻转及三种实际视口尺寸。
- 仅客户端设置与布局更新，API v7 和字幕获取逻辑不变；既有兼容 helper 无需重启。

## 0.5.0-beta.11 — 视频下方的紧凑设置

- 默认菜单约 272 × 194 px，开关并入标题行，中英各一行，版本与重置合并到一行；去掉常驻的长说明。
- 颜色改为点击色块后原位展开，一次只显示一组预设色和自定义输入；字号、颜色、自动保存和旧设置保持不变。
- 普通/剧场视图固定在视频及其工具栏下方，横向限制在视频列内，删除右侧自动翻转逻辑。
- 下方不足时使用可清理的临时滚动空间，不缩放原生播放器；关闭后清理，并避免覆盖用户主动滚动的位置。全屏保留紧凑底部浮层。
- 保留外点关闭、Esc、键盘焦点提示和 Blueprint 原生图标状态颜色。
- 104 项 Node 测试、61 项隔离界面检查及 7 项真实 Blueprint CSS 颜色检查通过；测试覆盖默认/展开尺寸、下方锚定、边缘滚动、清理、设置保存及真实鼠标外点关闭。
- API v7 与字幕逻辑不变，只需重载原 Draft 扩展，无需重启兼容 helper。

## 0.5.0-beta.10 — 关闭状态图标颜色

- 继续使用原生 Blueprint `bp3-icon-translate`，不替换图标。
- 移除图标上的 `color: inherit`，避免覆盖 Blueprint 原生灰色后继承按钮的黑色文字颜色；关闭时随主机浅色/深色主题，开启时仍为蓝色。
- 使用真实 Blueprint CSS 验证浅色、深色主题的关闭、开启和再次关闭状态；7 项颜色检查、27 项隔离界面回归和 103 项 Node 测试通过。
- 仅客户端样式修复，API v7 不变，beta.9 helper 无需重启。仍更新到既有 Draft #1509。

## 0.5.0-beta.9 — 轻量设置、独立样式与同源字幕

- 改为 Linear 风格的非模态浮层：点击外部、点击视频或按 Esc 关闭，取消 Done 与整页遮罩；有空间时避开视频。
- 英文、译文分别设置字号和颜色，支持数值步进、预设色、自定义色及样式重置。旧版开启状态、语言、共享字号自动迁移。
- 按确认的 B 方案，每种语言最多两行，独立适配，不截断内容；设置时仍可实时看字幕。
- 在不跨真实停顿、不改写原文的前提下，有界合并短阅读段；较窄视图使用原段，避免把整段挤成极小字。
- 修正人工英文与 ASR 译文混用的问题。使用 yt-dlp 原生人工源别名，在同一进程内提取、等待和下载，并核对实际源轨道；不使用拆分 signed-URL 下载路径。
- 新版真实服务已取得指定视频的 2,098 段同源中文。确认 12 个对应段在 YouTube 原始响应中为空，保留英文，不借用邻句补译。
- 显式保留真实下载错误，避免 yt-dlp 默认错误策略隐藏 HTTP 429。新缓存按源和目标轨道身份隔离，不复用旧 ASR 译文。
- 103 项 Node 测试及 45 项隔离浏览器检查通过；实际鼠标点击外部关闭、浮层避开视频也已检查。真实 Roam 播放另行验收。
- helper 协议升级至 API v7，需要同步重启。仍仅为既有 Draft #1509 预览，不合并、不创建 Release。

## 0.5.0-beta.8 — 预览侧栏、按视频记忆与分段对齐

- 预览模式把 Blueprint 翻译图标加入 Roam 原生侧边 gutter，与原生按钮同列；离开悬停后隐藏，键盘聚焦按钮组仍可访问。剧场模式沿用底部工具栏。
- 原生控制组暂时重建时不插入独立底栏，不改变视频几何或原生控件。
- 开关、目标语言、字号按视频保存在当前客户端本地存储中。重开视频和重载扩展恢复；失败、取消请求及实例清理不覆盖已保存的开启选择。
- 以英文段落为显示时间单位，把 YouTube 译文片段按最大时间重叠分组；同一英文段内中文保持完整、稳定，不再按短片段独立跳动。不重新翻译，不修正或伪造上游译文。
- 新增按视频恢复、存储故障、跨窗口读取、失败不自动重试、预览显隐、原生控制重建和中英分段回归。真实桌面验收与模拟检查分开报告。
- 服务 API 仍为 v6；本次客户端改动兼容 beta.7 helper。

## 0.5.0-beta.7 — 实际检查时间与进程复用

- 实测首次应用发现约 1.8–1.9 秒，但画面检查本身仅约 0.1 秒；旧版按整次请求耗时判断，会错误丢弃新鲜状态。
- 原生状态返回实际无障碍树检查的中点时间，客户端按该时间验证新鲜度，不再把前置进程发现时间当成画面陈旧。
- 复用已发现的 Roam PID，并在刷新时验证进程路径；实测刷新由约 1.9 秒降至约 0.24 秒。
- 同一播放器几何变化时丢弃错位响应并重新检查，不因此丢失之前的 CC 关闭状态。
- 设置显示版本号，便于确认重载是否真正更新了客户端；75 项 Node 测试通过。服务 API v6。

## 0.5.0-beta.6 — 播放状态连续性

- 区分播放控件隐藏与播放器不可见；隐藏控件本身不建立 CC-off 确认，只能维持同一可见播放器的已有关闭确认。
- 原生字幕区域重新出现文字节点时关闭自有层；判断只使用角色、归属和几何位置，不返回字幕文字。
- 优先通过现有 YouTube SDK 发送字幕关闭/恢复命令；需要重新确认时请求唤起原生控制栏。
- 在多个 Roam 窗口中按前后顺序查找匹配的目标播放器，不再固定读取一个错误的窗口。
- 保留英文设置和 Blueprint 图标；73 项 Node 测试通过，真实播放现场验收另行记录。
- 服务协议升级至 API v5。

## 0.5.0-beta.5 — 真实译文准备等待、英文界面与原生图标

- 按 yt-dlp 上游已知问题 #13831 的建议，在提取后、自动译文下载前等待约 60 秒；不再只在失败后冷却再重新提取。
- 同一真实视频验证：中文 3,700 条约 66 秒，日文 3,700 条约 73 秒，英文 2,108 条。无 cookies 读取、网络切换、额外翻译服务或软件升级。
- 原始/人工字幕保持快速路径；成功字幕保存至有大小、数量、时效限制的本机运行缓存，服务重启后复用。
- 设置、语言名称、工具提示、命令和错误全部改为英文。入口改用 Roam 的 Blueprint `bp3-icon-translate`，移除自绘 SVG。
- 错误提示约 6 秒后退出视频画面，详情仍可在设置查看，重复报错不重置浮层计时。
- 70 项 Node 测试及 22 项模拟浏览器检查通过；真实桌面显示另行验收，不以模拟检查代替。
- 服务协议升级至 API v4，升级时同时重启本机 helper。

## 0.5.0-beta.4 — YouTube 字幕请求优化

按用户明确要求更新到现有 Draft #1509；不合并、不创建 Release。本版浏览器回归及真实双语验收尚未完成。

仅参考 FluentRead 的 YouTube 字幕机制并独立实现，不移植其他功能、GPL 源码、浏览器权限或外部翻译服务。

- 相同视频/语种请求合并；不同下载有界串行排队，缓存命中优先。不再把本机忙碌误报为 YouTube 429。
- 首次缺少两条轨道时合并为一次 yt-dlp 提取；一条失败时保留另一条成功结果，但不以原文冒充译文。
- 真正的上游 429 触发本机 60 秒保护性冷却，不自动重试；错误保留分类及重试提示，不承诺上游届时恢复。
- 按订阅者取消元数据请求；换视频使旧请求失效；关闭设置不误杀仍在开启的双语流程。
- 保留严格两行、共用背景、一个底部图标、三项设置和原生 CC 关闭确认。
- 59 项 Node 测试通过。该版本减少请求放大，不代表真实 YouTube 429 已解除。

## 0.5.0-beta.3 — Draft preview update

Updated at the user's explicit request. The PR remains Draft; this is not a stable release. Live bilingual acceptance is still blocked by observed YouTube HTTP 429 responses for target subtitles.

- Replace accessibility-text capture and native-caption masking with separately downloaded English and target-language tracks.
- Render exactly two non-wrapping rows in one shared background, with one settings icon below the video.
- Keep the overlay hidden until the matching YouTube player's native CC control is explicitly confirmed off. Expired or unknown confirmation closes the display gate.
- Do not change native CC when a subtitle download fails. Hide the overlay before restoring a native CC state this instance changed.
- Prevent independent extension instances from rendering together; do not pretend that hiding an old instance unloads it.
- Report YouTube rate limits explicitly, without a masking or AI fallback.
- Pass 40 Node tests and 21 isolated mock-browser checks. These do not establish successful live subtitle downloads.

## 0.5.0-beta.1 — Development candidate, not deployed

This candidate was not deployed. Its masking approach was replaced in 0.5.0-beta.3 after the duplicate-caption report.

- Move the single settings icon into the native below-video toolbar.
- Flatten source and translated captions into exactly two non-wrapping rows, sharing one opaque background and a one-pixel row gap.
- Fit long lines to available width without truncating or adding more rows.
- Keep only enable, target language, and font size in settings. Remove custom AI APIs and credentials entirely.
- Discover target languages from the current video's YouTube metadata.
- Add a macOS desktop-only read bridge using an existing, authorized CuaDriver. It extracts only the matching YouTube caption region and never returns or persists raw accessibility trees, takes screenshots, records, or grants permissions.
- Restrict desktop-caption access to same-OS-user loopback connections, reject arbitrary PID/tool inputs, and stop reading on missing permission or active recording.
- Add isolated mock-data tests for two-row layout, shared background, language changes, size changes, cancellation, and toolbar preservation. These are not a substitute for live Roam verification.

## 0.4.0-beta.1 — YouTube's own translation, 2026-10-25

Draft preview only. Native YouTube translation is now the default; no AI model, API key, or pairing code is required.

- Let YouTube fetch and render its real Chinese auto-translation. Overlay only the synchronized original English captions.
- Use the observed `captions.track.translationLanguage` selection payload, with Chinese language-code mapping and bounded initialization retries. Manual selection in YouTube's caption menu remains the fallback for incompatible players.
- Add strictly scoped, origin-checked read-only routes for source captions. Existing paid-API routes remain authenticated and are never a silent fallback.
- Keep native CC enabled. Turning the plugin off removes the English overlay without disabling YouTube's Chinese captions.
- Migrate old settings to YouTube mode and place English above native captions. Hide API credentials unless the user explicitly selects the optional API mode.
- Remove sample-preview text and its entry point. Native mode rejects demo caption services.
- Verify actual English plus YouTube-generated Chinese on the reported video, not a fixture translation. The source track contains 2108 cues.

## 0.3.0-beta.1 — In-video presentation, 2026-10-25

Draft preview only. This redesign corrects the product direction: bilingual subtitles belong on the video, not in a permanent panel underneath it.

- Remove the below-video panel, transcript list, pagination controls, and export UI.
- Show a compact bilingual toggle and settings button inside the player; render the original line above the translated line near the bottom of the picture.
- One explicit action connects, retrieves captions, and starts look-ahead translation. Merely loading the extension makes no API requests.
- Move connection settings, subtitle size/position, file import, and timing adjustment into a modal opened on demand.
- Isolate the UI with Shadow DOM and prevent its control events from triggering parent Roam block actions.
- Add an explicitly labeled, API-free style preview. Preview text is never presented as a real video translation.
- Add bilingual fullscreen for native Roam video containers, with cleanup on exit. YouTube's own iframe fullscreen and PiP remain separate and do not include the outer overlay.
- Replace panel-focused browser tests with in-video geometry, playback, cancellation, import, lifecycle, and no-layout-change acceptance checks.

Real-provider translation quality and latency still require a user-configured API. The local companion remains necessary for automatic caption retrieval; this version does not remove that dependency.

## 0.2.0-beta.2 — Native Roam layout repair, 2026-10-25

Draft preview only; keep Depot PR #1509 unmerged.

### Root cause

Roam assigns `rm-video-player` to the iframe itself. The previous selector treated that iframe as a container and inserted the panel inside a zero-height, `overflow:hidden` aspect-ratio box. The video covered nearly all controls. The earlier standalone demo did not reproduce this native layout and therefore missed the failure.

### Fixed

- Mount after the complete native spacing wrapper, outside the clipped video container and native toolbar.
- Keep theater content scrollable in short windows without shrinking the video. Restore layout markers exactly on unload, including shared ownership across multiple videos.
- Follow a video component moved between the theater and sidebar without duplicating or discarding its subtitle panel.
- Keep the internal file input hidden despite stronger host form selectors. Wrap toolbar controls in narrow sidebars.
- Show the build version and explicit setup/import/translation steps on the panel.

### Verification

- The exact clipping failure was reproduced before the fix; only the disabled translation button was reachable. All seven controls are reachable after the fix.
- 37 Node tests and the existing 12 browser checks still pass.
- 13 additional mount/lifecycle checks pass, including native wrappers, sidebar moves, cleanup, style conflicts, and missing-service feedback.
- Button reachability passes at 1440×900, 900×420, and 390×700.
- Real caption retrieval succeeds for the reported video, with 2108 English cues. No paid translation API was used; real-provider acceptance remains pending.

## 0.2.0-beta.1 — Draft preview, 2026-10-25

This version is for Roam Depot shorthand testing. It is not approved for merge or production release.

### Fixed

- Preserve literal angle brackets through subtitle parsing and the local bridge; retain simultaneous subtitle lines.
- Rebase the playback clock correctly when speed or pause state changes. Freeze stale playback instead of continuing to advance and request translations.
- Queue a seek until the player supplies its initial time. Keep paused players usable without periodic time packets.
- Keep source subtitles when the translation language changes. Discard unsaved dialog edits and ignore canceled, late translation responses.
- Hide subtitle overlays when a dialog, another element, the viewport edge, or fullscreen obscures the video.
- Bound provider responses to 512 KiB and suppress raw provider JSON errors. Verify local-service identity and response video/language metadata.

### Improved

- Render at most 100 transcript rows at a time, with previous/next page and jump-to-current controls.
- Use binary search to find the translation window. Avoid new translation requests while the page is hidden or playback time is unavailable.
- Add a versioned service handshake, reproducible build script, 37 Node tests, and 12 browser regression checks.

### Still requires acceptance testing

- The user's actual Roam desktop layout and third-party video extensions.
- Translation quality, latency, and cost with a real user-configured API.
- Native YouTube fullscreen/PiP overlays and speech-to-text for videos without captions are not supported.

## 0.1.0 — Local prototype

Initial bilingual overlay, transcript list, subtitle import, local caption service, compatible translation API, and Markdown export.
