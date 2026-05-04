(function() {
    'use strict';

    var api = typeof browser !== 'undefined' ? browser : chrome;

    function setBadge(tabId, active) {
        if (!api.action || !tabId) return;

        api.action.setBadgeText({tabId: tabId, text: active ? 'ON' : ''});
        api.action.setBadgeBackgroundColor({tabId: tabId, color: active ? '#2f7d32' : '#777777'});
        api.action.setTitle({
            tabId: tabId,
            title: active ? 'Claude Usage Reticle active' : 'Claude Usage Reticle inactive'
        });
    }

    if (api.runtime && api.runtime.onMessage) {
        api.runtime.onMessage.addListener(function(message, sender) {
            if (!message || message.type !== 'claude-usage-reticle:status') return;
            setBadge(sender && sender.tab && sender.tab.id, !!message.active);
        });
    }
})();
