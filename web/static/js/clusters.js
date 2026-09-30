// Cluster display: rendering, stats, permissions, kubeconfig download.

// Update clusters display
function updateClusters(clusters) {
    currentClustersList = clusters || [];
    const container = document.getElementById('clustersContainer');
    const emptyState = document.getElementById('emptyState');

    if (DETAIL_VIEW) {
        // The list is already filtered to what this user may see, so a
        // missing cluster means it doesn't exist or isn't accessible.
        const cluster = currentClustersList.find(c => c.name === DETAIL_VIEW.name && c.namespace === DETAIL_VIEW.namespace);
        if (!cluster) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }
        container.style.display = 'block';
        emptyState.style.display = 'none';
        renderPreservingDetails(container, renderClusterPage(cluster));
        ensureClusterPageData();
    } else {
        updateFilterCounts(currentClustersList);
        const shown = currentClustersList.filter(clusterMatchesFilter);
        const noMatch = document.getElementById('noMatchState');
        if (currentClustersList.length === 0) {
            container.style.display = 'none';
            emptyState.style.display = 'block';
            if (noMatch) noMatch.style.display = 'none';
            return;
        }
        emptyState.style.display = 'none';
        if (noMatch) noMatch.style.display = shown.length === 0 ? 'block' : 'none';
        container.style.display = shown.length === 0 ? 'none' : 'grid';
        container.innerHTML = shown.map(renderClusterCard).join('');
    }

    // Re-apply any in-progress / error kubeconfig status messages that
    // were lost when the cluster cards were re-rendered (WebSocket
    // updates rebuild the whole container's innerHTML).
    for (const [key, state] of Object.entries(kubeconfigStatus)) {
        renderKubeconfigStatus(key, state);
    }
}

// renderPreservingDetails replaces the container's markup but keeps the
// open/closed state of <details> elements (by id), so live updates don't
// collapse what the user expanded.
function renderPreservingDetails(container, html) {
    const open = new Set([...container.querySelectorAll('details[id]')].filter(d => d.open).map(d => d.id));
    const closed = new Set([...container.querySelectorAll('details[id]')].filter(d => !d.open).map(d => d.id));
    container.innerHTML = html;
    container.querySelectorAll('details[id]').forEach(d => {
        if (open.has(d.id)) d.open = true;
        else if (closed.has(d.id)) d.open = false;
    });
}

// All cluster fields originate from Kubernetes resources (names, groups,
// creator, parameters, conditions) and must be treated as untrusted. Escape
// for HTML text context and, separately, for the single-quoted JS string
// literals used inside inline onclick handlers to prevent stored XSS.

// Status badges shared by the dashboard card and the cluster page.
function clusterBadges(cluster) {
    const statusText = cluster.deleting ? 'Deleting' : (cluster.available ? 'Available' : (cluster.phase || 'Unknown'));
    const statusClass = cluster.deleting ? 'not-ready' : (cluster.available ? 'ready' : phaseStatusClass(cluster.phase));
    // Clusters labelled chihiro.io/readonly=true are shown but never
    // managed by chihiro. Flag them so it's clear why no edit or delete
    // controls are present.
    const readOnly = cluster.readOnly
        ? `<div class="cluster-status read-only" title="This cluster is not managed by chihiro. It is shown for visibility and its kubeconfig can be downloaded, but it cannot be edited or deleted here."><span class="material-symbols-outlined">lock</span>Read-only</div>`
        : '';
    const paused = cluster.paused
        ? `<div class="cluster-status read-only" title="Reconciliation of this cluster is paused (spec.paused)."><span class="material-symbols-outlined">pause</span>Paused</div>`
        : '';
    return `${readOnly}${paused}<div class="cluster-status ${statusClass}">${escapeHtml(statusText)}</div>`;
}

function kubeconfigButton(cluster) {
    const idKey = clusterDomId(cluster.namespace, cluster.name);
    if (cluster.apiEndpoint && cluster.kubeconfigReady) {
        return `
            <button class="btn btn-filled btn-small" id="kubeconfig-btn-${idKey}"
                    onclick="downloadKubeconfig('${escapeJs(cluster.name)}', '${escapeJs(cluster.namespace)}')">
                <span class="material-symbols-outlined btn-icon">download</span>Kubeconfig
            </button>`;
    }
    const why = !cluster.apiEndpoint
        ? 'Waiting for the control plane endpoint to become available.'
        : 'Waiting for the control plane OIDC configuration so a kubeconfig can be generated.';
    return `
        <button class="btn btn-small btn-disabled" disabled title="${why}">
            <span class="material-symbols-outlined btn-icon">download</span>Kubeconfig
        </button>`;
}

// deleteButton renders the delete action; compact is icon-only (cards).
function deleteButton(cluster, compact) {
    if (!canDeleteCluster(cluster)) return '';
    const onclick = `openDeleteModal('${escapeJs(cluster.name)}', '${escapeJs(cluster.namespace)}')`;
    if (compact) {
        return `
        <button class="btn danger btn-small btn-icon-only" onclick="${onclick}" title="Delete cluster" aria-label="Delete cluster">
            <span class="material-symbols-outlined btn-icon">delete</span>
        </button>`;
    }
    return `
        <button class="btn danger btn-small" onclick="${onclick}">
            <span class="material-symbols-outlined btn-icon">delete</span>Delete
        </button>`;
}

