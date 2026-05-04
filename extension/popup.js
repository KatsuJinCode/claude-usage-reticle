(function() {
    'use strict';

    var STORAGE_KEY = 'claudeUsageReticleExtensionSettings';
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var DEFAULT_SETTINGS = {
        activeWindowEnabled: false,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        activeHoursEnabled: false,
        activeStart: '09:00',
        activeEnd: '18:00'
    };
    var api = typeof browser !== 'undefined' ? browser : chrome;
    var state = {
        enabled: true,
        settings: copySettings(DEFAULT_SETTINGS)
    };

    var els = {
        enabled: document.getElementById('enabled'),
        windowEnabled: document.getElementById('window-enabled'),
        summary: document.getElementById('summary'),
        days: document.getElementById('days'),
        hoursEnabled: document.getElementById('hours-enabled'),
        start: document.getElementById('start'),
        end: document.getElementById('end')
    };

    DAYS.forEach(function(day, index) {
        var label = document.createElement('label');
        label.innerHTML = '<input type="checkbox" data-day value="' + index + '"> ' + day;
        els.days.appendChild(label);
    });

    load(function() {
        render();
        bind();
    });

    function copySettings(settings) {
        settings = settings || DEFAULT_SETTINGS;
        return {
            activeWindowEnabled: !!settings.activeWindowEnabled,
            activeDays: Array.isArray(settings.activeDays) && settings.activeDays.length ? settings.activeDays.slice() : DEFAULT_SETTINGS.activeDays.slice(),
            activeHoursEnabled: !!settings.activeHoursEnabled,
            activeStart: /^\d{2}:\d{2}$/.test(settings.activeStart || '') ? settings.activeStart : DEFAULT_SETTINGS.activeStart,
            activeEnd: /^\d{2}:\d{2}$/.test(settings.activeEnd || '') ? settings.activeEnd : DEFAULT_SETTINGS.activeEnd
        };
    }

    function normalize(saved) {
        saved = saved || {};
        return {
            enabled: saved.enabled !== false,
            settings: copySettings(saved.settings)
        };
    }

    function load(callback) {
        function done(items) {
            state = normalize(items && items[STORAGE_KEY]);
            callback();
        }

        if (typeof browser !== 'undefined' && api === browser) {
            api.storage.local.get(STORAGE_KEY).then(done, function() { callback(); });
        } else {
            api.storage.local.get([STORAGE_KEY], done);
        }
    }

    function save() {
        var payload = {};
        payload[STORAGE_KEY] = state;
        api.storage.local.set(payload);
    }

    function describe() {
        var settings = state.settings;
        if (!settings.activeWindowEnabled) return 'Using full reset windows.';
        var days = settings.activeDays.map(function(day) { return DAYS[day]; }).join(', ');
        var hours = settings.activeHoursEnabled ? settings.activeStart + '-' + settings.activeEnd : 'all day';
        return 'Custom window compresses weekly budget into ' + days + ', ' + hours + '.';
    }

    function render() {
        els.enabled.setAttribute('aria-pressed', String(state.enabled));
        els.enabled.textContent = state.enabled ? 'On' : 'Off';
        els.windowEnabled.setAttribute('aria-pressed', String(state.settings.activeWindowEnabled));
        els.windowEnabled.textContent = state.settings.activeWindowEnabled ? 'On' : 'Off';
        els.summary.textContent = describe();
        els.hoursEnabled.checked = state.settings.activeHoursEnabled;
        els.start.value = state.settings.activeStart;
        els.end.value = state.settings.activeEnd;

        els.days.querySelectorAll('[data-day]').forEach(function(input) {
            input.checked = state.settings.activeDays.indexOf(parseInt(input.value, 10)) !== -1;
        });
    }

    function update(mutator) {
        mutator();
        save();
        render();
    }

    function bind() {
        els.enabled.addEventListener('click', function() {
            update(function() { state.enabled = !state.enabled; });
        });
        els.windowEnabled.addEventListener('click', function() {
            update(function() { state.settings.activeWindowEnabled = !state.settings.activeWindowEnabled; });
        });
        els.hoursEnabled.addEventListener('change', function(event) {
            update(function() {
                state.settings.activeWindowEnabled = true;
                state.settings.activeHoursEnabled = event.target.checked;
            });
        });
        els.start.addEventListener('change', function(event) {
            update(function() {
                state.settings.activeWindowEnabled = true;
                state.settings.activeHoursEnabled = true;
                state.settings.activeStart = event.target.value || DEFAULT_SETTINGS.activeStart;
            });
        });
        els.end.addEventListener('change', function(event) {
            update(function() {
                state.settings.activeWindowEnabled = true;
                state.settings.activeHoursEnabled = true;
                state.settings.activeEnd = event.target.value || DEFAULT_SETTINGS.activeEnd;
            });
        });
        els.days.querySelectorAll('[data-day]').forEach(function(input) {
            input.addEventListener('change', function() {
                update(function() {
                    state.settings.activeWindowEnabled = true;
                    state.settings.activeDays = Array.prototype.slice.call(els.days.querySelectorAll('[data-day]:checked')).map(function(checked) {
                        return parseInt(checked.value, 10);
                    });
                    if (!state.settings.activeDays.length) state.settings.activeDays = [new Date().getDay()];
                });
            });
        });
    }
})();
