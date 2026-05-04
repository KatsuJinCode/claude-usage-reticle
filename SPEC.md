# Claude Usage Visual Inject - Specification

## Goal
Add a visual time-progress reticle overlay on Claude's Settings > Usage bars to show where usage SHOULD be based on current time in the weekly reset cycle.

## Problem
Claude's usage page shows:
- Current usage as a percentage bar
- Reset time (e.g., "Resets Sat 10:59 AM")

But there's no visual indicator of whether you're ahead or behind your "budget". You have to mentally calculate whether 56% usage with X hours remaining is on track.

## Solution
A thin vertical line (reticle) overlaid on each usage bar showing the "target" position based on time elapsed in the week.

### Calculation
```
Week = 168 hours
Target % = (hours_since_last_reset / 168) * 100
```

Example:
- Week resets Saturday 10:59 AM
- Current time: Wednesday 6:00 PM
- Hours elapsed: ~103 hours
- Target %: (103/168) * 100 ≈ 61%
- Reticle appears at 61% mark on the bar

### Visual Comparison
- Usage bar BEHIND reticle → Under budget, have capacity
- Usage bar AHEAD of reticle → Over budget, slow down
- Usage bar AT reticle → On track

## Implementation Approach
Browser extension plus bookmarklet fallback that:
1. Matches Claude Settings > Usage
2. Finds usage bar elements in DOM
3. Extracts reset time from text
4. Calculates target position
5. Injects CSS-positioned reticle overlay on each bar

## Technical Details
- Target URL: https://claude.ai/settings/usage (or similar)
- Injection method: Manifest V3 content script or bookmarklet
- Reticle style: Thin vertical line (1-2px), contrasting color (red or white with shadow)
- Update frequency: On page load (weekly budget doesn't need real-time updates)

## Files
- `usage-reticle.user.js` - Full injector source used by the browser extension content script
- `bookmarklet.html` - Installer page with a clean embedded no-settings bookmarklet injector
- `extension/` - Manifest V3 browser extension package