function editButton(onclick, title) {
    return `<button class="edit-btn" onclick="${onclick}" title="${escapeHtml(title || 'Edit')}"><span class="material-symbols-outlined">edit</span></button>`;
}

// Replicas. CAPI v1beta2 reports desired/ready counts in status.controlPlane
// and status.workers; older clusters only have the spec counts.
function replicaCounts(rs, specDesired) {
    const desired = rs && (rs.desired ?? rs.current);
    const ready = rs ? (rs.ready ?? rs.available) : undefined;
    return {
        desired: desired ?? (specDesired != null ? Number(specDesired) : null),
        ready: ready ?? null,
        upToDate: rs ? (rs.upToDate ?? null) : null,
    };
}

function renderReplicaMeter(label, counts, editBtn) {
    const desired = counts.desired ?? 0;
    const known = counts.ready !== null;
    const pct = known && desired > 0 ? Math.min(100, Math.round(counts.ready / desired * 100)) : (known ? 100 : 0);
    const cls = !known ? 'unknown' : (counts.ready >= desired ? 'ready' : (counts.ready === 0 && desired > 0 ? 'not-ready' : 'pending'));
    const countText = known ? `${counts.ready}/${desired} ready` : `${desired} desired`;
    const tip = counts.upToDate !== null ? `${counts.upToDate}/${desired} up to date` : '';
    return `
        <div class="replica ${cls}" title="${escapeHtml(tip)}">
            <div class="replica-head">
                <span class="replica-label">${escapeHtml(label)}</span>
                <span class="replica-count">${escapeHtml(countText)}</span>
                ${editBtn || ''}
            </div>
            <div class="replica-bar"><span style="width: ${pct}%"></span></div>
        </div>`;
}

// Conditions. Most CAPI conditions are healthy when True; these report an
// ongoing operation when True and are healthy when False.
const NEGATIVE_CONDITIONS = new Set(['Deleting', 'Paused', 'RollingOut', 'ScalingUp', 'ScalingDown', 'Remediating']);

function conditionClass(c) {
    if (NEGATIVE_CONDITIONS.has(c.type)) {
        return c.status === 'True' ? 'pending' : 'ready';
    }
    if (c.status === 'True') return 'ready';
    if (c.status === 'False' && c.severity !== 'Info' && c.severity !== 'Warning') return 'not-ready';
    return 'pending';
}

// clusterIssues returns the conditions needing attention, worst first.
function clusterIssues(cluster) {
    return (cluster.conditions || [])
        .map(c => Object.assign({ cls: conditionClass(c) }, c))
        .filter(c => c.cls !== 'ready')
        .sort((a, b) => ADDON_SEVERITY[a.cls] - ADDON_SEVERITY[b.cls] || a.type.localeCompare(b.type));
}

function humanizeCondition(type) {
    return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function conditionIcon(cls) {
    return { 'ready': 'check_circle', 'not-ready': 'error', 'pending': 'pending' }[cls] || 'help';
}

// Dashboard filters: free-text search plus a status filter.
let clusterFilter = { text: '', status: 'all' };

function clusterHasIssues(cluster) {
    if (clusterIssues(cluster).some(c => c.cls === 'not-ready')) return true;
    const addons = clusterAddons(cluster);
    return !!(addons && addons.items.some(a => addonStatusClass(a.state) === 'not-ready'));
}

const CLUSTER_FILTERS = {
    all: () => true,
    ready: c => c.ready,
    pending: c => !c.ready && (c.phase || '').toLowerCase() !== 'provisioned',
    issues: clusterHasIssues,
};

function clusterMatchesFilter(cluster) {
    if (!(CLUSTER_FILTERS[clusterFilter.status] || CLUSTER_FILTERS.all)(cluster)) return false;
    const q = clusterFilter.text.trim().toLowerCase();
    if (!q) return true;
    const haystack = [cluster.name, cluster.namespace, cluster.version, cluster.clusterClass, cluster.creator, ...(cluster.groups || [])]
        .filter(Boolean).join(' ').toLowerCase();
    return q.split(/\s+/).every(term => haystack.includes(term));
}

function setClusterFilter(patch) {
    Object.assign(clusterFilter, patch);
    document.querySelectorAll('.filter-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.filter === clusterFilter.status);
    });
    updateClusters(currentClustersList);
}

function updateFilterCounts(clusters) {
    document.querySelectorAll('.filter-chip').forEach(el => {
        const count = el.querySelector('.filter-count');
        const fn = CLUSTER_FILTERS[el.dataset.filter];
        if (count && fn) count.textContent = clusters.filter(fn).length;
    });
}

