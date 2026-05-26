# Claude Usage Reticle

A pace tracker for AI coding-assistant usage limits. It overlays each provider's usage page with reticles that compare your actual usage against where you would be if you spread that limit evenly across the reset window.

As of v3.8 / v3.7.0 it works across multiple providers: **Claude**, **Codex** (ChatGPT), **Z.ai**, **MiniMax**, and **Google Gemini**. The repo name keeps "claude" for historical reasons.

![Claude usage tracker with reticles](demo_images/usage-tracker.png)

## What It Does

Adds two markers to each supported usage bar:

1. **Blue usage marker** - Shows where your current usage sits, converted to an equivalent time in the reset window
2. **Delta marker** - Shows how far OVER or UNDER the expected pace is

### Visual Indicators

- **Green overlay + label** = Under budget (you have capacity to spare)
- **Red glow + overlay + label** = Over budget (consider slowing down)
- **Color intensity** scales with how far off budget you are

### Example Reading

If your label shows `1d 5h OVER (15%)`, it means your usage is 15 percentage points ahead of the even-spend pace, equivalent to about 1 day and 5 hours of active window time.

### Supported pages

| Provider | URL | Notes |
|---|---|---|
| Claude | `claude.ai` → Settings → Usage | Reticles on Current session + Weekly bars. Settings panel for active-window (days + hours). |
| Codex | `chatgpt.com/codex/cloud/settings/analytics` | Reticles on 5h + Weekly usage limit cards (incl. GPT-5.3-Codex-Spark). |
| Z.ai | `z.ai/manage-apikey/subscription` (click Usage tab) | Reticles on Weekly + Monthly quotas. 5 Hours Quota row not reticled — Z.ai does not expose a reset timestamp for the rolling 5h window. |
| MiniMax | `platform.minimax.io/user-center/payment/token-plan` | Reticles on each Current Usage row (Text Gen, Audio, Video, Music, etc.). Newer plans add a weekly-limit row whose DOM hasn't been verified — open an issue if you have one and the reticle is missing. |
| Google Gemini | `gemini.google.com/usage` | Reticles on Current (Hourly) + Weekly bars. Visual cloning matches both cards perfectly. Local scraping toggle, custom refresh rates, and thresholds available. |

### Want another provider?

