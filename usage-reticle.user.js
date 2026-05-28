// ==UserScript==
// @name         Claude Usage Reticle
// @namespace    https://github.com/KatsuJinCode
// @version      3.9
// @description  Visual usage tracker for Claude, Codex, Z.ai, MiniMax, Gemini — see if you're OVER or UNDER budget
// @author       KatsuJinCode, NemesisHubris, podfishapp
// @match        https://claude.ai/*
// @match        https://chatgpt.com/codex/*
// @match        https://z.ai/manage-apikey/*
// @match        https://platform.minimax.io/user-center/*
// @match        https://gemini.google.com/usage
// @icon         https://claude.ai/favicon.ico
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/KatsuJinCode/claude-usage-reticle
// @supportURL   https://github.com/KatsuJinCode/claude-usage-reticle/issues
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var ROOT_KEY = '__claudeUsageReticle';
    var SCRIPT_VERSION = '3.9';
    var BUILD_ID = '3.9-20260528-dom-restructure-fix';
    var STYLE_ATTR = 'data-usage-reticle-style';
    var ITEM_ATTR = 'data-usage-reticle-item';
    var CONTROL_ATTR = 'data-usage-reticle-control';
    var SIGNATURE_ATTR = 'data-usage-reticle-signature';
    var RETICLE_SELECTOR = '[' + ITEM_ATTR + '],.usage-reticle,.delta-reticle,.reticle-overlay,.reticle-glow';
    var STORAGE_KEY = 'claudeUsageReticleSettings';
    var EXTENSION_STORAGE_KEY = 'claudeUsageReticleExtensionSettings';
    var EXTENSION_MODE = false;
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
        activeEnd: '18:00',
        geminiScrapingEnabled: false,
        geminiRefreshInterval: 30,
        overBudgetThreshold: 0
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
        // Hash-routed settings modal: a hashchange may toggle whether we're on the
        // usage page without a corresponding DOM mutation, so trigger a refresh
        // (which will also remove reticles when navigating away).
        on(window, 'hashchange', function() {
            scheduleRefresh(0);
        });

        setupAutoReload();
    }

    // MiniMax, Codex, and Z.ai all show a stale snapshot until usage is
    // re-fetched. MiniMax and Z.ai expose an on-page refresh button that
    // re-fetches without navigating; we click that. Codex has no such button,
    // so it falls back to a full page reload. Claude updates reactively and
    // is excluded entirely. Triggered on focus return (debounced so a quick
    // alt-tab doesn't fire) and every ~10 minutes while the tab stays focused.
    var AUTO_RELOAD_PLATFORMS = {minimax: true, codex: true, zai: true, gemini: true};
    function setupAutoReload() {
        var platform = currentPlatform();
        if (!platform || !AUTO_RELOAD_PLATFORMS[platform.id]) return;

        var PAGE_LOAD_TIME = Date.now();
        var FOCUS_MIN_AGE_MS = 60 * 1000;
        var PERIODIC_AGE_MS = platform.id === 'gemini' ? (state.settings.geminiRefreshInterval || 30) * 60 * 1000 : 10 * 60 * 1000;
        var lastReloadAttempt = 0;

        function tryReload() {
            if (!platform.match() || !platform.isUsagePage()) return;
            var now = Date.now();
            if (now - PAGE_LOAD_TIME < FOCUS_MIN_AGE_MS) return;
            if (now - lastReloadAttempt < 1000) return;
            lastReloadAttempt = now;
            if (typeof platform.findRefreshButton === 'function') {
                var btn = platform.findRefreshButton();
                if (btn) { btn.click(); return; }
            }
            location.reload();
        }

        on(document, 'visibilitychange', function() {
            if (!document.hidden) tryReload();
        });
        on(window, 'focus', tryReload);

        var periodicId;
        function schedulePeriodic() {
            periodicId = setTimeout(function tick() {
                if (!document.hidden && document.hasFocus() &&
                    Date.now() - PAGE_LOAD_TIME >= PERIODIC_AGE_MS) {
                    tryReload();
                    return;
                }
                periodicId = setTimeout(tick, 60 * 1000);
            }, PERIODIC_AGE_MS);
        }
        schedulePeriodic();
        state.cleanup.push(function() { if (periodicId) clearTimeout(periodicId); });
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

    // Each platform describes how to recognise its usage page and where the bars
    // live. Claude is handled by the legacy code path further down (settings panel +
    // active-window markers); the other three platforms go through renderForPlatform
    // which uses a generic bar renderer and ignores active-window settings.
    var platforms = {
        claude: {
            id: 'claude',
            supportsActiveWindow: true,
            match: function() { return /(?:^|\.)claude\.ai$/.test(location.hostname); },
            isUsagePage: function() {
                return /\/settings\/usage/.test(location.pathname) || /#\/?settings\/usage/.test(location.hash);
            }
        },
        codex: {
            id: 'codex',
            supportsActiveWindow: false,
            match: function() { return location.hostname === 'chatgpt.com'; },
            isUsagePage: function() {
                return /^\/codex\/cloud\/settings\/analytics/.test(location.pathname);
            },
            findUsageRows: function() {
                var rows = [];
                var seen = [];
                Array.from(document.querySelectorAll('article')).forEach(function(article) {
                    var articleText = (article.textContent || '').replace(/\s+/g, ' ');
                    var isHourly = /5\s*hour\s*usage\s*limit/i.test(articleText);
                    var isWeekly = /Weekly\s*usage\s*limit/i.test(articleText);
                    if (!isHourly && !isWeekly) return;
                    var fill = article.querySelector('div[style*="width"][class*="bg-[#"]');
                    if (!fill) return;
                    var bar = fill.parentElement;
                    if (!bar || seen.indexOf(bar) !== -1) return;
                    seen.push(bar);
                    var pctMatch = articleText.match(/(\d+)%\s*remaining/i);
                    if (!pctMatch) return;
                    var resetMatch = articleText.match(/Resets\s+(?:[A-Za-z]+\s+\d+,\s+\d{4}\s+)?\d+:\d+\s*(?:AM|PM)/i);
                    rows.push({
                        barElement: bar,
                        label: isHourly ? '5 hour usage limit' : 'weekly usage limit',
                        percentUsed: 100 - parseInt(pctMatch[1], 10),
                        fillDirection: 'remaining',
                        resetText: resetMatch ? resetMatch[0] : '',
                        windowHours: isHourly ? 5 : 168,
                        isSession: isHourly
                    });
                });
                return rows;
            },
            parseReset: function(text) {
                if (!text) return null;
                var full = text.match(/Resets\s+(\w+)\s+(\d+),\s+(\d{4})\s+(\d+):(\d+)\s*(AM|PM)/i);
                if (full) {
                    var months = {jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11};
                    var hour = parseInt(full[4], 10);
                    if (full[6].toUpperCase() === 'PM' && hour !== 12) hour += 12;
                    if (full[6].toUpperCase() === 'AM' && hour === 12) hour = 0;
                    var reset = new Date(parseInt(full[3], 10), months[full[1].toLowerCase().slice(0, 3)], parseInt(full[2], 10), hour, parseInt(full[5], 10), 0, 0);
                    return {reset: reset, hrsUntil: (reset - new Date()) / 3600000};
                }
                var time = text.match(/Resets\s+(\d+):(\d+)\s*(AM|PM)/i);
                if (time) {
                    var h = parseInt(time[1], 10);
                    if (time[3].toUpperCase() === 'PM' && h !== 12) h += 12;
                    if (time[3].toUpperCase() === 'AM' && h === 12) h = 0;
                    var now = new Date();
                    var resetT = new Date(now);
                    resetT.setHours(h, parseInt(time[2], 10), 0, 0);
                    if (resetT <= now) resetT.setDate(resetT.getDate() + 1);
                    return {reset: resetT, hrsUntil: (resetT - now) / 3600000};
                }
                return null;
            }
        },
        zai: {
            id: 'zai',
            supportsActiveWindow: false,
            match: function() { return location.hostname === 'z.ai'; },
            isUsagePage: function() {
                if (!/^\/manage-apikey/.test(location.pathname)) return false;
                return !!document.querySelector('.subscription_usage-limit-card__M8soo');
            },
            findRefreshButton: function() {
                var btns = document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if ((btns[i].textContent || '').trim() === 'Refresh') return btns[i];
                }
                return null;
            },
            findUsageRows: function() {
                var card = document.querySelector('.subscription_usage-limit-card__M8soo');
                if (!card) return [];
                var rows = [];
                Array.from(card.querySelectorAll('div[style*="width"][class*="bg-gradient"]')).forEach(function(fill) {
                    var bar = fill.parentElement;            // the gray track
                    if (!bar) return;
                    var row = bar.parentElement;             // per-row container (title + % + bar + reset)
                    if (!row) return;
                    var rowText = row.textContent.replace(/\s+/g, ' ');
                    var pctMatch = rowText.match(/(\d+)%\s*Used/i);
                    if (!pctMatch) return;
                    var resetMatch = rowText.match(/Reset\s*Time:\s*\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}/i);
                    var windowHours = 168, isSession = false, label = 'weekly quota';
                    if (/5\s*Hours\s*Quota/i.test(rowText)) { windowHours = 5; isSession = true; label = '5 hours quota'; }
                    else if (/Monthly/i.test(rowText)) { windowHours = 720; label = 'monthly quota'; }
                    rows.push({
                        barElement: bar,
                        label: label,
                        percentUsed: parseInt(pctMatch[1], 10),
                        fillDirection: 'used',
                        resetText: resetMatch ? resetMatch[0] : '',
                        windowHours: windowHours,
                        isSession: isSession
                    });
                });
                return rows;
            },
            parseReset: function(text) {
                var m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
                if (!m) return null;
                var reset = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10), 0, 0);
                return {reset: reset, hrsUntil: (reset - new Date()) / 3600000};
            }
        },
        minimax: {
            id: 'minimax',
            supportsActiveWindow: false,
            match: function() { return location.hostname === 'platform.minimax.io'; },
            isUsagePage: function() {
                return /^\/user-center/.test(location.pathname);
            },
            findRefreshButton: function() {
                var headings = document.querySelectorAll('h2');
                for (var i = 0; i < headings.length; i++) {
                    if (/Current Usage/i.test(headings[i].textContent || '')) {
                        var parent = headings[i].parentElement;
                        return parent ? parent.querySelector('button') : null;
                    }
                }
                return null;
            },
            findUsageRows: function() {
                // MiniMax buckets (per operator ground-truth 2026-05-20):
                //   5h bucket  — Text Generation, Image Understanding, Web Search.
                //                Image GENERATION is NOT here — it's media, 24h.
                //                All three 5h rows share one rolling window. Text
                //                Generation's displayed "Resets in N hr M min"
                //                is the canonical truth; the other rows may show
                //                stale/wrong values.
                //   24h bucket — everything else (TTS, video, music, lyrics,
                //                music cover, Image Generation). MiniMax's per-row
                //                displayed reset is unreliable ("20 hr" when
                //                reality is "12 hr 18 min"). The actual reset is
                //                fixed at 12:00 PM Eastern / 9:00 AM Pacific,
                //                computed from the wall clock — DO NOT trust the
                //                per-row text for these.
                var rowEls = Array.from(document.querySelectorAll('div[class*="bg-[#F7F8FA]"]'));
                // Image Understanding must match BEFORE Image Generation falls
                // through to the 24h default. Using a strict word-boundary regex
                // so "Image Generation" never matches the Understanding clause.
                var is5hBucket = function(t) { return /Text\s+Generation|Image\s+Understanding|Web\s+Search/i.test(t); };
                var fiveHourResetText = '';
                rowEls.forEach(function(rowEl) {
                    if (fiveHourResetText) return;
                    var rowText = rowEl.textContent.replace(/\s+/g, ' ');
                    if (!/Text\s+Generation/i.test(rowText)) return;
                    var rm = rowText.match(/Resets\s+in\s+(?:\d+\s*hr)?\s*(?:\d+\s*min)?/i);
                    if (rm) fiveHourResetText = rm[0];
                });
                var dailyResetText = (function() {
                    try {
                        var now = new Date();
                        var tzPart = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset'}).formatToParts(now).find(function(p){return p.type === 'timeZoneName';});
                        var offsetMatch = (tzPart && tzPart.value || '').match(/GMT([+-])(\d{1,2})/);
                        if (!offsetMatch) return '';
                        var offset = parseInt(offsetMatch[2], 10) * (offsetMatch[1] === '+' ? 1 : -1);
                        var nineamPtInUtc = ((9 - offset) % 24 + 24) % 24;
                        var reset = new Date(now);
                        reset.setUTCHours(nineamPtInUtc, 0, 0, 0);
                        if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
                        var totalMin = Math.round((reset - now) / 60000);
                        return 'Resets in ' + Math.floor(totalMin / 60) + ' hr ' + (totalMin % 60) + ' min';
                    } catch (err) { return ''; }
                })();
                var rows = [];
                rowEls.forEach(function(rowEl) {
                    var track = rowEl.querySelector('div[class*="bg-[#F2F3F5]"]');
                    if (!track) return;
                    var fill = track.querySelector('div[style*="width"]');
                    if (!fill) return;
                    var rowText = rowEl.textContent.replace(/\s+/g, ' ');
                    // The displayed "N / M" denominator runs straight into the
                    // "P% Used" span with no whitespace ("...33 / 10033% Used"),
                    // so a greedy \d+ on the row text grabs "10033". Read the
                    // canonical percent from the fill bar's own style.width.
                    var widthMatch = (fill.style.width || '').match(/([\d.]+)%/);
                    if (!widthMatch) return;
                    var percentUsed = parseFloat(widthMatch[1]);
                    var titlePart = (rowText.split(/Usage:/)[0] || '').trim();
                    var resetText, windowHours, isSession;
                    if (is5hBucket(rowText)) {
                        resetText = fiveHourResetText;
                        windowHours = 5;
                        isSession = true;
                    } else {
                        resetText = dailyResetText;
                        windowHours = 24;
                        isSession = false;
                    }
                    rows.push({
                        barElement: track,
                        label: titlePart.toLowerCase().slice(0, 60),
                        percentUsed: percentUsed,
                        fillDirection: 'used',
                        resetText: resetText,
                        windowHours: windowHours,
                        isSession: isSession
                    });
                });
                return rows;
            },
            parseReset: function(text) {
                var m = text.match(/in\s+(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?/i);
                if (!m || (!m[1] && !m[2])) return null;
                var hrsUntil = parseInt(m[1] || 0, 10) + parseInt(m[2] || 0, 10) / 60;
                return {reset: new Date(Date.now() + hrsUntil * 3600000), hrsUntil: hrsUntil};
            }
        },
        gemini: {
            id: 'gemini',
            supportsActiveWindow: false,
            match: function() { return location.hostname === 'gemini.google.com'; },
            isUsagePage: function() {
                return location.pathname === '/usage';
            },
            findUsageRows: function() {
                var rows = [];

                // 1. Current/Hourly/Session Limit
                var currentlyEl = document.querySelector('[data-test-id="gxu-currently"]') || document.querySelector('[data-testid="gxu-currently"]');

                if (currentlyEl) {
                    var currentlyTrack = currentlyEl.querySelector('.progress-track');
                    var currentlyIndicator = currentlyEl.querySelector('.progress-indicator');
                    var currentlyTitle = currentlyEl.querySelector('.current-usage p') || currentlyEl.querySelector('p');
                    var currentlyPercentText = currentlyEl.querySelector('.gxu-item-header > p') || currentlyEl.querySelector('p:nth-of-type(2)');

                    var bar = currentlyTrack || currentlyEl.querySelector('progress, [role="progressbar"], [class*="progressbar"]');
                    if (!bar) {
                        bar = currentlyEl;
                    } else {
                        bar.style.setProperty('position', 'relative', 'important');
                        bar.style.setProperty('overflow', 'visible', 'important');
                        bar.style.setProperty('margin-top', '26px', 'important');
                        bar.style.setProperty('margin-bottom', '26px', 'important');
                    }
                    var pct = parsePercentFromElement(currentlyEl);
                    var resetBlock = findResetBlock(bar) || { resetEl: currentlyEl };
                    var resetTextEl = currentlyEl.querySelector('p[class*="reset"]') || (resetBlock.resetEl || currentlyEl);
                    var resetText = resetTextEl.textContent || '';
                    resetText = resetText.replace(/\s+/g, ' ').trim();
                    if (/resets?/i.test(resetText) && !/\d+[mdh]\s+(?:OVER|UNDER)/i.test(resetText)) {
                        // Use the clean reset text from the dedicated element
                    } else {
                        resetText = resetBlock.resetEl ? (function() {
                            var raw = resetBlock.resetEl.textContent || '';
                            var m = raw.match(/resets?\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm)/i);
                            return m ? m[0] : raw;
                        })() : '';
                    }
                    if (!/resets?/i.test(resetText)) {
                        // Fallback relative resets for Gemini 5-hour rolling limit
                        var now = Date.now();
                        var msIn5h = 5 * 3600 * 1000;
                        var nextReset = Math.ceil(now / msIn5h) * msIn5h;
                        var diffMs = nextReset - now;
                        var diffHrs = Math.floor(diffMs / 3600000);
                        var diffMins = Math.round((diffMs % 3600000) / 60000);
                        resetText = 'Resets in ' + diffHrs + ' hr ' + diffMins + ' min';
                    }
                    var currentlyResetText = resetBlock.resetEl;

                    // Tag elements with custom helper classes so they can be easily queried in the clone
                    if (currentlyTitle) currentlyTitle.classList.add('gxu-title-element');
                    if (currentlyPercentText) currentlyPercentText.classList.add('gxu-percent-element');
                    if (currentlyTrack) currentlyTrack.classList.add('gxu-track-element');
                    if (currentlyIndicator) currentlyIndicator.classList.add('gxu-indicator-element');
                    if (currentlyResetText) currentlyResetText.classList.add('gxu-reset-text-element');

                    rows.push({
                        barElement: bar,
                        label: 'currently',
                        percentUsed: pct !== null ? pct : 0,
                        fillDirection: 'used',
                        resetText: resetText,
                        windowHours: 5,
                        isSession: true
                    });
                }

                // 2. Weekly Limit
                var weeklyEl = document.querySelector('[data-test-id="gxu-weekly"]') || document.querySelector('[data-testid="gxu-weekly"]');
                if (weeklyEl && currentlyEl) {
                    var nativeWrapper = weeklyEl.querySelector('.gxu-weekly-native-hidden');
                    if (!nativeWrapper) {
                        nativeWrapper = document.createElement('div');
                        nativeWrapper.className = 'gxu-weekly-native-hidden';
                        nativeWrapper.style.setProperty('display', 'none', 'important');
                        while (weeklyEl.firstChild) {
                            nativeWrapper.appendChild(weeklyEl.firstChild);
                        }
                        weeklyEl.appendChild(nativeWrapper);
                    }

                    var pctWeekly = parsePercentFromElement(nativeWrapper);
                    var weeklyResetTextEl = weeklyEl.querySelector('p[class*="reset"]') || (nativeWrapper.querySelector('p[class*="reset"]'));
                    var resetTextWeekly = weeklyResetTextEl ? weeklyResetTextEl.textContent : '';
                    if (!/resets?/i.test(resetTextWeekly)) {
                        var resetBlock = findResetBlock(nativeWrapper) || { resetEl: nativeWrapper };
                        resetTextWeekly = resetBlock.resetEl ? (function() {
                            var raw = resetBlock.resetEl.textContent || '';
                            var m = raw.match(/resets?\s+(?:at\s+)?(?:\d{1,2}:\d{2}\s*(?:am|pm)|[a-z]+\s+\d{1,2}(?:\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm))?)/i);
                            return m ? m[0] : raw;
                        })() : '';
                    }
                    if (!/resets?/i.test(resetTextWeekly)) {
                        // Fallback absolute reset for weekly limit
                        resetTextWeekly = 'Resets Sat 10:59 AM';
                    }

                    // Extract and sanitize reset text to avoid duplicate percentage or junk text
                    var m = resetTextWeekly.match(/resets?.*$/i);
                    if (m) {
                        resetTextWeekly = m[0];
                    }
                    resetTextWeekly = resetTextWeekly.replace(/\d+%\s*used/gi, '').replace(/\s+/g, ' ').trim();

                    // Apply same classes and styles to weeklyEl wrapper itself to match currentlyEl container and prevent double margins/padding
                    weeklyEl.className = currentlyEl.className;
                    weeklyEl.style.cssText = currentlyEl.style.cssText;
                    weeklyEl.style.setProperty('display', 'flex', 'important');
                    weeklyEl.style.setProperty('flex-direction', 'column', 'important');
                    weeklyEl.style.setProperty('align-items', 'stretch', 'important');

                    var card = weeklyEl.querySelector('.gxu-weekly-card-injected');
                    var percentText, resetTextEl, bar, fill;
                    if (!card) {
                        card = document.createElement('div');
                        card.className = 'gxu-weekly-card-injected';
                        card.style.width = '100%';
                        card.style.display = 'contents'; // Use 'contents' display to avoid double margin/padding

                        // Clone each child of currentlyEl and append to card
                        for (var i = 0; i < currentlyEl.childNodes.length; i++) {
                            var child = currentlyEl.childNodes[i];
                            if (child.nodeType === Node.ELEMENT_NODE) {
                                // Skip injected items (like reticles, arrows, badges)
                                if (child.getAttribute(ITEM_ATTR) === 'true') continue;
                                if (child.classList.contains('usage-reticle') || child.classList.contains('delta-reticle')) continue;
                            }
                            card.appendChild(child.cloneNode(true));
                        }

                        // Query cloned elements using the tagged helper classes
                        var title = card.querySelector('.gxu-title-element');
                        percentText = card.querySelector('.gxu-percent-element');
                        bar = card.querySelector('.gxu-track-element');
                        fill = card.querySelector('.gxu-indicator-element');
                        resetTextEl = card.querySelector('.gxu-reset-text-element');

                        if (title) title.textContent = 'Weekly limit';
                        
                        if (bar) {
                            bar.style.position = 'relative';
                            bar.style.overflow = 'visible';
                            bar.style.marginTop = '26px';
                            bar.style.marginBottom = '26px';
                            // Ensure any cloned reticles inside are cleaned up
                            bar.querySelectorAll(RETICLE_SELECTOR).forEach(function(el) {
                                el.remove();
                            });
                        }

                        // Remove all other reticles from the card just in case
                        card.querySelectorAll(RETICLE_SELECTOR).forEach(function(el) {
                            el.remove();
                        });

                        weeklyEl.appendChild(card);
                    } else {
                        percentText = card.querySelector('.gxu-percent-element');
                        bar = card.querySelector('.gxu-track-element');
                        fill = card.querySelector('.gxu-indicator-element');
                        resetTextEl = card.querySelector('.gxu-reset-text-element');
                    }

                    if (percentText) {
                        percentText.textContent = (pctWeekly !== null ? pctWeekly : 0) + '% used';
                    }
                    if (fill) {
                        fill.style.width = (pctWeekly !== null ? pctWeekly : 0) + '%';
                    }
                    if (resetTextEl) {
                        resetTextEl.textContent = resetTextWeekly;
                    }
                    if (bar && bar !== weeklyEl) {
                        bar.style.setProperty('position', 'relative', 'important');
                        bar.style.setProperty('overflow', 'visible', 'important');
                        bar.style.setProperty('margin-top', '26px', 'important');
                        bar.style.setProperty('margin-bottom', '26px', 'important');
                    }

                    if (state.settings.geminiScrapingEnabled) {
                        saveScrapedData({
                            currentlyPercent: pct !== null ? pct : 0,
                            weeklyPercent: pctWeekly !== null ? pctWeekly : 0,
                            currentlyReset: resetText || '',
                            weeklyReset: resetTextWeekly || '',
                            timestamp: Date.now()
                        });
                    }

                    rows.push({
                        barElement: bar,
                        label: 'weekly',
                        percentUsed: pctWeekly !== null ? pctWeekly : 0,
                        fillDirection: 'used',
                        resetText: resetTextWeekly,
                        windowHours: 168,
                        isSession: false
                    });
                }

                return rows;
            },
            parseReset: function(text) {
                return parseResetInfo(text);
            }
        }
    };

    function currentPlatform() {
        for (var k in platforms) {
            if (platforms[k].match()) return platforms[k];
        }
        return null;
    }

    function isUsagePage() {
        if (!document.body) return false;
        var p = currentPlatform();
        return !!p && p.isUsagePage();
    }

    function injectStyles() {
        if (document.head.querySelector('style[' + STYLE_ATTR + ']')) return;
        var style = document.createElement('style');
        style.setAttribute(STYLE_ATTR, 'true');
        style.textContent = '.usage-reticle{position:absolute;width:2px;height:100%;background:#3b82f6;box-shadow:0 0 2px rgba(0,0,0,.5);pointer-events:none;z-index:10;top:0}.usage-reticle::after{content:"";position:absolute;left:-3px;bottom:-5px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid #3b82f6}.usage-reticle-label{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);background:#3b82f6;color:#fff;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600;white-space:nowrap}.delta-reticle{position:absolute;width:2px;height:100%;box-shadow:0 0 2px rgba(0,0,0,.5);pointer-events:none;z-index:10;top:0}.delta-reticle::before{content:"";position:absolute;left:-3px;top:-5px;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--reticle-arrow-color,#ef4444)}.delta-reticle-label{position:absolute;top:-22px;left:50%;transform:translateX(-50%);padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600;white-space:nowrap;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.9),0 0 4px rgba(0,0,0,0.7),0 0 8px rgba(0,0,0,0.4);border:1px solid #000}.reticle-overlay{position:absolute;height:100%;top:0;pointer-events:none;z-index:4;border-radius:9999px}.reticle-glow{position:absolute;height:100%;top:0;pointer-events:none;z-index:3;border-radius:9999px}';
        style.textContent += '.usage-reticle-settings{--reticle-panel-bg:rgba(255,250,242,.96);--reticle-panel-border:rgba(116,90,70,.28);--reticle-panel-text:#2f261f;--reticle-panel-muted:#6d5a4b;--reticle-panel-field:#fffaf2;--reticle-panel-field-border:rgba(116,90,70,.32);--reticle-panel-toggle:#7a4b2a;--reticle-panel-toggle-off:#8b8177;--reticle-panel-shadow:0 8px 22px rgba(55,38,24,.08);margin:0 0 16px;padding:12px 14px;border:1px solid var(--reticle-panel-border);border-radius:14px;background:var(--reticle-panel-bg);box-shadow:var(--reticle-panel-shadow);color:var(--reticle-panel-text);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}.usage-reticle-settings[data-reticle-theme="dark"]{--reticle-panel-bg:rgba(38,38,36,.94);--reticle-panel-border:rgba(255,255,255,.16);--reticle-panel-text:#f4f1ea;--reticle-panel-muted:#c9c1b6;--reticle-panel-field:rgba(20,20,19,.92);--reticle-panel-field-border:rgba(255,255,255,.22);--reticle-panel-toggle:#d2b48c;--reticle-panel-toggle-off:#6f6961;--reticle-panel-shadow:0 10px 28px rgba(0,0,0,.26);color-scheme:dark}.usage-reticle-settings button,.usage-reticle-settings input,.usage-reticle-settings select{font:inherit}.usage-reticle-settings__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:nowrap}.usage-reticle-settings__heading{flex:1 1 auto;min-width:0}.usage-reticle-settings__title{font-weight:800;font-size:13px;color:var(--reticle-panel-text)}.usage-reticle-settings__summary{color:var(--reticle-panel-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.usage-reticle-settings__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px}.usage-reticle-settings__group{display:flex;flex-direction:column;gap:5px}.usage-reticle-settings__days{display:flex;flex-wrap:wrap;gap:6px}.usage-reticle-settings label{display:flex;align-items:center;gap:5px;color:var(--reticle-panel-text)}.usage-reticle-settings input[type="time"],.usage-reticle-settings select{border:1px solid var(--reticle-panel-field-border);border-radius:6px;padding:2px 5px;background:var(--reticle-panel-field);color:var(--reticle-panel-text)}.usage-reticle-settings__toggle{flex-shrink:0;padding:4px 10px;border-radius:999px;border:1px solid var(--reticle-panel-border);background:var(--reticle-panel-toggle-off);color:#fff;font-weight:700;cursor:pointer;font-size:11px;transition:background .2s}.usage-reticle-settings__toggle[aria-pressed="true"]{background:var(--reticle-panel-toggle)}.day-boundary-reticle{position:absolute;width:2px;height:100%;background:rgba(116,90,70,.7);pointer-events:none;z-index:5;top:0}.hour-tick-reticle{position:absolute;width:1px;height:50%;bottom:0;background:rgba(116,90,70,.25);pointer-events:none;z-index:3}.day-boundary-label{position:absolute;bottom:-36px;transform:translateX(-50%);color:rgba(116,90,70,.7);font-size:9px;font-weight:700;letter-spacing:.02em;white-space:nowrap;pointer-events:none}';
        style.textContent += '.gxu-bar-injected{width:100%;height:8px;border-radius:4px;margin-top:8px;position:relative;overflow:visible}.gxu-bar-fill{height:100%;border-radius:4px;width:0%;transition:width 0.3s ease}';
        document.head.appendChild(style);
    }

    function normalizeText(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    var currentScopeAttr = null;
    var currentScopeVal = '';

    function copyScopeAttributes(src, dest) {
        if (!dest) return;
        if (src) {
            for (var i = 0; i < src.attributes.length; i++) {
                var attr = src.attributes[i];
                if (attr.name.indexOf('_ngcontent-') === 0) {
                    currentScopeAttr = attr.name;
                    currentScopeVal = attr.value;
                    dest.setAttribute(attr.name, attr.value);
                }
            }
        } else if (currentScopeAttr) {
            dest.setAttribute(currentScopeAttr, currentScopeVal);
        }
    }

    function saveScrapedData(data) {
        var api = extensionApi();
        if (api && api.storage && api.storage.local) {
            try {
                api.storage.local.set({ 'geminiUsageScrapedData': data });
            } catch (err) {}
        }
        try {
            localStorage.setItem('geminiUsageScrapedData', JSON.stringify(data));
        } catch (err) {}
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
        var threshold = state.settings.overBudgetThreshold || 0;
        var raw = Math.min(Math.abs(pct) / 100 * 2, 1);
        var p = 0.35 + 0.65 * raw;
        if (pct <= 0) {
            return 'hsl(142,' + (5 + p * 70) + '%,' + (95 - p * 55) + '%)';
        } else if (pct <= threshold) {
            return 'hsl(38,' + (5 + p * 85) + '%,' + (95 - p * 50) + '%)';
        } else {
            return 'hsl(0,' + (5 + p * 75) + '%,' + (95 - p * 55) + '%)';
        }
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
            if (typeof saved.geminiScrapingEnabled === 'boolean') settings.geminiScrapingEnabled = saved.geminiScrapingEnabled;
            if (typeof saved.geminiRefreshInterval === 'number') settings.geminiRefreshInterval = saved.geminiRefreshInterval;
            if (typeof saved.overBudgetThreshold === 'number') settings.overBudgetThreshold = saved.overBudgetThreshold;
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
            activeEnd: settings.activeEnd,
            geminiScrapingEnabled: settings.geminiScrapingEnabled === undefined ? DEFAULT_SETTINGS.geminiScrapingEnabled : !!settings.geminiScrapingEnabled,
            geminiRefreshInterval: typeof settings.geminiRefreshInterval === 'number' ? settings.geminiRefreshInterval : DEFAULT_SETTINGS.geminiRefreshInterval,
            overBudgetThreshold: typeof settings.overBudgetThreshold === 'number' ? settings.overBudgetThreshold : DEFAULT_SETTINGS.overBudgetThreshold
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
        if (!settings.activeWindowEnabled) return 'Full reset windows.';
        var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
        var ordered = WEEK_ORDER.filter(function(d) { return settings.activeDays.indexOf(d) !== -1; });
        var days = ordered.length === 7 ? 'all days' : ordered.map(function(d) { return DAYS[d]; }).join(', ');
        var hours = settings.activeHoursEnabled ? settings.activeStart + '-' + settings.activeEnd : 'all day';
        return days + ', ' + hours + '.';
    }

    function parseResetInfo(text) {
        if (!text) return null;
        text = normalizeText(text).toLowerCase();

        // 1. Relative "in X hrs Y mins"
        var relative = text.match(/(?:resets?\s*)?in\s*(?:(\d+)\s*d(?:ay)?s?)?\s*(?:(\d+)\s*h(?:ou)?rs?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/);
        if (relative && (relative[1] || relative[2] || relative[3])) {
            var hrsUntil = (parseInt(relative[1] || 0, 10) * 24) +
                           parseInt(relative[2] || 0, 10) +
                           (parseInt(relative[3] || 0, 10) / 60);
            return {
                hrsUntil: hrsUntil,
                reset: new Date(Date.now() + hrsUntil * 3600000)
            };
        }

        // 2. Absolute month + day: "Resets Jun 2 at 12:58 AM"
        var absMonthDay = text.match(/(?:resets?\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d+)(?:\s*,?\s*\d{4})?\s*(?:at\s+)?(\d+):(\d+)\s*(am|pm)?/);
        if (absMonthDay) {
            var monthName = absMonthDay[1].slice(0, 3);
            var MONTH_INDEX = {jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11};
            var month = MONTH_INDEX[monthName];
            var day = parseInt(absMonthDay[2], 10);
            var hour = parseInt(absMonthDay[3], 10);
            var min = parseInt(absMonthDay[4], 10);
            var ampm = absMonthDay[5] ? absMonthDay[5] : null;

            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;

            var now = new Date();
            var reset = new Date(now.getFullYear(), month, day, hour, min, 0, 0);
            // If the reset date is in the past by too much, e.g. next year boundary
            if (reset < now && (now - reset) > 30 * 24 * 3600 * 1000) {
                reset.setFullYear(now.getFullYear() + 1);
            }
            return {
                hrsUntil: (reset - now) / 3600000,
                reset: reset
            };
        }

        // 3. Absolute weekday + time: "Resets Sat 10:59 AM"
        var absWeekday = text.match(/(?:resets?\s*)?(sun|mon|tue|wed|thu|fri|sat)\w*\s+(\d+):(\d+)\s*(am|pm)/);
        if (absWeekday) {
            var hour = parseInt(absWeekday[2], 10);
            var ampm = absWeekday[4];
            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;

            var now = new Date();
            var reset = new Date(now);
            reset.setHours(hour, parseInt(absWeekday[3], 10), 0, 0);

            var deltaDays = DAY_INDEX[absWeekday[1].slice(0, 3)] - now.getDay();
            if (deltaDays < 0) deltaDays += 7;
            if (deltaDays === 0 && reset <= now) deltaDays = 7;
            reset.setDate(now.getDate() + deltaDays);

            return {
                hrsUntil: (reset - now) / 3600000,
                reset: reset
            };
        }

        // 4. Time only: "Resets at 5:58 PM"
        var absTimeOnly = text.match(/(?:resets?\s*at\s+)?(\d+):(\d+)\s*(am|pm)/);
        if (absTimeOnly) {
            var hour = parseInt(absTimeOnly[1], 10);
            var ampm = absTimeOnly[3];
            if (ampm === 'pm' && hour !== 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;

            var now = new Date();
            var reset = new Date(now);
            reset.setHours(hour, parseInt(absTimeOnly[2], 10), 0, 0);

            // If the reset time is in the past, it might be tomorrow's reset
            if (reset <= now && (now - reset) > 2 * 3600 * 1000) {
                reset.setDate(now.getDate() + 1);
            }

            return {
                hrsUntil: (reset - now) / 3600000,
                reset: reset
            };
        }

        return null;
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

    var RESET_RE = /resets?/i;
    var WEEKDAY_TIME_RE = /^(?:mon|tue|wed|thu|fri|sat|sun)\s+\d{1,2}:\d{2}\s*(?:am|pm)?$/i;

    function findResetBlock(bar) {
        var node = bar.parentElement;
        for (var depth = 0; depth < 10 && node; depth++) {
            var nodes = node.querySelectorAll('span, div, p, small, font');
            for (var i = 0; i < nodes.length; i++) {
                var nc = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
                if (RESET_RE.test(nc) || (depth > 0 && WEEKDAY_TIME_RE.test(nc))) {
                    return {block: node, resetEl: nodes[i]};
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
            if (resetEl && (resetEl.contains(span) || span.contains(resetEl))) {
                if (span.contains(resetEl)) continue;
                var candidate = normalizeText(span.textContent || '');
                if (!candidate || /resets?/i.test(candidate)) continue;
                var candidateKey = normalizeKey(candidate);
                if (getWindowHours(candidateKey)) return span;
                continue;
            }
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

    function parsePercentFromElement(el) {
        if (!el) return null;
        var prog = el.querySelector('progress');
        if (prog) {
            var val = parseFloat(prog.value);
            var max = parseFloat(prog.max || 1);
            if (!isNaN(val) && max > 0) return clampPct((val / max) * 100);
        }
        var pb = el.querySelector('[role="progressbar"]');
        if (pb) {
            var val = parseFloat(pb.getAttribute('aria-valuenow'));
            var max = parseFloat(pb.getAttribute('aria-valuemax') || 100);
            if (!isNaN(val) && max > 0) return clampPct((val / max) * 100);
        }
        var text = normalizeText(el.textContent);
        var pctMatch = text.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) return clampPct(parseFloat(pctMatch[1]));
        var fracMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:\/|out\s+of)\s*(\d+(?:\.\d+)?)/i);
        if (fracMatch) {
            var val = parseFloat(fracMatch[1]);
            var max = parseFloat(fracMatch[2]);
            if (max > 0) return clampPct((val / max) * 100);
        }
        return null;
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

        // Aggregate active ms per JS day-of-week (0=Sun..6=Sat) so a Sunday split
        // across the window boundary collapses into one slice.
        var perDow = [0, 0, 0, 0, 0, 0, 0];
        var day = startOfDay(start);
        if (day.getTime() > start.getTime()) day.setDate(day.getDate() - 1);
        var guard = 0;
        while (day.getTime() < end.getTime() && guard < 14) {
            var segs = getActiveSegmentsForDay(day, settings);
            for (var i = 0; i < segs.length; i++) {
                var ovStart = Math.max(segs[i].start.getTime(), start.getTime());
                var ovEnd = Math.min(segs[i].end.getTime(), end.getTime());
                if (ovEnd > ovStart) perDow[day.getDay()] += ovEnd - ovStart;
            }
            day.setDate(day.getDate() + 1);
            guard++;
        }

        // Render in user-week order (Mon=0..Sun=6).
        var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
        var cumulativeBefore = 0;
        for (var w = 0; w < WEEK_ORDER.length; w++) {
            var jsDow = WEEK_ORDER[w];
            var dayActiveMs = perDow[jsDow];
            if (dayActiveMs <= 0) continue;

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
            label.textContent = DAYS[jsDow];
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

        // React's reconciler can wipe the reticle children we appended while leaving
        // the SIGNATURE_ATTR on the bar element intact (attributes survive
        // reconciliation in a way that injected children do not). Treat the cache
        // as hit only when BOTH the signature matches AND at least one reticle
        // child is still present; otherwise fall through to a full re-render.
        if (bar.getAttribute(SIGNATURE_ATTR) === signature && bar.querySelector('[' + ITEM_ATTR + ']')) return true;
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
        if (location.hostname === 'gemini.google.com') {
            return document.querySelector('[data-test-id="gxu-weekly"]') || document.querySelector('[data-testid="gxu-weekly"]');
        }
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

        var geminiScraping = panel.querySelector('[data-reticle-gemini-scraping]');
        var geminiRefreshInterval = panel.querySelector('[data-reticle-gemini-refresh-interval]');
        var refreshIntervalVal = panel.querySelector('[data-reticle-refresh-interval-val]');
        var overBudgetThreshold = panel.querySelector('[data-reticle-over-budget-threshold]');
        var thresholdVal = panel.querySelector('[data-reticle-threshold-val]');

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

        if (geminiScraping) geminiScraping.checked = !!settings.geminiScrapingEnabled;
        if (geminiRefreshInterval) geminiRefreshInterval.value = settings.geminiRefreshInterval || 30;
        if (refreshIntervalVal) refreshIntervalVal.textContent = (settings.geminiRefreshInterval || 30) + ' mins';
        if (overBudgetThreshold) overBudgetThreshold.value = settings.overBudgetThreshold || 0;
        if (thresholdVal) thresholdVal.textContent = (settings.overBudgetThreshold || 0) + '%';
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
        panel.innerHTML = '<div class="usage-reticle-settings__top"><div class="usage-reticle-settings__heading"><div class="usage-reticle-settings__title">Usage Reticle Budget Window</div><div class="usage-reticle-settings__summary" data-reticle-summary></div></div><button type="button" class="usage-reticle-settings__toggle" data-reticle-toggle></button></div>' +
            '<div class="usage-reticle-settings__grid">' +
                '<div class="usage-reticle-settings__group"><span>Active days</span><div class="usage-reticle-settings__days" data-reticle-days></div></div>' +
                '<div class="usage-reticle-settings__group"><label><input type="checkbox" data-reticle-hours-enabled> Limit active hours</label><div class="usage-reticle-settings__time"><input type="time" data-reticle-start> <span>to</span> <input type="time" data-reticle-end></div></div>' +
            '</div>' +
            '<div class="usage-reticle-settings__gemini" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(128,128,128,0.2); display: flex; flex-direction: column; gap: 8px;">' +
                '<div class="usage-reticle-settings__title" style="font-weight: bold; font-size: 12px;">Google Gemini Settings</div>' +
                '<label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" data-reticle-gemini-scraping> Enable local scraping & logging</label>' +
                '<div style="display: flex; flex-direction: column; gap: 2px;">' +
                    '<div style="display: flex; justify-content: space-between; font-size: 11px;"><span>Refresh Interval:</span><span data-reticle-refresh-interval-val>30 mins</span></div>' +
                    '<input type="range" min="5" max="120" step="5" data-reticle-gemini-refresh-interval style="width: 100%; cursor: pointer;">' +
                '</div>' +
                '<div style="display: flex; flex-direction: column; gap: 2px;">' +
                    '<div style="display: flex; justify-content: space-between; font-size: 11px;"><span>Over-budget Color Threshold:</span><span data-reticle-threshold-val>0%</span></div>' +
                    '<input type="range" min="0" max="50" step="5" data-reticle-over-budget-threshold style="width: 100%; cursor: pointer;">' +
                '</div>' +
            '</div>';

        var days = panel.querySelector('[data-reticle-days]');
        var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
        WEEK_ORDER.forEach(function(jsDay) {
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" data-reticle-day value="' + jsDay + '"> ' + DAY_NAMES[jsDay].slice(0, 3);
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

        var geminiScraping = panel.querySelector('[data-reticle-gemini-scraping]');
        var geminiRefreshInterval = panel.querySelector('[data-reticle-gemini-refresh-interval]');
        var refreshIntervalVal = panel.querySelector('[data-reticle-refresh-interval-val]');
        var overBudgetThreshold = panel.querySelector('[data-reticle-over-budget-threshold]');
        var thresholdVal = panel.querySelector('[data-reticle-threshold-val]');

        if (geminiScraping) {
            geminiScraping.addEventListener('change', function(event) {
                state.settings.geminiScrapingEnabled = event.target.checked;
                saveSettings();
                updateControls();
                scheduleRefresh(0);
            });
        }
        if (geminiRefreshInterval) {
            geminiRefreshInterval.addEventListener('input', function(event) {
                var val = parseInt(event.target.value, 10) || 30;
                if (refreshIntervalVal) refreshIntervalVal.textContent = val + ' mins';
            });
            geminiRefreshInterval.addEventListener('change', function(event) {
                state.settings.geminiRefreshInterval = parseInt(event.target.value, 10) || 30;
                saveSettings();
                updateControls();
                scheduleRefresh(0);
            });
        }
        if (overBudgetThreshold) {
            overBudgetThreshold.addEventListener('input', function(event) {
                var val = parseInt(event.target.value, 10) || 0;
                if (thresholdVal) thresholdVal.textContent = val + '%';
            });
            overBudgetThreshold.addEventListener('change', function(event) {
                state.settings.overBudgetThreshold = parseInt(event.target.value, 10) || 0;
                saveSettings();
                updateControls();
                scheduleRefresh(0);
            });
        }

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

        // Non-Claude platforms: simpler renderer, no settings panel, no active-window.
        var platform = currentPlatform();
        if (platform && platform.id !== 'claude') {
            return finishRender(renderForPlatform(platform));
        }

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

    function renderForPlatform(platform) {
        var rows = (typeof platform.findUsageRows === 'function') ? (platform.findUsageRows() || []) : [];
        var added = 0;
        rows.forEach(function(row) {
            if (!row || !row.barElement) return;
            var resetInfo = (typeof platform.parseReset === 'function') ? platform.parseReset(row.resetText || '') : null;
            if (!resetInfo) return;
            if (renderGenericBar(row, resetInfo, platform.id)) added++;
        });
        return added;
    }

    function renderGenericBar(row, resetInfo, platformId) {
        var bar = row.barElement;
        var usagePos = clampPct(row.percentUsed);
        var metrics = getBudgetMetrics(row.windowHours, resetInfo, false);
        var nowPos = metrics.nowPos;
        var diffPct = usagePos - nowPos;
        var color = getColor(diffPct);
        var raw = Math.min(Math.abs(diffPct) / 100 * 2, 1);
        var intensity = 0.35 + 0.65 * raw;

        var host = bar;
        var tagName = (bar.tagName || '').toLowerCase();
        if (tagName === 'progress' || tagName.indexOf('progressbar') !== -1 || tagName.indexOf('progress-bar') !== -1) {
            host = bar.parentElement;
        }

        // Bar-coordinate mapping respects fillDirection: "remaining" platforms (Codex)
        // have bars that fill left-to-right with what's LEFT, so a "% used" position
        // becomes (100 - %used) on the bar.
        var flip = row.fillDirection === 'remaining';
        var toBar = function(pct) { return flip ? (100 - pct) : pct; };

        var signature = [
            Math.round(usagePos * 10),
            Math.round(nowPos * 10),
            Math.round(diffPct * 10),
            Math.round(metrics.totalHours * 10),
            Math.round(resetInfo.reset.getTime() / 60000),
            row.fillDirection || 'used'
        ].join('|');

        if (host.getAttribute(SIGNATURE_ATTR) === signature && host.querySelector('[' + ITEM_ATTR + ']')) return true;
        clearBar(host);
        host.setAttribute(SIGNATURE_ATTR, signature);

        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        // MiniMax (and possibly others) ship overflow-hidden with !important via their
        // utility-CSS framework, which clips our absolutely-positioned children. Force
        // the override with !important so the reticles render outside the bar bounds.
        host.style.setProperty('overflow', 'visible', 'important');

        if (platformId && platformId !== 'claude') {
            host.style.setProperty('margin-top', '26px', 'important');
            host.style.setProperty('margin-bottom', '26px', 'important');
        }

        var usageTime = metrics.dateAtPct(usagePos);
        var diffHrs = (diffPct / 100) * metrics.totalHours;

        // Glow + overlay between nowPos and usagePos (in bar coordinates)
        var nowOnBar = toBar(nowPos);
        var usageOnBar = toBar(usagePos);
        var overlayLeft = Math.min(nowOnBar, usageOnBar);
        var overlayWidth = Math.abs(nowOnBar - usageOnBar);

        // Blue "on-track used" segment: the portion of the bar that's been used
        // up to the lesser of (now, usage). Only red/green is allowed between
        // the two reticles; everything used to the left of that band must be
        // blue. Without this overlay, the host page's native fill (MiniMax
        // paints red on over-budget rows, green on under-budget rows) shows
        // through and the eye reads the whole bar as that single color. Only
        // applied for fillDirection === 'used' platforms; 'remaining' bars
        // (Codex) have an inverted visual model and are left untouched.
        if (!flip) {
            var trackedWidth = Math.min(nowOnBar, usageOnBar);
            if (trackedWidth > 0.1) {
                var tracked = createItem('reticle-overlay');
                tracked.style.left = '0%';
                tracked.style.width = trackedWidth + '%';
                tracked.style.background = 'hsla(217, 91%, 60%, 0.75)';
                host.appendChild(tracked);
            }
        }

        if (overlayWidth > 0.1) {
            if (diffPct > 0) {
                var glow = createItem('reticle-glow');
                glow.style.left = overlayLeft + '%';
                glow.style.width = overlayWidth + '%';
                glow.style.boxShadow = '0 0 ' + (8 + intensity * 15) + 'px ' + (2 + intensity * 5) + 'px hsla(0,' + (50 + intensity * 30) + '%,' + (50 - intensity * 10) + '%,' + (0.4 + intensity * 0.4) + ')';
                host.appendChild(glow);

                var over = createItem('reticle-overlay');
                over.style.left = overlayLeft + '%';
                over.style.width = overlayWidth + '%';
                over.style.background = 'hsla(0,' + (60 + intensity * 20) + '%,' + (40 - intensity * 10) + '%,' + (0.55 + intensity * 0.25) + ')';
                host.appendChild(over);
            } else if (diffPct < 0) {
                var under = createItem('reticle-overlay');
                under.style.left = overlayLeft + '%';
                under.style.width = overlayWidth + '%';
                under.style.background = 'hsla(142,' + (40 + intensity * 30) + '%,' + (50 - intensity * 10) + '%,' + (0.4 + intensity * 0.35) + ')';
                host.appendChild(under);
            }
        }

        var delta = createItem('delta-reticle');
        delta.style.left = nowOnBar + '%';
        delta.style.background = color;
        delta.style.setProperty('--reticle-arrow-color', color);
        var deltaLabel = document.createElement('div');
        deltaLabel.className = 'delta-reticle-label';
        deltaLabel.style.background = color;
        deltaLabel.textContent = fmtDelta(diffHrs, diffPct);
        delta.appendChild(deltaLabel);
        host.appendChild(delta);

        var usage = createItem('usage-reticle');
        usage.style.left = usageOnBar + '%';
        var usageLabel = document.createElement('div');
        usageLabel.className = 'usage-reticle-label';
        usageLabel.textContent = fmtTime(usageTime, !!row.isSession);
        usage.appendChild(usageLabel);
        host.appendChild(usage);

        return true;
    }

    init();
})();