// Dashboard card: an overview of one cluster. Everything else lives on the
// cluster page.
function renderClusterCard(cluster) {
    const nameHtml = escapeHtml(cluster.name);
    const nameJs = escapeJs(cluster.name);
    const nsJs = escapeJs(cluster.namespace);
    const pageUrl = escapeHtml(clusterPageUrl(cluster));
    const idKey = clusterDomId(cluster.namespace, cluster.name);

    const subtitle = [cluster.namespace, cluster.clusterClass, `${getAge(cluster.createdAt)} old`]
        .filter(Boolean).map(escapeHtml).join(' · ');

    const cp = renderReplicaMeter('Control plane',
        replicaCounts(cluster.controlPlaneStatus, cluster.controlPlaneReplicas),
        canEditField(cluster, 'controlPlaneReplicas')
            ? editButton(`openEditControlPlaneModal('${nameJs}', '${nsJs}', ${Number(cluster.controlPlaneReplicas) || 0})`, 'Edit control plane replicas')
            : '');
    const workers = renderReplicaMeter('Workers',
        replicaCounts(cluster.workersStatus, workerGroupsTotal(cluster)),
        '');

    const issues = clusterIssues(cluster);
    const top = issues[0];
    const issueLine = top ? `
        <a class="issue-line ${top.cls}" href="${pageUrl}#section-health" title="${escapeHtml(issues.map(conditionSummary).join('\n'))}">
            <span class="material-symbols-outlined">${conditionIcon(top.cls)}</span>
            <span class="issue-text">${escapeHtml(conditionSummary(top))}</span>
            ${issues.length > 1 ? `<span class="issue-more">+${issues.length - 1}</span>` : ''}
        </a>` : '';

    return `
        <div class="cluster-card${cluster.readOnly ? ' read-only' : ''}">
            <div class="cluster-header">
                <div class="cluster-heading">
                    <h3 class="cluster-name"><a href="${pageUrl}" class="cluster-link" title="Open cluster page">${nameHtml}<span class="material-symbols-outlined">open_in_new</span></a></h3>
                    <div class="cluster-subtitle">${subtitle}</div>
                </div>
                <div class="cluster-badges">${clusterBadges(cluster)}</div>
            </div>

            ${issueLine}

            <div class="replica-row">${cp}${workers}</div>

            <div class="cluster-details">
                <div class="detail-item">
                    <div class="detail-label">
                        Version
                        ${canEditField(cluster, 'version') ? editButton(`openEditVersionModal('${nameJs}', '${nsJs}', '${escapeJs(cluster.version || '')}')`, 'Upgrade version') : ''}
                    </div>
                    <div class="detail-value">${cluster.version ? escapeHtml(cluster.version) : 'N/A'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">
                        Worker Groups
                        ${canEditField(cluster, 'workerGroups') ? editButton(`openEditWorkerGroupsModal('${nameJs}', '${nsJs}')`, 'Edit worker groups') : ''}
                    </div>
                    <div class="detail-value">${formatWorkerGroups(cluster.workerGroups, replicaCounts(cluster.workersStatus, workerGroupsTotal(cluster)).desired)}</div>
                </div>
                <div class="detail-item full-width">
                    <div class="detail-label">API Endpoint</div>
                    <div class="detail-value mono">${cluster.apiEndpoint ? escapeHtml(cluster.apiEndpoint) : 'N/A'}</div>
                </div>
            </div>

            ${renderAddonChips(cluster)}

            <div class="cluster-groups">
                <div class="groups-label">
                    Access Groups
                    ${canEditField(cluster, 'groups') ? editButton(`openEditGroupsModal('${nameJs}', '${nsJs}', '${escapeJs((cluster.groups || []).join(','))}')`, 'Edit access groups') : ''}
                </div>
                <div class="group-chips">${renderGroupChips(cluster)}</div>
            </div>

            <div class="cluster-actions">
                <a class="btn btn-small btn-tonal" href="${pageUrl}">
                    <span class="material-symbols-outlined btn-icon">open_in_full</span>More details
                </a>
                ${kubeconfigButton(cluster)}
                ${deleteButton(cluster, true)}
            </div>
            <div class="kubeconfig-status" id="kubeconfig-status-${idKey}"></div>
        </div>
    `;
}

// conditionSummary is a one-line description of a condition. Aggregated
// v1beta2 messages are "* Child: message" bullet lists; keep the first.
function conditionSummary(c) {
    const firstLine = (c.message || '').split('\n').map(l => l.replace(/^\s*\*\s*/, '').trim()).find(Boolean);
    const detail = firstLine || c.reason;
    return `${humanizeCondition(c.type)}${detail ? `: ${detail}` : ''}`;
}

function renderGroupChips(cluster) {
    return cluster.groups && cluster.groups.length > 0
        ? cluster.groups.map(group => `<span class="group-chip">${escapeHtml(group)}</span>`).join('')
        : '<span class="muted">No groups assigned</span>';
}

// workerGroupsTotal is the desired worker count from the spec: the sum of the
// chihiro worker groups, else what the watcher counted.
function workerGroupsTotal(cluster) {
    if (cluster.workerGroups && cluster.workerGroups.length > 0) {
        return cluster.workerGroups.reduce((n, g) => n + (Number(g.replicas) || 0), 0);
    }
    return Number(cluster.nodes) || 0;
}

