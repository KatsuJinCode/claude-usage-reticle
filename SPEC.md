# Claude Usage Visual Inject - Specification

## Goal
Add a visual time-progress reticle overlay on AI coding-assistant usage bars to show where usage SHOULD be based on current elapsed time in the reset cycle.

## Problem
Usage pages across providers show:
- Current usage as a percentage or fraction bar
- Reset time (e.g., "Resets Sat 10:59 AM" or rolling relative windows like 5 hours)

But there is no visual indicator of whether you are ahead or behind your "budget". You have to mentally calculate whether your usage with the remaining hours is on track. In addition, many providers lack direct API endpoints for usage data, and their usage bars place text details directly above or below the track, causing injected absolute overlays to collide with or obscure critical reset text and headers.

## Solution
A visual budget tracker that overlays:
1. **Blue usage marker** - Shows where your current usage sits, converted to an equivalent time in the reset window.
2. **Delta marker** - Shows how far OVER or UNDER the expected pace is, with color intensity scaling dynamically based on deviation (red glow for over-budget, green fill for under-budget).

### Calculations
- **Session/Hourly Limits (e.g., 5-hour rolling)**:
  `Target % = (5 - hours_until_reset) / 5 * 100`
- **Weekly Limits (e.g., 168-hour fixed)**:
  `Target % = (168 - hours_until_reset) / 168 * 100`

### Collision-Free Layouts
To ensure the absolute-positioned reticle labels (which sit 22px above/below the progress track) do not obscure surrounding labels, the system automatically injects a `26px` vertical margin around the progress track for all non-Claude platforms.

## Multi-Provider Support
The codebase is structured with a platform router targeting:
1. **Claude** (`claude.ai`) - Settings -> Usage progress bars.
2. **Codex** (`chatgpt.com/codex/cloud/settings/analytics`) - 5h + Weekly limits.
3. **Z.ai** (`z.ai/manage-apikey/subscription`) - Weekly + Monthly quotas.
4. **MiniMax** (`platform.minimax.io/user-center/payment/token-plan`) - Current Usage rows.
5. **Google Gemini** (`gemini.google.com/usage`) - Current (hourly) + Weekly limit cards.

### Gemini Implementation Details
- **DOM Deep Cloning**: Since Gemini does not natively render a Weekly progress bar under the weekly limit section, the script deep-clones the hourly progress card DOM structure (including all classes, text sub-elements, and styles) to establish a parallel, visually matching Weekly limit card.
- **Local Scraping & Logging**: Optional setting to capture and persist scraped Gemini usage stats into local storage or Chrome extension storage.
- **Custom Refresh & Thresholds**: Adjustable range sliders to control page auto-refresh rate and over-budget coloring thresholds.

## Files
- `usage-reticle.user.js` - Tampermonkey userscript containing the platform router, scraper, and rendering logic.
- `extension/` - Manifest V3 browser extension package that shares the core injector script.
- `bookmarklet.html` - Installer page for the zero-install bookmarklet.
- `test-time-parsing.html` - Unit tests for reset time calculations.
- `color-calibrator.html` - UI for tuning color and intensity scaling.
