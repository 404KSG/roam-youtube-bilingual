# YouTube Bilingual Subtitles for Roam Research

English and translated YouTube captions in one synchronized overlay, with global styling and local caching. No external AI translation service or API key.

**Current build:** `0.5.0-beta.19` · **Helper API:** `8` · **Platform:** macOS Roam Desktop

<img src="https://raw.githubusercontent.com/404KSG/roam-youtube-bilingual/3c75575b29d9388cdc86b06222943be39047d044/assets/roam-bilingual-subtitles.png" width="900" alt="English and Chinese captions in Roam, with independent font sizes, colors, and global subtitle settings">

*User-provided example with custom styles. Personal sidebar and image metadata removed. [Source video](https://www.youtube.com/watch?v=4AWLcxTGZPA).*

## Features

- One player-local overlay, up to two lines per language, with independent font sizes and colors.
- Joined captions reveal source cues as they start, without repeating shared translation cues or multi-word rolling overlaps.
- Brief native-CC reactivation recovers quietly. A persistent conflict still warns and keeps bilingual captions hidden.
- Captions clear the bottom playback controls while paused or interacting; verified idle playback can return to the normal low position.
- Settings persist across videos and reloads on the same device.
- English can appear first while a compact indicator shows translation loading.
- Verified local caption bundles avoid unnecessary downloads. Uploaded target captions are preferred; automatic translations use the selected English source.

## Setup

Requires Node.js 22.10+, yt-dlp, and CuaDriver with existing Accessibility access. Nothing is installed or authorized automatically.

1. Clone this repository and check out the **same source commit pinned by the Depot entry or PR**, then run `./start.command` to start the local helper. The default branch may not contain an unmerged review build.
2. Until catalog approval, add this shorthand in Roam Depot's developer mode:

   ```text
   404KSG+roam-youtube-bilingual+1509
   ```

3. Reload the extension, open a YouTube embed, and enable subtitles using the translate icon.

The extension requires an API-v8 helper. **For beta.19, update and restart the local helper as well as reloading the extension.** The protocol remains v8, but the pause-state classification fix runs in the helper; reloading only the extension does not apply it. Use **YouTube subtitles: Fullscreen** to retain the overlay; YouTube's own iframe fullscreen/PiP excludes it.

## Important notes

- An English caption track is required. A new automatic translation may take about a minute; cached tracks load faster.
- Native CC must be confirmed off before the custom captions appear. Unknown state keeps the overlay hidden.
- Very small players temporarily hide captions when controls leave too little room. Settings and downloaded tracks are retained.
- The helper listens on `127.0.0.1:17321`. Captions and preferences are stored locally; no graph edits, cookie export, or recording.
- Caption cache: 24-hour validation freshness, 90-day retention, 256 MB limit.

## Review status

[Submitted to Roam Depot for review](https://github.com/Roam-Research/roam-depot/pull/1509); not yet merged into the catalog.

`./build.sh` builds and runs the tests. Beta.19 passed **169 Node tests** and **128 isolated browser checks**, including 23 subtitle-stability/pause checks and the existing layout, settings, session, seek, and cleanup regressions. Replaying the current targeted tests against beta.18 produced 12 failures. These checks use synthetic captions and player observations, not live YouTube or Roam accessibility data. Sustained live playback and native menu layouts still require desktop acceptance.

To reproduce the visual checks, build first, run `node test/player-controls-fixture.mjs`, open its printed local URL, and click **Run layout checks** or **Run stability checks**. [Before](assets/beta19-subtitles-before.png) / [after](assets/beta19-subtitles-after.png) show the same synthetic caption at the same timestamp; they are not live-video screenshots.
