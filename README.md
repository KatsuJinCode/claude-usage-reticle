# Claude Usage Reticle

A visual tool for tracking your Claude usage budget. See at a glance whether you're ahead or behind your expected usage based on time elapsed in the reset window.

![Usage Reticle Demo](demo.png)

## What It Does

Adds two reticles to your Claude usage bars (Settings > Usage):

1. **Blue Reticle** - Shows where your current usage sits, converted to an equivalent day/time
2. **Delta Reticle** - Shows how far OVER or UNDER budget you are, with time delta and percentage

### Visual Indicators

- **Green overlay + label** = Under budget (you have capacity to spare)
- **Red glow + overlay + label** = Over budget (consider slowing down)
- **Color intensity** scales with how far off budget you are

### Example Reading

If your label shows `1d 5h OVER (15%)`, it means:
- Your usage is 15% ahead of where it should be
- That's equivalent to about 1 day and 5 hours of "extra" usage
- The red color intensity reflects the 15% difference

Works with all three usage types:
- Current session (5-hour window)
- All models (weekly)
- Sonnet only (weekly)

## Installation

### Option 1: Bookmarklet (Easiest - No Install)

1. Visit the **[installation page](https://katsujincode.github.io/claude-usage-reticle/bookmarklet.html)**
2. **Chrome/Edge**: Drag the button to your bookmarks bar
   **Firefox**: Click Copy, create a new bookmark, paste as URL
3. Go to [claude.ai/settings/usage](https://claude.ai/settings/usage)
4. Click the bookmark

That's it! Click the bookmark whenever you want to see the reticles.

### Option 2: Tampermonkey (Auto-runs)

For automatic running every time you visit the page:

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. **Enable script injection** (required for Chrome/Edge):
   - **Chrome/Edge v138+**: Right-click Tampermonkey icon > "Manage Extension" > Enable "Allow User Scripts"
   - **Older Chrome/Edge**: Go to `chrome://extensions` > Enable "Developer Mode" (top-right toggle)
   - **Firefox/Safari**: No extra setup needed
3. **[Click here to install the script](https://github.com/KatsuJinCode/claude-usage-reticle/raw/main/usage-reticle.user.js)** - Tampermonkey will prompt you to install
4. Visit [claude.ai/settings/usage](https://claude.ai/settings/usage) - the reticles appear automatically

> **Troubleshooting**: If the script installs but nothing appears, check the [Tampermonkey FAQ](https://www.tampermonkey.net/faq.php) for browser-specific setup.

## How It Works

### Position Calculation

The "NOW" position (where you *should* be) is calculated as:

```
Current Session: (5 - hours_until_reset) / 5 * 100%
Weekly Limits:   (168 - hours_until_reset) / 168 * 100%
```

For example, if your weekly limit resets Saturday at 11 AM and it's currently Wednesday at 5 PM, about 103 hours have passed out of 168, so the NOW position is at ~61%.

### Color Scaling

The delta label color uses dynamic scaling:
- **Floor**: 35% minimum intensity (even small differences are visible)
- **Speed**: 2x scaling (reaches full intensity at 50% difference)
- **Formula**: `intensity = 0.35 + 0.65 * min(abs(diff) / 100 * 2, 1)`

Colors range from near-white (small difference) to fully saturated (large difference):
- Green: `hsl(142, 5-75%, 95-40%)`
- Red: `hsl(0, 5-80%, 95-40%)`

## Features

| Feature | Description |
|---------|-------------|
| Time delta | Shows difference as "1d 5h OVER" or "2h 30m UNDER" |
| Percentage | Displays exact percentage difference in parentheses |
| Usage time | Blue reticle shows equivalent day/time for your usage |
| Color scaling | Dynamic intensity based on how far off budget |
| Red glow | Over-budget state shows glow effect around overlay |
| Green fill | Under-budget state shows solid green overlay |
| Soft shadows | Text has soft drop shadow for readability |

## Limitations

- The script relies on Claude's current page structure. If Anthropic updates their UI, it may need updating.
- The bookmarklet runs once per click. Navigate away and back? Click it again.

**Last tested:** December 2025

## Files

| File | Purpose |
|------|---------|
| `bookmarklet.html` | Installation page with drag-to-install button |
| `usage-reticle.user.js` | Tampermonkey userscript (v2.0) |
| `test-time-parsing.html` | Unit tests for time calculation |
| `color-calibrator.html` | Development tool for tuning color scaling |

## Version History

### v2.0 (Current)
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

## License

MIT - Use it, share it, modify it.

---

*Made for the Claude community. Not affiliated with Anthropic.*
