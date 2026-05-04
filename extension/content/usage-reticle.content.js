(function() {
    'use strict';

    var ROOT_KEY = '__claudeUsageReticle';
    var SCRIPT_VERSION = '2.5';
    var BUILD_ID = '2.5-20260501-stable-refresh';
    var STYLE_ATTR = 'data-usage-reticle-style';
    var ITEM_ATTR = 'data-usage-reticle-item';
    var CONTROL_ATTR = 'data-usage-reticle-control';
    var SIGNATURE_ATTR = 'data-usage-reticle-signature';
    var RETICLE_SELECTOR = '[' + ITEM_ATTR + '],.usage-reticle,.delta-reticle,.reticle-overlay,.reticle-glow';
    var STORAGE_KEY = 'claudeUsageReticleSettings';
    var EXTENSION_STORAGE_KEY = 'claudeUsageReticleExtensionSettings';
    var EXTENSION_MODE = true;
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var DAY_INDEX = {sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6};
    var SESSION_ROWS = {'current session': true};
    var WEEKLY_ROWS = {'all models': true, 'sonnet only': true, 'claude design': true};
    var ALLOWED_SECTIONS = {'plan usage limits': true, 'weekly limits': true};
    var ALL_BAR_SELECTOR = 'div[role="progressbar"][aria-valuenow]';
    var BAR_SELECTOR = 'div[role="progressbar"][aria-label="Usage"][aria-valuenow]';
    var DEFAULT_SETTINGS = {
        activeWindowEnabled: false,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        activeHoursEnabled: false,
        activeStart: '09:00',
        activeEnd: '18:00'
    };

    var existing = window[ROOT_KEY];
    if (existing && typeof existing.destroy === 'function') {
        if (existing.build === BUILD_ID && typeof existing.refresh === 'function') {
            existing.refresh();
            return;
        }
        existing.destroy();
    }

    var state = {
        observer: null,
        scheduleId: null,
        cleanup: [],
        lastRefresh: 0,
        lastRender: 0,
        ignoreMutationsUntil: 0,
        lastUrl: location.href,
        settings: loadSettings(),
        enabled: true,
        version: SCRIPT_VERSION,
        build: BUILD_ID,
        refresh: refreshExisting,
        destroy: destroy
    };
    window[ROOT_KEY] = state;

    injectStyles();
    init();

    function destroy() {
        if (state.scheduleId) clearTimeout(state.scheduleId);
        if (state.observer) state.observer.disconnect();

        state.cleanup.forEach(function(fn) {
            fn();
        });
        state.cleanup = [];

        removeReticles(document);

        document.querySelectorAll('[' + CONTROL_ATTR + ']').forEach(function(el) {
            el.remove();
        });

        document.querySelectorAll('style[' + STYLE_ATTR + ']').forEach(function(el) {
            el.remove();
        });

        if (window[ROOT_KEY] === state) {
            delete window[ROOT_KEY];
        }

        notifyExtension(false);
    }

    function refreshExisting() {
        if (Date.now() - state.lastRender < 1000) return 0;
        return addReticles();
    }

    function init() {
        if (!EXTENSION_MODE) {
            run();
            return;
        }

        loadExtensionState(function() {
            watchExtensionSettings();
            run();
        });
    }

    function run() {
        addReticles();

        state.observer = new MutationObserver(function(mutations) {
            if (location.href !== state.lastUrl) {
                state.lastUrl = location.href;
            }
            if (hasRelevantMutation(mutations)) {
                scheduleRefresh(250);
            }
        });
        state.observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['aria-valuenow', 'aria-valuemax', 'class', 'style', 'data-theme', 'data-mode', 'data-color-mode'],
            childList: true,
            characterData: true,
            subtree: true
        });

        on(document, 'visibilitychange', function() {
            if (!document.hidden) scheduleRefresh(0);
        });
        on(window, 'focus', function() {
            scheduleRefresh(0);
        });
        on(window, 'pageshow', function() {
            scheduleRefresh(0);
        });
    }

    function scheduleRefresh(delay) {
        if (state.scheduleId) clearTimeout(state.scheduleId);
        state.scheduleId = setTimeout(function() {
            state.scheduleId = null;
            if (document.hidden) return;
            var now = Date.now();
            if (now - state.lastRefresh < 500) return;
            state.lastRefresh = now;
            addReticles();
        }, delay);
    }

    function on(target, eventName, handler) {
        target.addEventListener(eventName, handler);
        state.cleanup.push(function() {
            target.removeEventListener(eventName, handler);
        });
    }

    function hasRelevantMutation(mutations) {
        if (!isUsagePage()) return false;
        if (Date.now() < state.ignoreMutationsUntil) return false;

        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            var target = mutation.target && mutation.target.nodeType === 1 ? mutation.target : mutation.target && mutation.target.parentElement;
            if (!target) continue;
            if (target.closest && target.closest('[' + ITEM_ATTR + '],[' + CONTROL_ATTR + ']')) continue;
            if (mutation.type === 'attributes') return true;
            var text = normalizeText(target.textContent || '');
            if (/usage|reset|%\s*used|current session|all models|sonnet|claude design/i.test(text)) return true;
        }
        return false;
    }

    function isUsagePage() {
        return !!document.body && /(?:^|\.)claude\.ai$/.test(location.hostname) && /\/settings\/usage/.test(location.pathname);
    }

    function injectStyles() {
        if (document.head.querySelector('style[' + STYLE_ATTR + ']')) return;
        var style = document.createElement('style');
        style.setAttribute(STYLE_ATTR, 'true');
        style.textContent = '.usage-reticle{position:absolute;width:2px;height:100%;background:#3b82f6;box-shadow:0 0 2px rgba(0,0,0,.5);pointer-events:none;z-index:10;top:0}.usage-reticle::after{content:"";position:absolute;left:-3px;bottom:-5px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid #3b82f6}.usage-reticle-label{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);background:#3b82f6;color:#fff;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600;white-space:nowrap}.delta-reticle{position:absolute;width:2px;height:100%;box-shadow:0 0 2px rgba(0,0,0,.5);pointer-events:none;z-index:10;top:0}.delta-reticle::before{content:"";position:absolute;left:-3px;top:-5px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--reticle-arrow-color,#ef4444)}.delta-reticle-label{position:absolute;top:-22px;left:50%;transform:translateX(-50%);padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600;white-space:nowrap;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.9),0 0 4px rgba(0,0,0,0.7),0 0 8px rgba(0,0,0,0.4);border:1px solid #000}.reticle-overlay{position:absolute;height:100%;top:0;pointer-events:none;z-index:4;border-radius:4px}.reticle-glow{position:absolute;height:100%;top:0;pointer-events:none;z-index:3;border-radius:4px}';
        style.textContent += '.usage-reticle-settings{--reticle-panel-bg:rgba(255,250,242,.96);--reticle-panel-border:rgba(116,90,70,.28);--reticle-panel-text:#2f261f;--reticle-panel-muted:#6d5a4b;--reticle-panel-field:#fffaf2;--reticle-panel-field-border:rgba(116,90,70,.32);--reticle-panel-toggle:#7a4b2a;--reticle-panel-toggle-off:#8b8177;--reticle-panel-shadow:0 8px 22px rgba(55,38,24,.08);margin:0 0 16px;padding:12px 14px;border:1px solid var(--reticle-panel-border);border-radius:14px;background:var(--reticle-panel-bg);box-shadow:var(--reticle-panel-shadow);color:var(--reticle-panel-text);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}.usage-reticle-settings[data-reticle-theme="dark"]{--reticle-panel-bg:rgba(38,38,36,.94);--reticle-panel-border:rgba(255,255,255,.16);--reticle-panel-text:#f4f1ea;--reticle-panel-muted:#c9c1b6;--reticle-panel-field:rgba(20,20,19,.92);--reticle-panel-field-border:rgba(255,255,255,.22);--reticle-panel-toggle:#d2b48c;--reticle-panel-toggle-off:#6f6961;--reticle-panel-shadow:0 10px 28px rgba(0,0,0,.26);color-scheme:dark}.usage-reticle-settings button,.usage-reticle-settings input,.usage-reticle-settings select{font:inherit}.usage-reticle-settings__top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.usage-reticle-settings__title{font-weight:800;font-size:13px;color:var(--reticle-panel-text)}.usage-reticle-settings__summary{color:var(--reticle-panel-muted);margin-top:2px}.usage-reticle-settings__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px}.usage-reticle-settings__group{display:flex;flex-direction:column;gap:5px}.usage-reticle-settings__days{display:flex;flex-wrap:wrap;gap:6px}.usage-reticle-settings label{display:flex;align-items:center;gap:5px;color:var(--reticle-panel-text)}.usage-reticle-settings input[type="time"],.usage-reticle-settings select{border:1px solid var(--reticle-panel-field-border);border-radius:8px;background:var(--reticle-panel-field);color:var(--reticle-panel-text);padding:5px 7px}.usage-reticle-settings input[type="checkbox"]{accent-color:#60a5fa}.usage-reticle-settings__toggle{border:0;border-radius:999px;padding:7px 11px;background:var(--reticle-panel-toggle);color:#fffaf2;font-weight:800;cursor:pointer}.usage-reticle-settings[data-reticle-theme="dark"] .usage-reticle-settings__toggle{color:#241a12}.usage-reticle-settings__toggle[aria-pressed="false"]{background:var(--reticle-panel-toggle-off);color:#fffaf2}.usage-reticle-settings__time{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.usage-reticle-settings__hint{color:var(--reticle-panel-muted);font-size:11px}.day-boundary-reticle{position:absolute;width:2px;height:100%;background:rgba(116,90,70,.7);pointer-events:none;z-index:5;top:0}.hour-tick-reticle{position:absolute;width:1px;height:50%;bottom:0;background:rgba(116,90,70,.25);pointer-events:none;z-index:3}.day-boundary-label{position:absolute;bottom:-36px;transform:translateX(-50%);color:rgba(116,90,70,.7);font-size:9px;font-weight:700;letter-spacing:.02em;white-space:nowrap;pointer-events:none}';
        document.head.appendChild(style);
    }

    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeKey(text) {
        return normalizeText(text).toLowerCase();
    }

    function clampPct(value) {
        return Math.max(0, Math.min(100, value));
    }

    function fmtTime(d, short) {
        var day = DAYS[d.getDay()];
        var h = d.getHours();
        var m = d.getMinutes();
        var ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (h === 0) h = 12;
        var ts = h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
        return short ? ts : day + ' ' + ts;
    }

    function fmtDelta(hours, pct) {
        var over = hours >= 0;
        hours = Math.abs(hours);
        var days = Math.floor(hours / 24);
        var hrs = Math.floor(hours % 24);
        var mins = Math.round((hours - Math.floor(hours)) * 60);
        if (mins === 60) {
            hrs += 1;
            mins = 0;
        }

        var text = '';
        if (days > 0) text = days + 'd ' + hrs + 'h';
        else if (hrs > 0) text = hrs + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
        else text = mins + 'm';

        return text + ' ' + (over ? 'OVER' : 'UNDER') + ' (' + Math.abs(Math.round(pct)) + '%)';
    }

    function getColor(pct) {
        var raw = Math.min(Math.abs(pct) / 100 * 2, 1);
        var p = 0.35 + 0.65 * raw;
        if (pct < 0) return 'hsl(142,' + (5 + p * 70) + '%,' + (95 - p * 55) + '%)';
        return 'hsl(0,' + (5 + p * 75) + '%,' + (95 - p * 55) + '%)';
    }

    function parseRgb(value) {
        var match = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/i);
        if (!match) return null;
        return {
            r: parseInt(match[1], 10),
            g: parseInt(match[2], 10),
            b: parseInt(match[3], 10),
            a: match[4] == null ? 1 : parseFloat(match[4])
        };
    }

    function luminance(rgb) {
        if (!rgb) return 255;
        return (0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b);
    }

    function usableBg(rgb) {
        return rgb && (rgb.a == null || rgb.a > 0.05);
    }

    function classOrAttrTheme(el) {
        if (!el) return null;
        var text = normalizeKey([
            el.className || '',
            el.getAttribute && el.getAttribute('data-theme') || '',
            el.getAttribute && el.getAttribute('data-mode') || '',
            el.getAttribute && el.getAttribute('data-color-mode') || ''
        ].join(' '));

        if (/(^|\s|:|;)dark($|\s|;)/.test(text)) return 'dark';
        if (/(^|\s|:|;)light($|\s|;)/.test(text)) return 'light';

        var style = normalizeKey(el.getAttribute && el.getAttribute('style') || '');
        var colorScheme = style.match(/color-scheme:\s*([^;]+)/);
        if (colorScheme) {
            var scheme = normalizeKey(colorScheme[1]);
            if (scheme === 'dark') return 'dark';
            if (scheme === 'light') return 'light';
        }
        return null;
    }

    function detectTheme() {
        var explicit = classOrAttrTheme(document.documentElement) || classOrAttrTheme(document.body);
        if (explicit) return explicit;

        var probes = [
            document.querySelector('main'),
            document.querySelector('[data-testid="settings-page"]'),
            document.querySelector('[class*="bg-bg"], [class*="bg-main"], [class*="bg-alpha"]'),
            document.body,
            document.documentElement
        ];

        for (var i = 0; i < probes.length; i++) {
            var el = probes[i];
            if (!el) continue;
            var theme = classOrAttrTheme(el);
            if (theme) return theme;

            var bg = parseRgb(getComputedStyle(el).backgroundColor);
            if (usableBg(bg)) return luminance(bg) < 128 ? 'dark' : 'light';
        }

        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function loadSettings() {
        var settings = copySettings(DEFAULT_SETTINGS);
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (typeof saved.activeWindowEnabled === 'boolean') settings.activeWindowEnabled = saved.activeWindowEnabled;
            if (Array.isArray(saved.activeDays)) settings.activeDays = saved.activeDays.filter(function(day) {
                return day >= 0 && day <= 6;
            });
            if (typeof saved.activeHoursEnabled === 'boolean') settings.activeHoursEnabled = saved.activeHoursEnabled;
            if (/^\d{2}:\d{2}$/.test(saved.activeStart || '')) settings.activeStart = saved.activeStart;
            if (/^\d{2}:\d{2}$/.test(saved.activeEnd || '')) settings.activeEnd = saved.activeEnd;
        } catch (err) {}
        if (!settings.activeDays.length) settings.activeDays = DEFAULT_SETTINGS.activeDays.slice();
        return settings;
    }

    function extensionApi() {
        if (typeof browser !== 'undefined' && browser.runtime) return browser;
        if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
        return null;
    }

    function normalizeSavedExtensionState(saved) {
        saved = saved || {};
        return {
            enabled: saved.enabled !== false,
            settings: copySettings(saved.settings || DEFAULT_SETTINGS)
        };
    }

    function loadExtensionState(callback) {
        var api = extensionApi();
        if (!api || !api.storage || !api.storage.local) {
            callback();
            return;
        }

        function done(items) {
            var saved = normalizeSavedExtensionState(items && items[EXTENSION_STORAGE_KEY]);
            state.enabled = saved.enabled;
            state.settings = saved.settings;
            callback();
        }

        try {
            if (typeof browser !== 'undefined' && api === browser) {
                api.storage.local.get(EXTENSION_STORAGE_KEY).then(done, function() { callback(); });
            } else {
                api.storage.local.get([EXTENSION_STORAGE_KEY], done);
            }
        } catch (err) {
            callback();
        }
    }

    function saveExtensionState() {
        var api = extensionApi();
        if (!api || !api.storage || !api.storage.local) return;
        var payload = {};
        payload[EXTENSION_STORAGE_KEY] = {
            enabled: state.enabled !== false,
            settings: state.settings
        };

        try {
            api.storage.local.set(payload);
        } catch (err) {}
    }

    function watchExtensionSettings() {
        var api = extensionApi();
        if (!api || !api.storage || !api.storage.onChanged) return;

        var handler = function(changes, areaName) {
            if (areaName && areaName !== 'local') return;
            if (!changes || !changes[EXTENSION_STORAGE_KEY]) return;

            var saved = normalizeSavedExtensionState(changes[EXTENSION_STORAGE_KEY].newValue);
            state.enabled = saved.enabled;
            state.settings = saved.settings;
            scheduleRefresh(0);
        };

        api.storage.onChanged.addListener(handler);
        state.cleanup.push(function() {
            api.storage.onChanged.removeListener(handler);
        });
    }

    function copySettings(settings) {
        return {
            activeWindowEnabled: !!settings.activeWindowEnabled,
            activeDays: settings.activeDays.slice(),
            activeHoursEnabled: !!settings.activeHoursEnabled,
            activeStart: settings.activeStart,
            activeEnd: settings.activeEnd
        };
    }

    function saveSettings() {
        if (EXTENSION_MODE) {
            saveExtensionState();
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    }

    function timeToMinutes(value) {
        var match = String(value || '').match(/^(\d{2}):(\d{2})$/);
        if (!match) return 0;
        return Math.max(0, Math.min(1439, parseInt(match[1], 10) * 60 + parseInt(match[2], 10)));
    }

    function startOfDay(date) {
        var d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function addMinutes(date, minutes) {
        return new Date(date.getTime() + minutes * 60000);
    }

    function getActiveSegmentsForDay(day, settings) {
        if (!settings.activeWindowEnabled || settings.activeDays.indexOf(day.getDay()) === -1) return [];
        var start = startOfDay(day);
        if (!settings.activeHoursEnabled) {
            return [{start: start, end: addMinutes(start, 1440)}];
        }

        var startMinutes = timeToMinutes(settings.activeStart);
        var endMinutes = timeToMinutes(settings.activeEnd);
        if (startMinutes === endMinutes) {
            return [{start: start, end: addMinutes(start, 1440)}];
        }
        if (startMinutes < endMinutes) {
            return [{start: addMinutes(start, startMinutes), end: addMinutes(start, endMinutes)}];
        }
        return [{start: addMinutes(start, startMinutes), end: addMinutes(start, 1440 + endMinutes)}];
    }

    function activeMillisBetween(start, end, settings) {
        if (!settings.activeWindowEnabled) return Math.max(0, end - start);
        if (end <= start) return 0;

        var total = 0;
        var day = startOfDay(start);
        day.setDate(day.getDate() - 1);
        var guard = 0;
        while (day < end && guard < 370) {
            getActiveSegmentsForDay(day, settings).forEach(function(segment) {
                var overlapStart = Math.max(start.getTime(), segment.start.getTime());
                var overlapEnd = Math.min(end.getTime(), segment.end.getTime());
                if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
            });
            day.setDate(day.getDate() + 1);
            guard++;
        }
        return total;
    }

    function dateAtActiveFraction(start, end, fraction, settings) {
        if (!settings.activeWindowEnabled) {
            return new Date(start.getTime() + (end - start) * fraction);
        }

        var total = activeMillisBetween(start, end, settings);
        if (total <= 0) return new Date(start);

        var target = total * fraction;
        var consumed = 0;
        var day = startOfDay(start);
        day.setDate(day.getDate() - 1);
        var guard = 0;
        while (day < end && guard < 370) {
            var segments = getActiveSegmentsForDay(day, settings);
            for (var i = 0; i < segments.length; i++) {
                var segment = segments[i];
                var overlapStart = Math.max(start.getTime(), segment.start.getTime());
                var overlapEnd = Math.min(end.getTime(), segment.end.getTime());
                if (overlapEnd <= overlapStart) continue;
                var duration = overlapEnd - overlapStart;
                if (consumed + duration >= target) {
                    return new Date(overlapStart + Math.max(0, target - consumed));
                }
                consumed += duration;
            }
            day.setDate(day.getDate() + 1);
            guard++;
        }
        return new Date(end);
    }

    function describeActiveWindow() {
        var settings = state.settings;
        if (!settings.activeWindowEnabled) return 'Using full reset windows.';
        var days = settings.activeDays.map(function(day) {
            return DAYS[day];
        }).join(', ');
        var hours = settings.activeHoursEnabled ? settings.activeStart + '-' + settings.activeEnd : 'all day';
        return 'Custom window compresses weekly budget into ' + days + ', ' + hours + '. Claude still resets at the shown reset time.';
    }

    function parseResetInfo(text) {
        if (!text) return null;

        var relative = text.match(/(?:resets?\s*)?in\s*(?:(\d+)\s*h(?:ou)?rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i);
        if (relative && (relative[1] || relative[2])) {
            var hrsUntil = parseInt(relative[1] || 0, 10) + (parseInt(relative[2] || 0, 10) / 60);
            return {
                hrsUntil: hrsUntil,
                reset: new Date(Date.now() + hrsUntil * 3600000)
            };
        }

        var absolute = text.match(/(?:resets?\s*)?(sun|mon|tue|wed|thu|fri|sat)\w*\s+(\d+):(\d+)\s*(am|pm)/i);
        if (!absolute) return null;

        var hour = parseInt(absolute[2], 10);
        if (absolute[4].toLowerCase() === 'pm' && hour !== 12) hour += 12;
        if (absolute[4].toLowerCase() === 'am' && hour === 12) hour = 0;

        var now = new Date();
        var reset = new Date(now);
        reset.setHours(hour, parseInt(absolute[3], 10), 0, 0);

        var deltaDays = DAY_INDEX[absolute[1].toLowerCase().slice(0, 3)] - now.getDay();
        if (deltaDays < 0) deltaDays += 7;
        if (deltaDays === 0 && reset <= now) deltaDays = 7;
        reset.setDate(now.getDate() + deltaDays);

        return {
            hrsUntil: (reset - now) / 3600000,
            reset: reset
        };
    }

    function findResetInfo(root) {
        if (!root) return null;
        var nodes = root.querySelectorAll('span,div,p');
        for (var i = 0; i < nodes.length; i++) {
            var info = parseResetInfo(normalizeText(nodes[i].textContent));
            if (info) return info;
        }
        return null;
    }

    function findResetBlock(bar) {
        var node = bar.parentElement;
        for (var depth = 0; depth < 10 && node; depth++) {
            var spans = node.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
                if (/^\s*Resets/i.test(spans[i].textContent || '')) {
                    return {block: node, resetEl: spans[i]};
                }
            }
            node = node.parentElement;
        }
        return null;
    }

    function findTitle(block, resetEl) {
        var spans = block.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
            var span = spans[i];
            if (span === resetEl) continue;
            if (resetEl && (resetEl.contains(span) || span.contains(resetEl))) continue;
            var text = normalizeText(span.textContent || '');
            if (!text || /used\s*$/i.test(text) || /^resets/i.test(text)) continue;
            var key = normalizeKey(text);
            if (getWindowHours(key)) return span;
        }
        return null;
    }

    function getWindowHours(label) {
        if (SESSION_ROWS[label]) return 5;
        if (WEEKLY_ROWS[label]) return 168;
        return null;
    }

    function getUsagePercent(bar, row) {
        var now = parseFloat(bar.getAttribute('aria-valuenow'));
        var max = parseFloat(bar.getAttribute('aria-valuemax') || 100);
        if (!isNaN(now) && !isNaN(max) && max > 0) {
            return clampPct((now / max) * 100);
        }

        var fill = bar.querySelector('div[style*="width"]');
        if (fill) {
            var width = (fill.style.width || '').match(/([\d.]+)%/);
            if (width) return clampPct(parseFloat(width[1]));
        }

        var match = normalizeText(row.textContent).match(/(\d{1,3}(?:\.\d+)?)%\s*used/i);
        return match ? clampPct(parseFloat(match[1])) : null;
    }

    function createItem(className) {
        var el = document.createElement('div');
        el.className = className;
        el.setAttribute(ITEM_ATTR, 'true');
        return el;
    }

    function removeReticles(root) {
        root.querySelectorAll(RETICLE_SELECTOR).forEach(function(el) {
            el.remove();
        });
    }

    function clearAllBars() {
        document.querySelectorAll(ALL_BAR_SELECTOR).forEach(function(bar) {
            clearBar(bar);
        });
    }

    function clearBar(bar) {
        removeReticles(bar);
        bar.removeAttribute(SIGNATURE_ATTR);
    }

    function getBudgetMetrics(windowHours, resetInfo, useActiveWindow) {
        var end = resetInfo.reset;
        var start = new Date(end.getTime() - windowHours * 3600000);
        var now = new Date();
        var settings = useActiveWindow ? state.settings : copySettings(DEFAULT_SETTINGS);
        var totalMillis = activeMillisBetween(start, end, settings);
        var elapsedMillis = activeMillisBetween(start, now, settings);
        var totalHours = totalMillis > 0 ? totalMillis / 3600000 : windowHours;

        return {
            start: start,
            end: end,
            totalHours: totalHours,
            nowPos: totalMillis > 0 ? clampPct((elapsedMillis / totalMillis) * 100) : clampPct(((windowHours - resetInfo.hrsUntil) / windowHours) * 100),
            dateAtPct: function(pct) {
                return dateAtActiveFraction(start, end, clampPct(pct) / 100, settings);
            }
        };
    }

    function renderActiveWindowMarkers(bar, windowHours, resetInfo) {
        if (windowHours !== 168) return;
        if (!state.settings.activeWindowEnabled) return;

        var settings = state.settings;
        var end = resetInfo.reset;
        var start = new Date(end.getTime() - windowHours * 3600000);
        var totalActive = activeMillisBetween(start, end, settings);
        if (totalActive <= 0) return;

        var cumulativeBefore = 0;
        var day = startOfDay(start);
        if (day.getTime() > start.getTime()) day.setDate(day.getDate() - 1);
        var guard = 0;
        while (day.getTime() < end.getTime() && guard < 14) {
            var segs = getActiveSegmentsForDay(day, settings);
            var dayActiveMs = 0;
            for (var i = 0; i < segs.length; i++) {
                var ovStart = Math.max(segs[i].start.getTime(), start.getTime());
                var ovEnd = Math.min(segs[i].end.getTime(), end.getTime());
                if (ovEnd > ovStart) dayActiveMs += ovEnd - ovStart;
            }

            if (dayActiveMs > 0) {
                var startP = (cumulativeBefore / totalActive) * 100;
                var endP = ((cumulativeBefore + dayActiveMs) / totalActive) * 100;

                if (startP > 0 && startP < 100) {
                    var line = createItem('day-boundary-reticle');
                    line.style.left = startP + '%';
                    bar.appendChild(line);
                }

                var label = document.createElement('div');
                label.className = 'day-boundary-label';
                label.setAttribute(ITEM_ATTR, 'true');
                label.style.left = ((startP + endP) / 2) + '%';
                label.textContent = DAYS[day.getDay()];
                bar.appendChild(label);

                if (settings.activeHoursEnabled) {
                    var hoursInDay = dayActiveMs / 3600000;
                    for (var h = 1; h + 0.5 < hoursInDay; h++) {
                        var hourPos = startP + (endP - startP) * (h / hoursInDay);
                        var tick = createItem('hour-tick-reticle');
                        tick.style.left = hourPos + '%';
                        bar.appendChild(tick);
                    }
                }

                cumulativeBefore += dayActiveMs;
            }
            day.setDate(day.getDate() + 1);
            guard++;
        }
    }

    function renderBar(bar, windowHours, resetInfo, shortTime, useActiveWindow, row) {
        var usagePos = getUsagePercent(bar, row || bar);
        if (usagePos == null) return false;

        var metrics = getBudgetMetrics(windowHours, resetInfo, useActiveWindow);
        var nowPos = metrics.nowPos;
        var usageTime = metrics.dateAtPct(usagePos);
        var diffPct = usagePos - nowPos;
        var diffHrs = (diffPct / 100) * metrics.totalHours;
        var color = getColor(diffPct);
        var raw = Math.min(Math.abs(diffPct) / 100 * 2, 1);
        var intensity = 0.35 + 0.65 * raw;
        var signature = [
            Math.round(usagePos * 10),
            Math.round(nowPos * 10),
            Math.round(diffPct * 10),
            Math.round(metrics.totalHours * 10),
            Math.round(resetInfo.reset.getTime() / 60000),
            state.settings.activeWindowEnabled ? 1 : 0,
            state.settings.activeDays.join(','),
            state.settings.activeHoursEnabled ? 1 : 0,
            state.settings.activeStart,
            state.settings.activeEnd
        ].join('|');

        if (bar.getAttribute(SIGNATURE_ATTR) === signature) return true;
        clearBar(bar);
        bar.setAttribute(SIGNATURE_ATTR, signature);

        if (getComputedStyle(bar).position === 'static') {
            bar.style.position = 'relative';
        }
        bar.style.overflow = 'visible';

        if (useActiveWindow) {
            renderActiveWindowMarkers(bar, windowHours, resetInfo);
        }

        if (diffPct > 0) {
            var glow = createItem('reticle-glow');
            glow.style.left = nowPos + '%';
            glow.style.width = Math.abs(diffPct) + '%';
            glow.style.boxShadow = '0 0 ' + (8 + intensity * 15) + 'px ' + (2 + intensity * 5) + 'px hsla(0,' + (50 + intensity * 30) + '%,' + (50 - intensity * 10) + '%,' + (0.4 + intensity * 0.4) + ')';
            bar.appendChild(glow);

            var over = createItem('reticle-overlay');
            over.style.left = nowPos + '%';
            over.style.width = Math.abs(diffPct) + '%';
            over.style.background = 'hsla(0,' + (60 + intensity * 20) + '%,' + (40 - intensity * 10) + '%,' + (0.55 + intensity * 0.25) + ')';
            bar.appendChild(over);
        } else if (diffPct < 0) {
            var under = createItem('reticle-overlay');
            under.style.left = usagePos + '%';
            under.style.width = Math.abs(diffPct) + '%';
            under.style.background = 'hsla(142,' + (40 + intensity * 30) + '%,' + (50 - intensity * 10) + '%,' + (0.4 + intensity * 0.35) + ')';
            bar.appendChild(under);
        }

        var delta = createItem('delta-reticle');
        delta.style.left = nowPos + '%';
        delta.style.background = color;
        delta.style.setProperty('--reticle-arrow-color', color);
        var deltaLabel = document.createElement('div');
        deltaLabel.className = 'delta-reticle-label';
        deltaLabel.style.background = color;
        deltaLabel.textContent = fmtDelta(diffHrs, diffPct);
        delta.appendChild(deltaLabel);
        bar.appendChild(delta);

        var usage = createItem('usage-reticle');
        usage.style.left = usagePos + '%';
        var usageLabel = document.createElement('div');
        usageLabel.className = 'usage-reticle-label';
        usageLabel.textContent = fmtTime(usageTime, shortTime);
        usage.appendChild(usageLabel);
        bar.appendChild(usage);

        return true;
    }

    function getSectionTitle(section) {
        var heading = section.querySelector('h1,h2,h3,h4');
        var text = normalizeKey(heading ? heading.textContent : '');
        if (text.indexOf('plan usage limits') !== -1) return 'plan usage limits';
        if (text.indexOf('weekly limits') !== -1) return 'weekly limits';
        if (text.indexOf('additional features') !== -1) return 'additional features';
        if (text.indexOf('extra usage') !== -1) return 'extra usage';
        return text;
    }

    function findContainingSection(el) {
        var node = el;
        while (node && node !== document.body) {
            if (node.tagName && node.tagName.toLowerCase() === 'section') return node;
            node = node.parentElement;
        }
        return null;
    }

    function sectionAllowsBar(bar, label) {
        var section = findContainingSection(bar);
        var title = section ? getSectionTitle(section) : '';
        if (!ALLOWED_SECTIONS[title]) return false;
        if (SESSION_ROWS[label]) return title === 'plan usage limits';
        if (WEEKLY_ROWS[label]) return title === 'weekly limits';
        return false;
    }

    function findControlsAnchor() {
        var sections = Array.prototype.slice.call(document.querySelectorAll('section'));
        var fallback = sections[sections.length - 1] || null;
        for (var i = 0; i < sections.length; i++) {
            var title = getSectionTitle(sections[i]);
            var text = normalizeKey(sections[i].textContent || '');
            if (title === 'extra usage' || text.indexOf('extra usage') !== -1 && text.indexOf('monthly spend limit') !== -1) {
                return sections[i];
            }
        }
        return fallback;
    }

    function updateControls() {
        var panel = document.querySelector('[' + CONTROL_ATTR + ']');
        if (!panel) return;
        var settings = state.settings;
        var toggle = panel.querySelector('[data-reticle-toggle]');
        var summary = panel.querySelector('[data-reticle-summary]');
        var hoursEnabled = panel.querySelector('[data-reticle-hours-enabled]');
        var start = panel.querySelector('[data-reticle-start]');
        var end = panel.querySelector('[data-reticle-end]');

        panel.setAttribute('data-reticle-theme', detectTheme());
        toggle.setAttribute('aria-pressed', String(settings.activeWindowEnabled));
        toggle.textContent = settings.activeWindowEnabled ? 'Custom window on' : 'Custom window off';
        summary.textContent = describeActiveWindow();
        hoursEnabled.checked = settings.activeHoursEnabled;
        start.value = settings.activeStart;
        end.value = settings.activeEnd;
        panel.querySelectorAll('[data-reticle-day]').forEach(function(input) {
            input.checked = settings.activeDays.indexOf(parseInt(input.value, 10)) !== -1;
        });
    }

    function renderControls(anchor) {
        if (EXTENSION_MODE) {
            document.querySelectorAll('[' + CONTROL_ATTR + ']').forEach(function(el) {
                el.remove();
            });
            return;
        }

        if (document.querySelector('[' + CONTROL_ATTR + ']') || !anchor) {
            updateControls();
            return;
        }

        var panel = document.createElement('div');
        panel.className = 'usage-reticle-settings';
        panel.setAttribute(CONTROL_ATTR, 'true');
        panel.innerHTML = '<div class="usage-reticle-settings__top"><div><div class="usage-reticle-settings__title">Usage Reticle Budget Window</div><div class="usage-reticle-settings__summary" data-reticle-summary></div></div><button type="button" class="usage-reticle-settings__toggle" data-reticle-toggle></button></div><div class="usage-reticle-settings__grid"><div class="usage-reticle-settings__group"><span>Active days</span><div class="usage-reticle-settings__days" data-reticle-days></div></div><div class="usage-reticle-settings__group"><label><input type="checkbox" data-reticle-hours-enabled> Limit active hours</label><div class="usage-reticle-settings__time"><input type="time" data-reticle-start> <span>to</span> <input type="time" data-reticle-end></div><div class="usage-reticle-settings__hint">Applies to weekly bars only. Excluded nights/weekends make the NOW marker move faster during active time; Claude does not reset overnight.</div></div></div>';

        var days = panel.querySelector('[data-reticle-days]');
        DAY_NAMES.forEach(function(name, index) {
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" data-reticle-day value="' + index + '"> ' + name.slice(0, 3);
            days.appendChild(label);
        });

        panel.querySelector('[data-reticle-toggle]').addEventListener('click', function() {
            state.settings.activeWindowEnabled = !state.settings.activeWindowEnabled;
            saveSettings();
            updateControls();
            scheduleRefresh(0);
        });
        panel.querySelector('[data-reticle-hours-enabled]').addEventListener('change', function(event) {
            state.settings.activeWindowEnabled = true;
            state.settings.activeHoursEnabled = event.target.checked;
            saveSettings();
            updateControls();
            scheduleRefresh(0);
        });
        panel.querySelector('[data-reticle-start]').addEventListener('change', function(event) {
            state.settings.activeWindowEnabled = true;
            state.settings.activeHoursEnabled = true;
            state.settings.activeStart = event.target.value || DEFAULT_SETTINGS.activeStart;
            saveSettings();
            updateControls();
            scheduleRefresh(0);
        });
        panel.querySelector('[data-reticle-end]').addEventListener('change', function(event) {
            state.settings.activeWindowEnabled = true;
            state.settings.activeHoursEnabled = true;
            state.settings.activeEnd = event.target.value || DEFAULT_SETTINGS.activeEnd;
            saveSettings();
            updateControls();
            scheduleRefresh(0);
        });
        panel.querySelectorAll('[data-reticle-day]').forEach(function(input) {
            input.addEventListener('change', function() {
                state.settings.activeWindowEnabled = true;
                state.settings.activeDays = Array.prototype.slice.call(panel.querySelectorAll('[data-reticle-day]:checked')).map(function(checked) {
                    return parseInt(checked.value, 10);
                });
                if (!state.settings.activeDays.length) state.settings.activeDays = [new Date().getDay()];
                saveSettings();
                updateControls();
                scheduleRefresh(0);
            });
        });

        if (anchor.nextSibling) {
            anchor.parentElement.insertBefore(panel, anchor.nextSibling);
        } else {
            anchor.parentElement.appendChild(panel);
        }
        updateControls();
    }

    function notifyExtension(active) {
        var api = extensionApi();
        if (!api || !api.runtime || !api.runtime.sendMessage) return;
        try {
            api.runtime.sendMessage({type: 'claude-usage-reticle:status', active: !!active});
        } catch (err) {}
    }

    function finishRender(value) {
        state.lastRender = Date.now();
        state.ignoreMutationsUntil = state.lastRender + 150;
        return value;
    }

    function addReticles() {
        state.ignoreMutationsUntil = Date.now() + 150;

        if (!isUsagePage()) {
            removeReticles(document);
            document.querySelectorAll('[' + CONTROL_ATTR + ']').forEach(function(el) {
                el.remove();
            });
            notifyExtension(false);
            return finishRender(0);
        }

        if (EXTENSION_MODE && state.enabled === false) {
            clearAllBars();
            document.querySelectorAll('[' + CONTROL_ATTR + ']').forEach(function(el) {
                el.remove();
            });
            notifyExtension(false);
            return finishRender(0);
        }

        notifyExtension(true);

        renderControls(findControlsAnchor());

        var added = 0;
        var bars = document.querySelectorAll(BAR_SELECTOR);

        bars.forEach(function(bar) {
            var found = findResetBlock(bar);
            if (!found) return;

            var title = findTitle(found.block, found.resetEl);
            var label = normalizeKey(title ? title.textContent : '');
            var windowHours = getWindowHours(label);
            if (!windowHours) return;
            if (!sectionAllowsBar(bar, label)) return;

            var resetInfo = parseResetInfo(normalizeText(found.resetEl.textContent || '')) || findResetInfo(found.block);
            if (!resetInfo && WEEKLY_ROWS[label]) {
                resetInfo = findResetInfo(findContainingSection(bar));
            }
            if (!resetInfo) return;

            if (renderBar(bar, windowHours, resetInfo, windowHours === 5, !!WEEKLY_ROWS[label], found.block)) {
                added++;
            }
        });

        return finishRender(added);
    }
})();
