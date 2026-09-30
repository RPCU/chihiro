// Create-cluster form: inline validation, access-group chips, control plane
// stepper, live summary and quota check, and modal keyboard handling.
// Payload collection and submission live in forms.js.

// Mirrors clusterNameRegex / groupNameRegex in internal/server/server.go.
const CLUSTER_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const GROUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,253}$/;

// Fields the user has interacted with; errors show only for these until a
// submit (or preview) attempt reveals them all.
let createTouched = new Set();
let createSubmitAttempted = false;

// Field key -> the element that shows its error message.
const CREATE_ERROR_ELEMENTS = {
    name: 'clusterNameError',
    version: 'clusterVersionError',
    controlPlane: 'clusterControlPlaneReplicasError',
    workers: 'createWorkerGroupsError',
    groups: 'clusterGroupsError',
    groupsText: 'clusterGroupsTextError',
};

function resetCreateFormState() {
    createTouched = new Set();
    createSubmitAttempted = false;
    hideCreateError();
    Object.values(CREATE_ERROR_ELEMENTS).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
    document.querySelectorAll('#createClusterForm .form-group.invalid').forEach(g => g.classList.remove('invalid'));
}

function adminGroupList() {
    const el = document.getElementById('clusterGroupsText');
    return (el ? el.value : '').split(',').map(g => g.trim()).filter(Boolean);
}

function selectedGroupList() {
    const sel = document.getElementById('clusterGroups');
    return sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
}

// createWorkerGroupRows reads every worker group row, including incomplete
// ones (collectWorkerGroups drops rows without a name).
function createWorkerGroupRows() {
    return Array.from(document.querySelectorAll('#createWorkerGroups .worker-group-row')).map(row => {
        const values = {};
        row.querySelectorAll('.wg-field').forEach(input => {
            values[input.getAttribute('data-key')] = input.value.trim();
        });
        return values;
    });
}

// validateCreateForm returns { field: message } for every invalid field.
function validateCreateForm() {
    const errors = {};

    const name = document.getElementById('clusterName').value.trim();
    if (!name) {
        errors.name = 'Enter a cluster name.';
    } else if (!CLUSTER_NAME_RE.test(name)) {
        errors.name = CLUSTER_NAME_RE.test(name.toLowerCase())
            ? `Use lowercase letters only: "${name.toLowerCase()}".`
            : 'Only lowercase letters, digits, hyphens and dots; must start and end with a letter or digit.';
    } else if ((currentClustersList || []).some(c => c.name === name)) {
        errors.name = `A cluster named "${name}" already exists.`;
    }

    if (!document.getElementById('clusterVersion').value) {
        errors.version = 'Pick a Kubernetes version.';
    }

    const cp = parseInt(document.getElementById('clusterControlPlaneReplicas').value, 10);
    if (!Number.isFinite(cp) || cp < 1) {
        errors.controlPlane = 'At least 1 control plane replica is required.';
    } else if (createLimits && createLimits.maxTotalCP > 0 && cp > createLimits.availableCP) {
        errors.controlPlane = `Only ${Math.max(0, createLimits.availableCP)} control plane replica(s) left in the quota.`;
    }

    const rows = createWorkerGroupRows();
    const replicasField = workerGroupFieldSchema().find(f => f.key === 'replicas') || {};
    const names = rows.map(r => r.name).filter(Boolean);
    if (rows.length === 0) {
        errors.workers = 'Add at least one worker group.';
    } else if (rows.some(r => !r.name)) {
        errors.workers = 'Every worker group needs a name.';
    } else if (new Set(names).size !== names.length) {
        errors.workers = 'Worker group names must be unique.';
    } else {
        const bad = rows.find(r => {
            const n = parseInt(r.replicas, 10);
            if (r.replicas === undefined) return false;
            return !Number.isFinite(n) || (replicasField.min != null && n < replicasField.min) || (replicasField.max != null && n > replicasField.max);
        });
        if (bad) {
            const range = [replicasField.min, replicasField.max].every(v => v != null)
                ? ` between ${replicasField.min} and ${replicasField.max}` : '';
            errors.workers = `Group "${bad.name}": replicas must be a number${range}.`;
        } else if (createLimits && createLimits.maxTotalNodes > 0 && workerTotal(rows) > createLimits.availableNodes) {
            errors.workers = `${workerTotal(rows)} workers requested, only ${Math.max(0, createLimits.availableNodes)} left in the quota.`;
        }
    }

    // Configured parameters (the form is novalidate, so `required` is ours).
    (clusterParameters || []).forEach(p => {
        if (p.type === 'boolean') return;
        const el = document.getElementById('param_' + p.key);
        if (!el) return;
        if (p.required && !el.value.trim()) {
            errors['param:' + p.key] = `${p.label || parameterLabel(p.key)} is required.`;
        } else if (p.type === 'number' && el.value !== '' && !Number.isFinite(Number(el.value))) {
            errors['param:' + p.key] = 'Enter a number.';
        }
    });

    if (isAdmin) {
        const bad = adminGroupList().find(g => !GROUP_NAME_RE.test(g));
        if (bad) errors.groupsText = `"${bad}" is not a valid group name.`;
    } else if (selectedGroupList().length === 0) {
        errors.groups = 'Pick at least one of your groups.';
    }

    return errors;
}

