// ==UserScript==
// @name         Claude Usage Reticle
// @namespace    https://github.com/KatsuJinCode
// @version      1.5
// @description  Visual time-progress marker showing where your Claude usage SHOULD be based on time elapsed in the reset window
// @author       KatsuJinCode
// @match        https://claude.ai/*
// @icon         https://claude.ai/favicon.ico
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/KatsuJinCode/claude-usage-reticle
// @supportURL   https://github.com/KatsuJinCode/claude-usage-reticle/issues
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var style = document.createElement('style');
    style.textContent = '.time-reticle{position:absolute;width:2px;height:100%;background-color:#dc2626;box-shadow:0 0 2px rgba(0,0,0,0.5);pointer-events:none;z-index:10;top:0}.time-reticle::before{content:"";position:absolute;top:-5px;left:-3px;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #dc2626}.time-reticle::after{content:"";position:absolute;bottom:-5px;left:-3px;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:5px solid #dc2626}.time-reticle-label{position:absolute;top:-20px;left:50%;transform:translateX(-50%);background:#dc2626;color:white;padding:1px 4px;border-radius:2px;font-size:9px;font-weight:600}';
    document.head.appendChild(style);

    function addReticles() {
        var containers = document.querySelectorAll('div.flex.flex-row.gap-x-8.justify-between.items-center');
        var added = 0;

        containers.forEach(function(c) {
            var p = c.querySelector('p.text-text-400.whitespace-nowrap');
            if (!p) return;
            var t = p.textContent;
            if (!t.match(/resets?\s/i)) return;

            var bar = c.querySelector('div.bg-bg-000.rounded.border.h-4');
            if (!bar) return;

            var titleEl = c.querySelector('p.text-text-100');
            var isSession = titleEl && titleEl.textContent.toLowerCase().includes('current session');
            var windowHrs = isSession ? 5 : 168;
            var hrsUntil;

            var m1 = t.match(/in\s+(?:(\d+)\s*hr?)?\s*(?:(\d+)\s*min)?/i);
            if (m1 && (m1[1] || m1[2])) {
                hrsUntil = parseInt(m1[1] || 0) + (parseInt(m1[2] || 0) / 60);
            } else {
                var m2 = t.match(/(sun|mon|tue|wed|thu|fri|sat)\w*\s+(\d+):(\d+)\s*(am|pm)/i);
                if (!m2) return;
                var h = parseInt(m2[2]);
                if (m2[4].toLowerCase() === 'pm' && h !== 12) h += 12;
                if (m2[4].toLowerCase() === 'am' && h === 12) h = 0;
                var di = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
                var rd = di[m2[1].toLowerCase().slice(0,3)];
                var now = new Date();
                var reset = new Date();
                reset.setHours(h, parseInt(m2[3]), 0, 0);
                var d = rd - now.getDay();
                if (d < 0) d += 7;
                if (d === 0 && reset <= now) d = 7;
                reset.setDate(now.getDate() + d);
                hrsUntil = (reset - now) / 3600000;
            }

            var pos = Math.max(0, Math.min(100, ((windowHrs - hrsUntil) / windowHrs) * 100));

            bar.style.position = 'relative';
            bar.style.overflow = 'visible';
            var old = bar.querySelector('.time-reticle');
            if (old) old.remove();
            var r = document.createElement('div');
            r.className = 'time-reticle';
            r.style.left = pos + '%';
            var lbl = document.createElement('div');
            lbl.className = 'time-reticle-label';
            lbl.textContent = 'NOW';
            r.appendChild(lbl);
            bar.appendChild(r);
            added++;
        });

        return added;
    }

    // Initial attempt
    var count = addReticles();

    // Retry if nothing found (page still loading)
    if (count === 0) {
        var attempts = 0;
        var interval = setInterval(function() {
            attempts++;
            if (addReticles() > 0 || attempts >= 10) {
                clearInterval(interval);
            }
        }, 1000);
    }

    // Watch for SPA navigation
    var lastUrl = location.href;
    new MutationObserver(function() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(addReticles, 1000);
        }
    }).observe(document.body, {childList: true, subtree: true});

})();
