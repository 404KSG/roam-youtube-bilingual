# YouTube Bilingual Subtitles for Roam Research

English and translated YouTube captions in one synchronized overlay, with global styling and local caching. No external AI translation service or API key.

**Current build:** `0.5.0-beta.18` · **Helper API:** `8` · **Platform:** macOS Roam Desktop

<img src="https://raw.githubusercontent.com/404KSG/roam-youtube-bilingual/3c75575b29d9388cdc86b06222943be39047d044/assets/roam-bilingual-subtitles.png" width="900" alt="English and Chinese captions in Roam, with independent font sizes, colors, and global subtitle settings">

*User-provided example with custom styles. Personal sidebar and image metadata removed. [Source video](https://www.youtube.com/watch?v=4AWLcxTGZPA).*

## Features

- One player-local overlay, up to two lines per language, with independent font sizes and colors.
- Captions clear the bottom playback controls while paused or interacting; verified idle playback can return to the normal low position.
- Settings persist across videos and reloads on the same device.
- English can appear first while a compact indicator shows translation loading.
- Verified local caption bundles avoid unnecessary downloads. Uploaded target captions are preferred; automatic translations use the selected English source.

## Setup

Requires Node.js 22.10+, yt-dlp, and CuaDriver with existing Accessibility access. Nothing is installed or authorized automatically.

1. Clone this repository and run `./start.command` to start the local helper.
2. Until catalog approval, add this shorthand in Roam Depot's developer mode:

   ```text
   404KSG+roam-youtube-bilingual+1509
   ```

3. Reload the extension, open a YouTube embed, and enable subtitles using the translate icon.

The extension requires an API-v8 helper. Existing API-v8 helpers remain compatible with beta.18; no helper restart is needed for this client update. Use **YouTube subtitles: Fullscreen** to retain the overlay; YouTube's own iframe fullscreen/PiP excludes it.

## Important notes

- An English caption track is required. A new automatic translation may take about a minute; cached tracks load faster.
- Native CC must be confirmed off before the custom captions appear. Unknown state keeps the overlay hidden.
- Very small players temporarily hide captions when controls leave too little room. Settings and downloaded tracks are retained.
- The helper listens on `127.0.0.1:17321`. Captions and preferences are stored locally; no graph edits, cookie export, or recording.
- Caption cache: 24-hour validation freshness, 90-day retention, 256 MB limit.

## Review status

[Submitted to Roam Depot for review](https://github.com/Roam-Research/roam-depot/pull/1509); not yet merged into the catalog.

`./build.sh` builds and runs the tests. The current runtime passed **156 Node tests**, **115 isolated UI checks**, and **5 native-fetch transport checks**. Trusted pointer input can drag the fixture's iframe seek bar, and bilingual fullscreen geometry/cleanup was checked. These use simulated player controls and captions; sustained live YouTube playback, native menu layouts, and full desktop acceptance remain incomplete.

For the control-clearance fixture, build first, run `node test/player-controls-fixture.mjs`, open its printed local URL, and click **Run layout checks**.