// setupDetailView switches the dashboard shell into a single-cluster page:
// no stats or create button, a back link, and a full-width card whose
// sections are always expanded (see body.detail-view in dashboard.css).
function setupDetailView() {
    if (!DETAIL_VIEW) return;
    document.body.classList.add('detail-view');
    document.title = `${DETAIL_VIEW.name} - Chihiro`;
    const title = document.getElementById('clustersTitle');
    if (title) {
        title.innerHTML = `<a href="/" class="btn btn-text btn-small back-link"><span class="material-symbols-outlined">arrow_back</span>All clusters</a>`;
    }
    const empty = document.getElementById('emptyState');
    if (empty) {
        empty.innerHTML = `<span class="material-symbols-outlined">search_off</span>
            <h3>Cluster not found</h3>
            <p>It doesn't exist or you don't have access to it. <a href="/">Back to all clusters</a></p>`;
    }
}

// Update stats
function updateStats(clusters) {
    const list = clusters || [];
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('totalClusters', list.length);
    set('readyClusters', list.filter(CLUSTER_FILTERS.ready).length);
    set('pendingClusters', list.filter(CLUSTER_FILTERS.pending).length);

    // Worker nodes: ready/desired across clusters, where reported.
    let ready = 0, desired = 0, readyKnown = false;
    list.forEach(c => {
        const counts = replicaCounts(c.workersStatus, workerGroupsTotal(c));
        desired += counts.desired || 0;
        if (counts.ready !== null) readyKnown = true;
        ready += counts.ready ?? 0;
    });
    set('workerNodes', readyKnown ? `${ready}/${desired}` : desired);

    const issues = list.filter(clusterHasIssues).length;
    set('issueClusters', issues);
    const issueCard = document.getElementById('issueStat');
    if (issueCard) issueCard.classList.toggle('alert', issues > 0);
}

// Render the cluster page's "Parameters" section listing every parameter
// that was set for the cluster at creation time. Parameters controlling an
// add-on show its state and link to it.
function renderMoreDetails(cluster, addons) {
    const params = Object.assign({}, cluster.parameters || {});
    // Merge boolean parameters whose values live in cluster labels
    // (not in the chihiro.io/parameters annotation) so they show in
    // the "More details" section. Use allClusterParameters so every
    // parameter is always visible in the read-only panel, even when
    // the user lacks the group needed to edit it.
    (allClusterParameters || []).forEach(p => {
        if (p.type === 'boolean' && p.key) {
            const keyLower = p.key.toLowerCase();
            const exists = Object.keys(params).some(k => k.toLowerCase() === keyLower);
            if (!exists) {
                const val = extractLabelValue(p.path, cluster.labels);
                if (val !== undefined) params[p.key] = String(val);
            }
        }
    });
    // Resolve chihiro token references in parameter values using the
    // cluster's live state so stored templates display as the
    // actual resolved value.
    const liveTokens = {};
    if (cluster.version) liveTokens.version = cluster.version;
    Object.keys(params).forEach(k => {
        const v = params[k];
        if (typeof v === 'string' && /\{\{\s*chihiro\.\w+\s*\}\}/.test(v)) {
            params[k] = resolveChihiroTokens(v, liveTokens);
        }
    });
    // Only show parameters that are declared in config
    // (allClusterParameters). Entries present on the cluster but not in the
    // current config — e.g. addon labels/params like openstack-ccm or
    // openstack-cinder-csi that are not part of cluster.parameters — are
    // ignored and never displayed.
    const declaredKeys = new Set((allClusterParameters || [])
        .filter(p => p.key)
        .map(p => p.key.toLowerCase()));
    const keys = Object.keys(params)
        .filter(key => !MORE_DETAILS_EXCLUDE.has(key.toLowerCase()))
        .filter(key => declaredKeys.has(key.toLowerCase()))
        .sort();
    if (keys.length === 0) return '';

    const nameJs = escapeJs(cluster.name);
    const nsJs = escapeJs(cluster.namespace);
    const boolKeys = [];
    const otherKeys = [];
    keys.forEach(key => {
        const meta = (allClusterParameters || []).find(p => p.key && p.key.toLowerCase() === key.toLowerCase());
        const rawVal = String(params[key]).toLowerCase();
        const matchesTrueValue = meta && meta.trueValue && String(params[key]) === meta.trueValue;
        if ((meta && meta.type === 'boolean') || rawVal === 'true' || rawVal === 'false' || matchesTrueValue) {
            boolKeys.push(key);
        } else {
            otherKeys.push(key);
        }
    });

    const boolChips = boolKeys.map(key => {
        const meta = (allClusterParameters || []).find(p => p.key && p.key.toLowerCase() === key.toLowerCase());
        const editable = canEditField(cluster, key);
        const on = meta
            ? (params[key] === 'true' || params[key] === meta.trueValue)
            : (String(params[key]).toLowerCase() === 'true');
        const editBtn = editable
            ? `<button class="edit-btn" onclick="openEditParameterModal('${nameJs}', '${nsJs}', '${escapeJs(key)}')"><span class="material-symbols-outlined">edit</span></button>`
            : '';
        return `<span class="bool-chip-item"><span class="param-bool ${on ? 'on' : 'off'}">${on ? 'On' : 'Off'}</span><span class="bool-chip-label">${escapeHtml(parameterLabel(key))}</span>${editBtn}${addonStatusLink(cluster, addons, key)}</span>`;
    }).join('');

    const boolRow = boolKeys.length > 0
        ? `<div class="detail-item full-width"><div class="detail-label" style="margin-bottom: 8px;">Options</div><div class="bool-chips-grid">${boolChips}</div></div>`
        : '';

    const otherRows = otherKeys.map(key => {
        const editable = canEditField(cluster, key);
        const valueHtml = escapeHtml(params[key]);
        const editBtn = editable
            ? `<button class="edit-btn" onclick="openEditParameterModal('${nameJs}', '${nsJs}', '${escapeJs(key)}')"><span class="material-symbols-outlined">edit</span></button>`
            : '';
        return `
        <div class="detail-item">
            <div class="detail-label">${escapeHtml(parameterLabel(key))}${editBtn}</div>
            <div class="detail-value">${valueHtml}</div>
            ${addonStatusLink(cluster, addons, key)}
        </div>
    `;
    }).join('');

    return `
        <section class="detail-section" id="section-parameters">
            <h4 class="section-title"><span class="material-symbols-outlined">tune</span>Parameters</h4>
            <div class="panel-grid">${otherRows}</div>
            ${boolRow}
        </section>
    `;
}

