# Changelog

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