function workerTotal(rows) {
    return (rows || createWorkerGroupRows()).reduce((n, r) => n + (parseInt(r.replicas, 10) || 0), 0);
}

// renderCreateErrors shows errors for touched fields (all after a submit
// attempt) and returns the errors.
function renderCreateErrors() {
    const errors = validateCreateForm();
    const elements = Object.assign({}, CREATE_ERROR_ELEMENTS);
    (clusterParameters || []).forEach(p => { elements['param:' + p.key] = 'param_' + p.key + 'Error'; });
    Object.entries(elements).forEach(([field, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const visible = createSubmitAttempted || createTouched.has(field) || (field === 'groupsText' && createTouched.has('groups'));
        const msg = visible ? (errors[field] || '') : '';
        el.textContent = msg;
        const group = el.closest('.form-group');
        if (group) group.classList.toggle('invalid', !!msg);
    });
    return errors;
}

function onCreateFieldInput(field) {
    createTouched.add(field);
    hideCreateError();
    if (field === 'groups') renderAdminGroupPreview();
    renderCreateErrors();
    updateCreateSummary();
}

// checkCreateForm runs on submit/preview: reveals every error and focuses
// the first invalid field. Returns true when the form is valid.
function checkCreateForm() {
    createSubmitAttempted = true;
    const errors = renderCreateErrors();
    const first = document.querySelector('#createClusterForm .form-group.invalid');
    if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const focusable = first.querySelector('input:not([type=hidden]), select, button');
        if (focusable) focusable.focus({ preventScroll: true });
    }
    return Object.keys(errors).length === 0;
}