// Add-ons. Each provider adapter below turns its integration's data on the
// cluster object into a provider-agnostic list of add-ons, which the rest of
// the UI renders and links to parameters without knowing the provider. An
// adapter returns null when its integration is disabled. Every value comes
// from Kubernetes objects and must be escaped.
//
// Add-on shape:
//   { provider, kind, name, namespace, state, detail, paused, failureMessage,
//     selectorLabels: [label keys it selects clusters on],
//     settings: [{ label, value }], notes: [string],
//     stages: [{ name, status, lastAppliedTime, failures, kinds: [kind] }],
//     deployments: [{ kind, target, source, link, update, action, status, message, lastAppliedTime }] }
const ADDON_PROVIDERS = [sveltosAddons];

// Sveltos: one add-on per ClusterProfile/Profile targeting the cluster.
function sveltosAddons(cluster) {
    const sv = cluster.sveltos;
    if (!sv) return null;
    return (sv.profiles || []).map(p => ({
        provider: 'Sveltos',
        kind: p.kind || 'Profile',
        name: p.name,
        namespace: p.namespace || '',
        state: p.state,
        detail: `ClusterSummary ${cluster.namespace}/${p.clusterSummary}`,
        paused: !!p.paused,
        failureMessage: p.failureMessage || '',
        selectorLabels: p.selectorLabels || [],
        settings: [
            p.syncMode ? { label: 'Sync', value: p.syncMode } : null,
            p.tier ? { label: 'Tier', value: String(p.tier) } : null,
            (p.dependsOn || []).length ? { label: 'Depends on', value: p.dependsOn.join(', ') } : null,
        ].filter(Boolean),
        notes: [p.suspensionReason, p.dependencies].filter(Boolean),
        stages: (p.features || []).map(f => ({
            name: f.featureID,
            status: f.status || 'Provisioning',
            lastAppliedTime: f.lastAppliedTime,
            failures: f.consecutiveFailures || 0,
            kinds: (f.deployedKinds || []).map(k => k.split('.')[0]),
        })),
        deployments: (p.deployments || []).map(d => ({
            kind: d.kind || d.featureID,
            target: d.namespace ? `${d.namespace}/${d.name}` : d.name,
            source: d.source,
            link: d.repoURL,
            update: d.latestVersion,
            action: d.uninstall ? 'Uninstall' : '',
            status: d.status,
            message: d.message,
            lastAppliedTime: d.lastAppliedTime,
        })),
    }));
}

// clusterAddons gathers the add-ons of every enabled provider and links them
// to the parameters that control them. It returns null when no provider is
// enabled. A parameter controls an add-on when it writes a cluster label the
// add-on selects on (metadata.labels.'<key>' path), or when its `addons`
// config names the add-on explicitly.
function clusterAddons(cluster) {
    let enabled = false;
    const items = [];
    ADDON_PROVIDERS.forEach(adapter => {
        const list = adapter(cluster);
        if (!list) return;
        enabled = true;
        list.forEach(a => items.push(Object.assign(a, { params: [] })));
    });
    if (!enabled) return null;

    const byParam = {};
    (allClusterParameters || []).forEach(p => {
        if (!p.key) return;
        const labelKey = labelKeyFromPath(p.path);
        const refs = p.addons || [];
        const linked = items.filter(a =>
            (labelKey && a.selectorLabels.includes(labelKey)) || refs.some(ref => addonMatchesRef(a, ref)));
        if (linked.length === 0) return;
        byParam[p.key.toLowerCase()] = linked;
        linked.forEach(a => a.params.push(p));
    });

    items.sort((a, b) => bySeverity(a.state, b.state) || addonTitle(a).localeCompare(addonTitle(b)));
    return {
        providers: [...new Set(items.map(a => a.provider))],
        items,
        byParam,
    };
}

function addonMatchesRef(addon, ref) {
    return ref === addon.name
        || ref === `${addon.kind}/${addon.name}`
        || (!!addon.namespace && ref === `${addon.namespace}/${addon.name}`);
}

function addonRef(addon) {
    return `${addon.kind}/${addon.namespace ? `${addon.namespace}/` : ''}${addon.name}`;
}

// The name users know an add-on by: the label of the parameter(s)
// controlling it, else its own name.
function addonTitle(addon) {
    return addon.params.length > 0 ? addon.params.map(p => p.label || parameterLabel(p.key)).join(', ') : addon.name;
}

