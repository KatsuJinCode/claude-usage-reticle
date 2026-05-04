# Claude Usage Reticle

A pace tracker for Claude usage limits. It overlays Claude's Usage page with a reticle that compares your actual usage against where you would be if you spread that limit evenly across the reset window.

![Claude usage tracker with reticles](demo_images/usage-tracker.png)

## What It Does

Adds two markers to supported Claude usage bars (`Settings > Usage`):

1. **Blue usage marker** - Shows where your current usage sits, converted to an equivalent time in the reset window
2. **Delta marker** - Shows how far OVER or UNDER the expected pace is

### Visual Indicators

- **Green overlay + label** = Under budget (you have capacity to spare)
- **Red glow + overlay + label** = Over budget (consider slowing down)
- **Color intensity** scales with how far off budget you are

### Example Reading

If your label shows `1d 5h OVER (15%)`, it means your usage is 15 percentage points ahead of the even-spend pace, equivalent to about 1 day and 5 hours of active window time.

Works with:
- Current session (5-hour window)
- All models (weekly)
- Sonnet only (weekly)
- Other weekly bars that share the weekly reset window

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

## Version History

### v2.5 (Current)
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