function showCreateError(message) {
    const el = document.getElementById('createFormError');
    el.innerHTML = `<span class="material-symbols-outlined">error</span><span>${escapeHtml(message)}</span>`;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideCreateError() {
    const el = document.getElementById('createFormError');
    if (el) el.hidden = true;
}

// Control plane stepper: odd counts keep etcd quorum, so step 1 <-> 3 <-> 5.
function stepControlPlane(direction) {
    const input = document.getElementById('clusterControlPlaneReplicas');
    let n = parseInt(input.value, 10) || 1;
    n += direction * (n % 2 === 1 ? 2 : 1);
    n = Math.max(1, n);
    if (input.max && n > Number(input.max)) n = Number(input.max);
    input.value = n;
    onCreateFieldInput('controlPlane');
}

// Access groups as toggle chips backed by the hidden #clusterGroups select
// (filled by loadUserGroups), so the payload code is unchanged.
function renderGroupChoiceChips() {
    const sel = document.getElementById('clusterGroups');
    const box = document.getElementById('clusterGroupChips');
    if (!sel || !box) return;
    const options = Array.from(sel.options);
    if (options.length === 1) options[0].selected = true;
    box.innerHTML = options.length === 0
        ? '<span class="muted">You are not in any group that can own clusters.</span>'
        : options.map((o, i) => `
            <button type="button" class="choice-chip${o.selected ? ' selected' : ''}" aria-pressed="${o.selected}"
                    onclick="toggleGroupChoice(${i})">
                <span class="material-symbols-outlined">${o.selected ? 'check' : 'add'}</span>${escapeHtml(o.value)}
            </button>`).join('');
}

function toggleGroupChoice(index) {
    const opt = document.getElementById('clusterGroups').options[index];
    if (!opt) return;
    opt.selected = !opt.selected;
    renderGroupChoiceChips();
    onCreateFieldInput('groups');
}

function renderAdminGroupPreview() {
    const box = document.getElementById('clusterGroupsTextPreview');
    if (!box) return;
    box.innerHTML = adminGroupList().map(g =>
        `<span class="choice-chip selected${GROUP_NAME_RE.test(g) ? '' : ' bad'}">${escapeHtml(g)}</span>`).join('');
}

// updateCreateSummary refreshes the worker total, the footer summary and
// the quota meters.
function updateCreateSummary() {
    const summary = document.getElementById('createSummary');
    if (!summary) return;
    const rows = createWorkerGroupRows();
    const workers = workerTotal(rows);
    const cp = parseInt(document.getElementById('clusterControlPlaneReplicas').value, 10) || 0;
    const version = document.getElementById('clusterVersion').value;
    const toggles = Array.from(document.querySelectorAll('#dynamicParamsContainer input[type=checkbox]'));
    const on = toggles.filter(t => t.checked).length;

    const total = document.getElementById('workerTotal');
    if (total) total.textContent = rows.length ? `${workers} node${workers === 1 ? '' : 's'} in ${rows.length} group${rows.length === 1 ? '' : 's'}` : '';

    const name = document.getElementById('clusterName').value.trim();
    const parts = [
        name ? `<strong>${escapeHtml(name)}</strong>` : null,
        version ? escapeHtml(version) : null,
        `${cp} control plane`,
        `${workers} worker${workers === 1 ? '' : 's'}`,
        toggles.length ? `${on}/${toggles.length} options on` : null,
    ].filter(Boolean);
    summary.innerHTML = parts.join(' · ');

    renderCreateQuota(cp, workers);
}

function renderCreateQuota(cp, workers) {
    const box = document.getElementById('createQuota');
    if (!box) return;
    const l = createLimits;
    const meters = [];
    if (l && l.maxClusters > 0) meters.push({ label: 'Clusters', used: l.currentClusters, adding: 1, max: l.maxClusters });
    if (l && l.maxTotalNodes > 0) meters.push({ label: 'Worker nodes', used: l.currentTotalNodes, adding: workers, max: l.maxTotalNodes });
    if (l && l.maxTotalCP > 0) meters.push({ label: 'Control plane', used: l.currentTotalCP, adding: cp, max: l.maxTotalCP });
    if (meters.length === 0) {
        box.hidden = true;
        return;
    }
    box.hidden = false;
    box.innerHTML = `
        <div class="quota-title">Quota after creation</div>
        ${meters.map(m => {
            const after = m.used + m.adding;
            const over = after > m.max;
            const usedPct = Math.min(100, m.used / m.max * 100);
            const addPct = Math.max(0, Math.min(100 - usedPct, m.adding / m.max * 100));
            return `
            <div class="quota-row${over ? ' over' : ''}">
                <span class="quota-label">${escapeHtml(m.label)}</span>
                <span class="quota-bar"><span class="quota-used" style="width: ${usedPct}%"></span><span class="quota-add" style="width: ${addPct}%"></span></span>
                <span class="quota-count">${after}/${m.max}</span>
            </div>`;
        }).join('')}`;
}

function createFormDirty() {
    return !!document.getElementById('clusterName').value.trim() || createTouched.size > 0;
}

function requestCloseCreateModal() {
    if (createFormDirty() && !confirm('Discard this cluster?')) return;
    closeCreateModal();
}

// Escape closes the top-most open modal (asking first for a started
// create form).
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = Array.from(document.querySelectorAll('.modal-overlay')).filter(o => o.style.display === 'flex');
    const top = open[open.length - 1];
    if (!top) return;
    e.preventDefault();
    const close = {
        createModalOverlay: requestCloseCreateModal,
        previewYamlModalOverlay: closePreviewYamlModal,
        editGroupsModalOverlay: closeEditGroupsModal,
        editWorkerGroupsModalOverlay: closeEditWorkerGroupsModal,
        editControlPlaneModalOverlay: closeEditControlPlaneModal,
        editVersionModalOverlay: closeEditVersionModal,
        editParameterModalOverlay: closeEditParameterModal,
        deleteModalOverlay: closeDeleteModal,
    }[top.id];
    if (close) close();
    else top.style.display = 'none';
});
