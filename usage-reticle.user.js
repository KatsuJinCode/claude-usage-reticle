// ==UserScript==
// @name         Claude Usage Time Reticle
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Overlay time-progress reticle on Claude.ai usage bars showing where usage SHOULD be
// @author       Claude Usage Visual Inject
// @match        https://claude.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
        .time-reticle {
            position: absolute;
            width: 2px;
            height: 100%;
            background-color: #dc2626;
            box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
            pointer-events: none;
            z-index: 10;
            top: 0;
            border-radius: 1px;
        }

        .time-reticle::before {
            content: '';
            position: absolute;
            top: -5px;
            left: -3px;
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-top: 5px solid #dc2626;
        }

        .time-reticle::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: -3px;
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-bottom: 5px solid #dc2626;
        }

        .time-reticle-label {
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            background: #dc2626;
            color: white;
            padding: 1px 4px;
            border-radius: 2px;
            font-size: 9px;
            font-weight: 600;
            white-space: nowrap;
            letter-spacing: 0.5px;
        }
    `);

    const HOURS_IN_WEEK = 168;
    const HOURS_IN_SESSION = 5;  // Current session is 5-hour window
    const DEBUG = false;

    function log(...args) {
        if (DEBUG) console.log('[UsageReticle]', ...args);
    }

    /**
     * Parse reset time text and return hours until reset
     */
    function parseHoursUntilReset(resetText) {
        log('Parsing reset text:', resetText);

        // Handle "Resets in X hr Y min" format
        const inMatch = resetText.match(/resets?\s+in\s+(?:(\d+)\s*hr?)?\s*(?:(\d+)\s*min)?/i);
        if (inMatch && (inMatch[1] || inMatch[2])) {
            const hours = parseInt(inMatch[1] || 0);
            const minutes = parseInt(inMatch[2] || 0);
            return hours + (minutes / 60);
        }

        // Handle "Resets Day HH:MM AM/PM" format
        const dayMatch = resetText.match(/resets?\s+(sun|mon|tue|wed|thu|fri|sat)\w*\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (dayMatch) {
            const dayName = dayMatch[1].toLowerCase().substring(0, 3);
            let hours = parseInt(dayMatch[2]);
            const minutes = parseInt(dayMatch[3]);
            const ampm = dayMatch[4].toLowerCase();

            if (ampm === 'pm' && hours !== 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            const dayIndex = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
            const resetDayOfWeek = dayIndex[dayName];

            const now = new Date();
            const resetDate = new Date();
            resetDate.setHours(hours, minutes, 0, 0);

            const currentDay = now.getDay();
            let daysUntilReset = resetDayOfWeek - currentDay;
            if (daysUntilReset < 0) daysUntilReset += 7;
            if (daysUntilReset === 0 && resetDate <= now) daysUntilReset = 7;

            resetDate.setDate(now.getDate() + daysUntilReset);

            const msUntilReset = resetDate - now;
            return msUntilReset / (1000 * 60 * 60);
        }

        return null;
    }

    /**
     * Calculate reticle position based on hours until reset and window size
     */
    function calculateReticlePosition(hoursUntilReset, windowHours) {
        if (hoursUntilReset === null) return null;
        const hoursSinceReset = windowHours - hoursUntilReset;
        const position = (hoursSinceReset / windowHours) * 100;
        return Math.max(0, Math.min(100, position));
    }

    /**
     * Add reticle to a progress bar element
     */
    function addReticleToBar(barTrack, position) {
        const computedStyle = window.getComputedStyle(barTrack);
        if (computedStyle.position === 'static') {
            barTrack.style.position = 'relative';
        }
        barTrack.style.overflow = 'visible';

        const existing = barTrack.querySelector('.time-reticle');
        if (existing) existing.remove();

        const reticle = document.createElement('div');
        reticle.className = 'time-reticle';
        reticle.style.left = `${position}%`;

        const label = document.createElement('div');
        label.className = 'time-reticle-label';
        label.textContent = 'NOW';
        reticle.appendChild(label);

        barTrack.appendChild(reticle);
        log('Added reticle at', position.toFixed(1) + '%');
    }

    /**
     * Detect if this is a current session bar (5hr) or weekly bar (168hr)
     */
    function getWindowHours(container) {
        const titleEl = container.querySelector('p.text-text-100');
        if (titleEl && titleEl.textContent.toLowerCase().includes('current session')) {
            return HOURS_IN_SESSION;
        }
        return HOURS_IN_WEEK;
    }

    /**
     * Find usage sections and add reticles
     */
    function processUsageBars() {
        log('Processing usage bars...');

        const containers = document.querySelectorAll('div.flex.flex-row.gap-x-8.justify-between.items-center');

        log('Found containers:', containers.length);

        containers.forEach((container, idx) => {
            const resetTextEl = container.querySelector('p.text-text-400.whitespace-nowrap');
            if (!resetTextEl) return;

            const resetText = resetTextEl.textContent.trim();
            if (!resetText.match(/resets?\s+(in|sun|mon|tue|wed|thu|fri|sat)/i)) return;

            const barTrack = container.querySelector('div.bg-bg-000.rounded.border.h-4');
            if (!barTrack) {
                log('No bar track found in container', idx);
                return;
            }

            const windowHours = getWindowHours(container);
            const hoursUntilReset = parseHoursUntilReset(resetText);

            if (hoursUntilReset === null) {
                log('Could not parse reset time:', resetText);
                return;
            }

            const position = calculateReticlePosition(hoursUntilReset, windowHours);
            log('Container', idx, '- Window:', windowHours + 'hr', '- Reset:', resetText, '- Position:', position.toFixed(1) + '%');

            addReticleToBar(barTrack, position);
        });
    }

    function init() {
        log('Initializing Usage Reticle v1.2...');

        setTimeout(processUsageBars, 1000);

        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(processUsageBars, 1000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        setInterval(processUsageBars, 60000);
    }

    init();
})();