function addonDomId(cluster, addon) {
    return `addon-${clusterDomId(cluster.namespace, cluster.name)}-${addon.provider}-${addonRef(addon)}`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function addonStatusClass(status) {
    switch (status) {
        case 'Provisioned':
            return 'ready';
        case 'Failed':
        case 'FailedNonRetriable':
        case 'Conflict':
            return 'not-ready';
        case 'Paused':
            return 'read-only';
        default: // Provisioning, Removing, Blocked, ...
            return 'pending';
    }
}

// Worst first, so problems are visible without scrolling.
const ADDON_SEVERITY = { 'not-ready': 0, 'pending': 1, 'read-only': 2, 'ready': 3 };

function bySeverity(a, b) {
    return ADDON_SEVERITY[addonStatusClass(a)] - ADDON_SEVERITY[addonStatusClass(b)];
}

function worstStatus(statuses) {
    return statuses.slice().sort(bySeverity)[0];
}

// addonCounts summarises add-on states as "3/4 ready · 1 failing".
function addonCounts(items) {
    const count = cls => items.filter(a => addonStatusClass(a.state) === cls).length;
    const parts = [`${count('ready')}/${items.length} ready`];
    if (count('not-ready')) parts.push(`${count('not-ready')} failing`);
    if (count('pending')) parts.push(`${count('pending')} in progress`);
    if (count('read-only')) parts.push(`${count('read-only')} paused`);
    return parts.join(' · ');
}

// Compact add-on overview for the dashboard card: one chip per add-on,
// named after the parameter controlling it, coloured by its state. Each
// chip opens the add-on on the cluster page.
const CARD_ADDON_LIMIT = 8;

function renderAddonChips(cluster) {
    const addons = clusterAddons(cluster);
    if (!addons) return '';
    const pageUrl = clusterPageUrl(cluster);
    const shown = addons.items.slice(0, CARD_ADDON_LIMIT);
    const more = addons.items.length - shown.length;

    const chips = shown.map(a => {
        const tip = [`${a.provider} ${addonRef(a)}: ${a.state || 'Unknown'}`];
        if (a.params.length) tip.push(`Controlled by: ${a.params.map(p => p.label || parameterLabel(p.key)).join(', ')}`);
        tip.push(`${a.deployments.length} deployment${a.deployments.length === 1 ? '' : 's'}`);
        if (a.failureMessage) tip.push(a.failureMessage);
        return `<a class="addon-chip ${addonStatusClass(a.state)}" href="${escapeHtml(pageUrl)}#${addonDomId(cluster, a)}" title="${escapeHtml(tip.join('\n'))}">
                <span class="addon-dot"></span><span class="addon-chip-name">${escapeHtml(addonTitle(a))}</span>
            </a>`;
    }).join('');

    const body = addons.items.length === 0
        ? '<span class="addon-none">No add-on targets this cluster</span>'
        : chips + (more > 0 ? `<a class="addon-chip more" href="${escapeHtml(pageUrl)}">+${more} more</a>` : '');

    return `
        <div class="cluster-addons">
            <div class="groups-label">
                <span class="material-symbols-outlined section-icon">extension</span>
                Add-ons
                ${addons.items.length ? `<span class="addon-counts">${escapeHtml(addonCounts(addons.items))}</span>` : ''}
            </div>
            <div class="addon-chips">${body}</div>
        </div>`;
}

// addonStatusLink shows, next to a parameter on the cluster page, the state
// of the add-on(s) it controls and jumps to them.
function addonStatusLink(cluster, addons, key) {
    const linked = addons && addons.byParam[key.toLowerCase()];
    if (!linked) return '';
    const status = worstStatus(linked.map(a => a.state)) || 'Unknown';
    const label = linked.length === 1 ? status : `${linked.length} add-ons · ${status}`;
    const title = linked.map(a => `${a.provider} ${addonRef(a)}: ${a.state || 'Unknown'}`).join('\n');
    return `<a class="addon-link ${addonStatusClass(status)}" href="#${addonDomId(cluster, linked[0])}" title="${escapeHtml(title)}">
            <span class="material-symbols-outlined">extension</span>${escapeHtml(label)}</a>`;
}

// Full add-on list for the cluster page.
function renderAddons(cluster, addons) {
    if (!addons) return '';
    const nameJs = escapeJs(cluster.name);
    const nsJs = escapeJs(cluster.namespace);

    const body = addons.items.length === 0
        ? '<div class="addon-note">No add-on targets this cluster.</div>'
        : addons.items.map(a => {
            const notes = [];
            if (a.paused) notes.push('<div class="addon-note">Reconciliation paused.</div>');
            (a.notes || []).forEach(n => notes.push(`<div class="addon-note">${escapeHtml(n)}</div>`));
            if (a.failureMessage) notes.push(`<div class="addon-note error">${escapeHtml(a.failureMessage)}</div>`);

            const controls = a.params.map(p => {
                const editBtn = canEditField(cluster, p.key)
                    ? editButton(`openEditParameterModal('${nameJs}', '${nsJs}', '${escapeJs(p.key)}')`)
                    : '';
                return `<span class="addon-param"><span class="material-symbols-outlined">tune</span>${escapeHtml(p.label || parameterLabel(p.key))}${editBtn}</span>`;
            }).join('');

            const settings = (a.settings || []).map(st =>
                `<span class="addon-setting"><span class="addon-setting-label">${escapeHtml(st.label)}</span>${escapeHtml(st.value)}</span>`).join('');

            const stages = (a.stages || []).map(st => {
                const meta = [];
                if (st.lastAppliedTime) meta.push(`applied ${getAge(st.lastAppliedTime)} ago`);
                if (st.failures) meta.push(`${st.failures} failed attempt${st.failures === 1 ? '' : 's'}`);
                const kinds = [...new Set(st.kinds || [])];
                const title = [
                    st.lastAppliedTime ? `Last applied ${new Date(st.lastAppliedTime).toLocaleString()}` : '',
                    kinds.length ? `Deployed kinds: ${kinds.join(', ')}` : '',
                ].filter(Boolean).join('\n');
                return `<span class="addon-stage ${addonStatusClass(st.status)}" title="${escapeHtml(title)}">
                        <span class="addon-dot"></span><strong>${escapeHtml(st.name)}</strong>
                        <span>${escapeHtml(st.status)}</span>
                        ${meta.length ? `<span class="addon-stage-meta">· ${escapeHtml(meta.join(' · '))}</span>` : ''}
                    </span>`;
            }).join('');

            const deployments = a.deployments.slice()
                .sort((x, y) => bySeverity(x.status, y.status))
                .map(d => {
                    const applied = d.lastAppliedTime ? `Last applied ${new Date(d.lastAppliedTime).toLocaleString()}` : '';
                    const source = [d.link, d.source].filter(Boolean).join(' · ');
                    return `
                    <li class="addon-deployment" title="${escapeHtml(applied)}">
                        <div class="addon-deployment-main">
                            <span class="addon-kind">${escapeHtml(d.kind || '')}</span>
                            <span class="addon-target">${escapeHtml(d.target || '')}</span>
                            ${d.action ? `<span class="addon-kind">${escapeHtml(d.action)}</span>` : ''}
                            ${d.update ? `<span class="addon-update" title="A newer chart version is available in the repository"><span class="material-symbols-outlined">upgrade</span>${escapeHtml(d.update)}</span>` : ''}
                            <span class="cluster-status ${addonStatusClass(d.status)}">${escapeHtml(d.status || 'Unknown')}</span>
                        </div>
                        ${source ? `<div class="addon-source">${escapeHtml(source)}</div>` : ''}
                        ${d.message ? `<div class="addon-note error">${escapeHtml(d.message)}</div>` : ''}
                    </li>`;
                }).join('');

            const hasTitle = a.params.length > 0;
            return `
                <div class="addon-card ${addonStatusClass(a.state)}" id="${addonDomId(cluster, a)}">
                    <div class="addon-card-header">
                        <div class="addon-card-title">
                            <span class="addon-name">${escapeHtml(hasTitle ? addonTitle(a) : a.name)}</span>
                            <span class="addon-ref">${escapeHtml(a.provider)} ${escapeHtml(addonRef(a))}</span>
                        </div>
                        <span class="cluster-status ${addonStatusClass(a.state)}">${escapeHtml(a.state || 'Unknown')}</span>
                    </div>
                    ${controls ? `<div class="addon-params"><span class="addon-meta-label">Controlled by</span>${controls}</div>` : ''}
                    ${settings ? `<div class="addon-settings">${settings}</div>` : ''}
                    ${stages ? `<div class="addon-stages">${stages}</div>` : ''}
                    ${a.detail ? `<div class="addon-meta">${escapeHtml(a.detail)}</div>` : ''}
                    ${a.selectorLabels.length ? `<div class="addon-meta">Selects clusters on ${escapeHtml(a.selectorLabels.join(', '))}</div>` : ''}
                    ${notes.join('')}
                    ${deployments ? `<ul class="addon-deployments">${deployments}</ul>` : '<div class="addon-note">Nothing to deploy.</div>'}
                    ${renderDeployedResources(cluster, a)}
                </div>`;
        }).join('');

    const deploymentCount = addons.items.reduce((n, a) => n + a.deployments.length, 0);
    const counts = addons.items.length
        ? `${addonCounts(addons.items)} · ${deploymentCount} deployment${deploymentCount === 1 ? '' : 's'}`
        : '';
    return `
        <section class="detail-section" id="section-addons">
            <h4 class="section-title">
                <span class="material-symbols-outlined">extension</span>Add-ons
                ${addons.providers.map(p => `<span class="provider-tag">${escapeHtml(p)}</span>`).join('')}
                ${counts ? `<span class="section-counts">${escapeHtml(counts)}</span>` : ''}
            </h4>
            <div class="addon-grid">${body}</div>
        </section>
    `;
}

// Permissions

function canEditCluster(cluster) {
    // Read-only clusters are visible but not managed by chihiro, so no one can
    // mutate them regardless of group membership. Returning false here removes
    // the delete button and every per-field edit button in one place. The
    // server enforces the same rule in canUserModifyCluster; this is purely to
    // avoid showing controls that would always fail.
    if (cluster.readOnly) return false;

    console.log('Checking edit permissions for cluster:', cluster.name, 'User groups:', userGroups, 'Cluster groups:', cluster.groups, 'IsAdmin:', isAdmin, 'Creator:', cluster.creator, 'Current user:', currentUser?.username, 'IsCreatorGroupMember:', isCreatorGroupMember);

    // Admins can edit any cluster
    if (isAdmin) return true;

    // User must be in creator groups to modify
    if (!isCreatorGroupMember) return false;

    // Check if user is the creator
    if (cluster.creator && currentUser && cluster.creator === currentUser.username) {
        console.log('User is creator, can edit');
        return true;
    }

    // Check if user shares a group with the cluster
    if (!cluster.groups) return false;
    const sharesGroup = cluster.groups.some(group => userGroups.includes(group));
    console.log('Can edit result:', sharesGroup);
    return sharesGroup;
}

function canDeleteCluster(cluster) {
    return canEditCluster(cluster);
}

// A field's edit button shows only when the user can modify the cluster
// AND the field is opt-in enabled in config.
function isFieldEditable(field) {
    const f = editableFields[field.toLowerCase()];
    return !!(f && f.enabled);
}

function canEditField(cluster, field) {
    return canEditCluster(cluster) && isFieldEditable(field);
}

function updateCreateButtonVisibility() {
    const createButton = document.querySelector('.btn.btn-filled[onclick="openCreateModal()"]');
    if (createButton) {
        if (canCreate) {
            createButton.style.display = 'inline-flex';
        } else {
            createButton.style.display = 'none';
        }
    }
}

// Kubeconfig

// renderKubeconfigStatus paints the inline status line for a cluster card
// from the stored state (or clears it when state is null/undefined).
function renderKubeconfigStatus(key, state) {
    const slash = key.indexOf('/');
    const namespace = key.slice(0, slash);
    const name = key.slice(slash + 1);
    const el = document.getElementById(`kubeconfig-status-${clusterDomId(namespace, name)}`);
    if (!el) return;

    if (!state) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }

    el.style.display = 'flex';
    if (state.type === 'pending') {
        el.style.color = 'var(--md-sys-color-on-surface-variant)';
        el.innerHTML = `<span class="material-symbols-outlined spin" style="font-size: 1rem;">progress_activity</span><span>${escapeHtml(state.message)}</span>`;
    } else if (state.type === 'error') {
        el.style.color = 'var(--md-sys-color-error)';
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size: 1rem;">error</span><span>${escapeHtml(state.message)}</span>`;
    }
}

