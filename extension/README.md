# Claude Usage Reticle Extension

Manifest V3 browser extension package for Chrome, Chromium, Edge, Brave, and Firefox.

## Scope

- Static content script is scoped to `https://claude.ai/settings/*` so it survives Claude SPA navigation from Settings > General to Settings > Usage.
- The script exits without reading page text unless the current path is `/settings/usage`.
- No broad host permissions.
- No data collection or network requests.
- Extension settings are stored in extension `storage.local` under `claudeUsageReticleExtensionSettings`.
- The toolbar badge shows `ON` after the content script activates on the Usage page.
- The popup controls enable/disable state and custom budget-window settings.

## Chrome/Chromium Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `extension` folder.
5. Visit `https://claude.ai/settings/usage`.

## Firefox Temporary Install

1. Open `about:debugging#/runtime/this-firefox`.
2. Click Load Temporary Add-on.
3. Select `manifest.json` in this `extension` folder.
4. Visit `https://claude.ai/settings/usage`.

## Store Packaging

Zip the contents of this folder, not the parent project folder.

Chrome requires raster icons, so the manifest points at PNG files generated from the source SVG icons.
