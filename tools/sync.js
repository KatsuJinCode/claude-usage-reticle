#!/usr/bin/env node
'use strict';
//
// sync.js — single-source-of-truth enforcer for the Claude Usage Reticle artifacts.
//
// The project ships the same selector/finder logic in three artifacts that have
// historically drifted:
//   1. usage-reticle.user.js              (canonical source — Tampermonkey userscript)
//   2. extension/content/usage-reticle.content.js  (browser extension content script)
//   3. bookmarklet.html                   (zero-install bookmarklet, embedded core)
//
// Only the fragile, breakage-prone pieces are synchronized: the bar selectors
// and the reset-block/title finder functions. These are the regions where DOM
// changes on claude.ai have repeatedly broken all three at once. The rest of
// each artifact (multi-provider router, settings panel, rendering) is allowed
// to differ intentionally — the extension has a trimmed panel, the bookmarklet
// is a lean single-platform build — so we do NOT whole-file sync.
//
// Marked regions in the canonical source:
//
//     // @sync-region <name>
//     ...content...
//     // @sync-end
//
// The same markers must appear in each target. This script extracts the content
// of every region from the canonical source and overwrites the matching region
// in each target so the three can never diverge.
//
// Usage:
//   node tools/sync.js            # write targets to match the source (default)
//   node tools/sync.js --check    # exit 1 if any target region is out of sync; no writes
//   node tools/sync.js --help     # this banner
//
// The pre-commit hook (tools/hooks/pre-commit) runs `--check`.
//

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var SOURCE = 'usage-reticle.user.js';
var TARGETS = [
    'extension/content/usage-reticle.content.js',
    'bookmarklet.html'
];

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Extract {name -> body} for every @sync-region in a file. Body is the text
// strictly between the open and close marker lines (markers excluded), so the
// comparison is on content, not on whether a file happens to carry markers.
function extractRegions(text) {
    var regions = {};
    var lines = text.split('\n');
    var i = 0;
    while (i < lines.length) {
        var open = lines[i].match(/@sync-region\s+(\S+)/);
        if (!open) { i++; continue; }
        var name = open[1];
        var body = [];
        i++;
        while (i < lines.length && lines[i].indexOf('@sync-end') === -1) {
            body.push(lines[i]);
            i++;
        }
        if (i >= lines.length) {
            throw new Error('Region "' + name + '" has no @sync-end marker');
        }
        regions[name] = body.join('\n');
        i++; // consume the @sync-end line
    }
    return regions;
}

// Replace the body of a named region in `text` with `newBody`. Preserves the
// marker lines and any indentation on them. Throws if the region is missing or
// appears more than once (a duplicate would mean the sync itself is broken).
function replaceRegion(text, name, newBody) {
    var lines = text.split('\n');
    var start = -1, end = -1;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp('@sync-region\\s+' + name + '\\b'))) {
            if (start !== -1) {
                throw new Error('Region "' + name + '" appears more than once');
            }
            start = i;
        } else if (start !== -1 && lines[i].indexOf('@sync-end') !== -1) {
            end = i;
            break;
        }
    }
    if (start === -1) {
        throw new Error('Target is missing @sync-region ' + name);
    }
    if (end === -1) {
        throw new Error('Region "' + name + '" has no @sync-end marker');
    }
    var before = lines.slice(0, start + 1);
    var after = lines.slice(end);
    return before.concat(newBody.split('\n'), after).join('\n');
}

function main() {
    var argv = process.argv.slice(2);
    if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
        process.stdout.write(fs.readFileSync(__filename, 'utf8').replace(/^#!.*\n/, ''));
        return 0;
    }
    var check = argv.indexOf('--check') !== -1;

    var srcText = read(SOURCE);
    var srcRegions = extractRegions(srcText);
    var names = Object.keys(srcRegions).sort();
    if (names.length === 0) {
        console.error('sync: no @sync-region found in ' + SOURCE);
        return 1;
    }

    var drift = false;

    TARGETS.forEach(function (rel) {
        var text = read(rel);
        var changed = false;
        names.forEach(function (name) {
            var canonical = srcRegions[name];
            try {
                var current = extractRegions(text)[name];
                if (current === canonical) return; // already in sync
                if (check) {
                    console.error('sync: DRIFT in ' + rel + ' region "' + name + '"');
                    drift = true;
                    return;
                }
                text = replaceRegion(text, name, canonical);
                changed = true;
                console.log('sync: updated ' + rel + ' region "' + name + '"');
            } catch (err) {
                console.error('sync: ' + rel + ' — ' + err.message);
                drift = true;
            }
        });
        if (changed) {
            fs.writeFileSync(path.join(ROOT, rel), text);
        }
    });

    if (check && drift) {
        console.error('sync: drift detected — run `node tools/sync.js` and re-commit');
        return 1;
    }
    if (!check) {
        console.log('sync: all ' + TARGETS.length + ' target(s) match ' + SOURCE);
    } else {
        console.log('sync: no drift (' + names.length + ' region(s), ' + TARGETS.length + ' target(s))');
    }
    return 0;
}

process.exit(main());