function setKubeconfigStatus(name, namespace, state) {
    const key = clusterKey(name, namespace);
    if (state) {
        kubeconfigStatus[key] = state;
    } else {
        delete kubeconfigStatus[key];
    }
    renderKubeconfigStatus(key, state);
}

// downloadKubeconfig fetches the generated kubeconfig via JS so we can
// show progress and surface server errors inline, instead of navigating
// the browser to a raw JSON error page. Server-side generation can take
// a while because it waits for the control plane endpoint and OIDC data.
async function downloadKubeconfig(name, namespace) {
    const btn = document.getElementById(`kubeconfig-btn-${clusterDomId(namespace, name)}`);
    if (btn) btn.disabled = true;

    setKubeconfigStatus(name, namespace, {
        type: 'pending',
        message: 'Generating kubeconfig… fetching control plane endpoint and OIDC data.'
    });

    try {
        const resp = await fetch(`/api/clusters/${encodeURIComponent(name)}/kubeconfig?namespace=${encodeURIComponent(namespace)}`, {
            headers: { 'Accept': 'application/octet-stream' }
        });

        if (!resp.ok) {
            let message = `Failed to generate kubeconfig (HTTP ${resp.status}).`;
            try {
                const data = await resp.json();
                if (data && data.error) message = data.error;
            } catch (_) { /* non-JSON body, keep generic message */ }
            setKubeconfigStatus(name, namespace, { type: 'error', message });
            return;
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}-kubeconfig.yaml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Briefly confirm success, then clear the status line.
        setKubeconfigStatus(name, namespace, { type: 'pending', message: 'Kubeconfig downloaded.' });
        setTimeout(() => setKubeconfigStatus(name, namespace, null), 4000);
    } catch (error) {
        setKubeconfigStatus(name, namespace, {
            type: 'error',
            message: `Failed to generate kubeconfig: ${error.message}`
        });
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Worker group display formatting

function formatWorkerGroups(groups, totalNodes) {
    if (!groups || groups.length === 0) {
        return totalNodes || 0;
    }
    const schema = workerGroupFieldSchema();
    // Summarise each group using the configured fields (skipping name,
    // which is shown as the group identifier).
    return groups.map(g => {
        const replicas = Number(g.replicas) || 0;
        const parts = schema
            .filter(f => f.key !== 'name' && f.key !== 'replicas')
            .map(f => g[f.key])
            .filter(v => v !== undefined && v !== null && v !== '')
            .map(v => escapeHtml(String(v)));
        const label = g.name ? escapeHtml(String(g.name)) : '';
        const detail = parts.length > 0 ? ` ${parts.join(' / ')}` : '';
        return `${replicas}x${detail}${label ? ` [${label}]` : ''}`;
    }).join(', ');
}
