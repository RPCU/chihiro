// Shared utility functions used across the dashboard.

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// escapeJs escapes a value for safe interpolation inside a single-quoted
// JavaScript string literal embedded in an inline HTML attribute (e.g.
// onclick="fn('...')"). It neutralizes quote breakouts, backslashes, and
// angle brackets so attacker-controlled data (group names, etc.) cannot
// break out of the handler or the attribute.
function escapeJs(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\x27')
        .replace(/"/g, '\\x22')
        .replace(/</g, '\\x3C')
        .replace(/>/g, '\\x3E')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function getAge(createdAt) {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return diffDays + 'd';
    } else if (diffHours > 0) {
        return diffHours + 'h';
    } else {
        return diffMins + 'm';
    }
}

function compareVersions(version1, version2) {
    // Simple semantic version comparison (v1.2.3 format)
    if (!version1 || !version2) return 0;

    const v1Parts = version1.replace(/^v/, '').split('.').map(Number);
    const v2Parts = version2.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part > v2Part) return 1;
        if (v1Part < v2Part) return -1;
    }
    return 0;
}

// resolveChihiroTokens replaces chihiro token references in a value
// using the supplied token table (case-insensitive). Unknown tokens are
// left untouched. Mirrors the server-side resolver.
function resolveChihiroTokens(value, tokens) {
    if (!value) return value;
    return value.replace(/\{\{\s*chihiro\.(\w+)\s*\}\}/g, function(match, key) {
        const v = tokens[key.toLowerCase()];
        return (v !== undefined && v !== '') ? v : match;
    });
}

function resolveParameterValue(value, builtins) {
    if (!value) return value;
    return value.replace(/\{\{\s*chihiro\.(\w+)\s*\}\}/g, function(match, key) {
        return builtins[key.toLowerCase()] || match;
    });
}

// Build the human label for a parameter key from the discovered
// parameter metadata, falling back to a humanized key.
function parameterLabel(key) {
    const meta = (allClusterParameters || []).find(p => p.key && p.key.toLowerCase() === key.toLowerCase());
    if (meta && meta.label) return meta.label;
    return key
        .replace(/[_-]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase());
}

// setButtonLoading toggles a button into a "working" state: it disables
// the button and replaces its label with a spinning progress icon (the
// same one used by the kubeconfig status line), then restores the
// original markup and disabled state when called with isLoading=false.
// Safe to call with a null/undefined button.
function setButtonLoading(btn, isLoading, loadingText) {
    if (!btn) return;
    if (isLoading) {
        if (btn.dataset.loading === 'true') return;
        btn.dataset.loading = 'true';
        btn.dataset.originalHtml = btn.innerHTML;
        btn.dataset.wasDisabled = btn.disabled ? 'true' : 'false';
        const label = loadingText != null ? loadingText : 'Working…';
        btn.innerHTML =
            '<span class="material-symbols-outlined spin" style="margin-right: 4px; font-size: 1rem;">progress_activity</span>' +
            '<span>' + escapeHtml(label) + '</span>';
        btn.disabled = true;
    } else {
        if (btn.dataset.loading !== 'true') return;
        btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
        btn.disabled = btn.dataset.wasDisabled === 'true';
        delete btn.dataset.loading;
        delete btn.dataset.originalHtml;
        delete btn.dataset.wasDisabled;
    }
}

// optionConstraintValues returns the list of allowed values an option
// declares for the given field via its generic `constrain` map, or null
// when the option does not constrain that field.
function optionConstraintValues(o, field) {
    if (!o || typeof o !== 'object' || !o.constrain) return null;
    const key = Object.keys(o.constrain).find(
        k => k.toLowerCase() === String(field).toLowerCase());
    if (key === undefined) return null;
    const vals = o.constrain[key];
    return Array.isArray(vals) && vals.length > 0 ? vals : null;
}

function extractLabelValue(path, labels) {
    if (!path || !labels) return undefined;
    const m = path.match(/^metadata\.labels\.'([^']+)'$/);
    return m ? labels[m[1]] : undefined;
}

// Map a CAPI cluster phase to a status badge style.
function phaseStatusClass(phase) {
    switch ((phase || '').toLowerCase()) {
        case 'provisioned':
            return 'provisioned';
        case 'failed':
        case 'deleting':
            return 'not-ready';
        default: // Pending, Provisioning, Unknown, ...
            return 'pending';
    }
}