Open an issue at [github.com/KatsuJinCode/claude-usage-reticle/issues](https://github.com/KatsuJinCode/claude-usage-reticle/issues) with: a screenshot of the page showing the usage bar(s), the URL, and a snippet of the DOM around one bar (right-click → Inspect → copy outer HTML). If the bar layout is similar to one of the existing handlers, I can add support.

## Installation

### Option 1: Chrome Extension (Recommended)

For automatic running with no script manager required:

1. Download the project ZIP from [GitHub](https://github.com/KatsuJinCode/claude-usage-reticle/archive/refs/heads/main.zip), or clone the repo locally
2. Unzip it and keep the folder somewhere stable
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the unzipped `extension` folder
7. Visit [claude.ai/settings/usage](https://claude.ai/settings/usage)

The extension popup controls on/off state and custom budget-window settings.

### Option 2: Bookmarklet (No Install)

1. Visit the **[installation page](https://katsujincode.github.io/claude-usage-reticle/bookmarklet.html)**
2. **Chrome/Edge**: Drag the button to your bookmarks bar
   **Firefox**: Click Copy, create a new bookmark, paste as URL
3. Go to [claude.ai/settings/usage](https://claude.ai/settings/usage)
4. Click the bookmark

### Option 3: Tampermonkey (Auto-runs)

For automatic running every time you visit the page:

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. **Enable script injection** (required for Chrome/Edge):
   - **Chrome/Edge v138+**: Right-click Tampermonkey icon > "Manage Extension" > Enable "Allow User Scripts"
   - **Older Chrome/Edge**: Go to `chrome://extensions` > Enable "Developer Mode" (top-right toggle)
3. Try one of these install methods:
   - **[Install from Greasy Fork](https://greasyfork.org/en/scripts/559145-claude-usage-reticle)**
   - **[Install from Raw File](https://github.com/KatsuJinCode/claude-usage-reticle/raw/main/usage-reticle.user.js)**

## How It Works

### Position Calculation

The "NOW" position (where you *should* be) is calculated as:

```
Current Session: (5 - hours_until_reset) / 5 * 100%
Weekly Limits:   (168 - hours_until_reset) / 168 * 100%
```

### Color Scaling

The delta label color uses dynamic scaling:
- **Floor**: 35% minimum intensity (even small differences are visible)
- **Speed**: 2x scaling (reaches full intensity at 50% difference)
- **Formula**: `intensity = 0.35 + 0.65 * min(abs(diff) / 100 * 2, 1)`

## Features

| Feature | Description |
|---------|-------------|
| Time delta | Shows difference as "1d 5h OVER" or "2h 30m UNDER" |
| Percentage | Displays exact percentage difference in parentheses |
| Usage time | Blue marker shows equivalent day/time for your usage |
| Color scaling | Dynamic intensity based on how far off budget |
| Red glow | Over-budget state shows glow effect around overlay |
| Green fill | Under-budget state shows solid green overlay |
| Custom windows | Weekly bars can compress expected pace into active days/hours (Extension only) |
| Event-driven refresh | Updates on page changes, focus, and visibility changes |
| Soft shadows | Text has soft drop shadow for readability |
| Google Gemini Support | Full support for tracking Google Gemini usage limits on `gemini.google.com/usage` |
| Hourly & Weekly Progression | Real-time pacing reticles on both Hourly/Session limits and Weekly limits (Gemini) |
| Cloned Weekly Limit Card | Deep-clones the hourly bar DOM structure on Gemini to generate a Weekly limit card with absolute layout/style parity |
| Local Scraping & Logging | Opt-in toggle to log/save scraped usage stats to local/extension storage (Gemini-only; required due to lack of public API) |
| Customizable Refresh Slider | Range slider (5 to 120 minutes) to adjust auto-refresh rates (Gemini-only) |
| Dynamic Layout Spacing | Automatically injects 26px vertical margins around progress tracks to prevent reticle labels from overlapping reset times or headers (Gemini, Codex, Z.ai, MiniMax) |

## Limitations

- The script relies on Claude's current page structure. If Anthropic updates their UI, it may need updating.
- The bookmarklet runs once per click. Navigate away and back? Click it again.

**Last tested:** May 2026

## Files

| File | Purpose |
|------|---------|
| `bookmarklet.html` | Installation page with drag-to-install button and clean embedded bookmarklet injector |
| `usage-reticle.user.js` | Tampermonkey userscript and extension content script source |
| `extension/` | Manifest V3 browser extension package |
| `test-time-parsing.html` | Unit tests for time calculation |
| `color-calibrator.html` | Development tool for tuning color scaling |

## Releasing a new version

The userscript and the browser extension are **two separate products** with their own version numbers. They share most of the same JS, but a change that only affects one side does not require bumping the other.

**Userscript release** (`usage-reticle.user.js`)
1. Bump `// @version` in the file header — Tampermonkey checks this to detect updates. **Don't skip this**: if you only bump the internal constants, installed copies will silently stay on the old version.
2. Bump `SCRIPT_VERSION` and `BUILD_ID` constants in the IIFE body so the in-page debug label matches.

**Extension release** (`extension/`)
1. Bump `"version"` in `extension/manifest.json` — Chrome / Firefox use this to detect updates.
2. If the shared JS body changed, mirror the changes into `extension/content/usage-reticle.content.js` and bump its `SCRIPT_VERSION` / `BUILD_ID` to the extension's new version.

When the change is in shared code that affects both sides, do both releases in the same commit. The two version numbers are independent and do not need to match.

## Version History

### Userscript v3.8 / Extension v3.7.0 (Current)
- Implemented **Cross-Provider Dynamic Spacing** to automatically add vertical margins (`margin-top: 26px !important; margin-bottom: 26px !important;`) around progress tracks for all providers except Claude (Gemini, Codex, Z.ai, MiniMax). This prevents reticle labels from obscuring reset timestamps, header text, and other sibling elements.
- Parity alignment of layout and spacing styling between the Tampermonkey userscript and Chrome Extension content script.

### Userscript v3.7 / Extension v3.6.0
- Added full support for **Google Gemini** at `gemini.google.com/usage`.
- Reconstructed the Gemini weekly limit card using direct deep-cloning of the hourly limit card to guarantee 100% style, typography, and Tailwind class visual parity.
- Implemented **Local Scraping & Logging** as an opt-in toggle to log scraped usage data to local/extension storage.
- Added customizable **Refresh Interval** (5 to 120 minutes slider) and **Over-Budget Color Threshold** settings to change colors dynamically based on budget deviation.
- Cleaned up reset-timestamp parsing to prevent overlapping/concatenated percentage text.

### Userscript v3.4 / Extension v3.3.0
- Fixed a latent init-order bug that had been there since v3.0. The boot section called `init()` at the top of the IIFE, but the `platforms` object literal isn't assigned until 150 lines further down. Because `var` declarations hoist names without values, the first `currentPlatform()` lookup saw `platforms === undefined`, silently returned null, `isUsagePage()` returned false, and the script bailed without drawing anything. Sometimes a later DOM mutation would re-trigger the render and "heal" it; sometimes the page sat empty. Moved the `init()` call to the bottom of the IIFE so every declaration has run before init touches them
- Extended the auto-reload to Z.ai as well — Z.ai also requires manual refresh to update usage. Auto-reload is now active on MiniMax, Codex, and Z.ai. Only Claude is excluded (its bars update reactively)

### Userscript v3.3 / Extension v3.2.0
- Extended the focus / 10-minute auto-reload to the Codex analytics page. Codex's view only re-fetches usage on navigation, so without this it shows the snapshot from when you first opened the tab

### Userscript v3.2 / Extension v3.1.0
- MiniMax: usage percent is now read from the fill bar's own `style.width` instead of regex-matching the row text. The displayed "N / M" denominator runs straight into the "P% Used" span with no whitespace ("33 / 10033% Used"), and the old regex grabbed `10033`, clamping every row to 100% and producing nonsense "OVER" overlays
- MiniMax: page now auto-reloads when the tab regains focus (debounced — ignored within 60s of last load) and again every ~10 minutes while focused. MiniMax requires manual refresh to get fresh usage numbers; other platforms update reactively and are unaffected

### Userscript v3.1
- Tampermonkey `@version` header was missed in the v3.0 release, so installed copies were never offered the update — bumped to 3.1 so update detection works again
- No code changes; extension was unaffected and stayed at 3.0.0

### v3.0
- Multi-platform: Codex, Z.ai, MiniMax handlers added alongside Claude
- Platform router selects the right handler by hostname; each handler knows its own DOM hooks and reset-text format
- Generic renderer respects fillDirection (e.g. Codex's bars represent "% remaining" not "% used")
- Forces `overflow: visible !important` on the bar so providers using utility-CSS `overflow-hidden` don't clip the reticle children
- Userscript `@match` and extension `content_scripts.matches` narrowed per-platform: `claude.ai/*`, `chatgpt.com/codex/*`, `z.ai/manage-apikey/*`, `platform.minimax.io/user-center/*`
- Active-window settings panel + day-boundary markers remain Claude-only for v3.0; other platforms render the basic three reticles only

### v2.6
- Handles Anthropic's settings-as-hash-routed-modal redesign (`/new#settings/usage`)
- Userscript `@match` and extension content-script matches broadened to `claude.ai/*`
- `isUsagePage()` accepts both legacy path and hash forms
- Added `hashchange` listener so reticles attach/detach with in-app settings tabs
- Per-bar signature cache now requires at least one reticle child to count as a hit, so React's reconciliation of weekly bars no longer leaves bars un-reticled

### v2.5
- Added a dedicated Manifest V3 browser extension package
- Extension popup controls enable/disable and custom budget-window settings
- Fixed Current session filtering for Claude's redesigned Usage page
- Switched tracker injection to Claude's live `aria-label="Usage"` progressbars
- Uses nearest `Resets...` block detection for reliable rendering

### v2.0
- Usage time reticle showing equivalent day/time
- Delta reticle with time difference and percentage
- Dynamic color scaling with 35% floor and 2x speed
- Green overlay for under budget, red glow for over budget
- Soft shadow text styling for contrast
- Firefox compatibility with copy-to-clipboard fallback (bookmarklet)
- SPA navigation support (Tampermonkey)

### v1.5 (Legacy)
- Single NOW reticle showing current time position
- Basic red marker with triangular arrows

## Contributors

- [KatsuJinCode](https://github.com/KatsuJinCode) - Original Author
- [NemesisHubris](https://github.com/NemesisHubris)
- [podfishapp](https://github.com/podfishapp)

## License

MIT - Use it, share it, modify it.

---

*Made for the Claude community. Not affiliated with Anthropic.*
