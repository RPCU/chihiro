// Dedicated cluster page (/clusters/<namespace>/<name>): layout and the
// on-demand data (Machines, deployed add-on resources) that isn't part of the
// live cluster object.

// Data from /api/clusters/<name>/details, refreshed while the page is open.
let clusterPageData = { loaded: false, loading: false, fetchedAt: 0 };
let clusterPagePoll = null;
const CLUSTER_PAGE_REFRESH = 20000;

function ensureClusterPageData() {
    if (!DETAIL_VIEW || clusterPagePoll) return;
    loadClusterPageData();
    clusterPagePoll = setInterval(() => {
        if (!document.hidden) loadClusterPageData();
    }, CLUSTER_PAGE_REFRESH);
}

function loadClusterPageData(button) {
    if (!DETAIL_VIEW || clusterPageData.loading) return;
    clusterPageData.loading = true;
    setButtonLoading(button, true, 'Refreshing…');
    const url = `/api/clusters/${encodeURIComponent(DETAIL_VIEW.name)}/details?namespace=${encodeURIComponent(DETAIL_VIEW.namespace)}`;
    fetch(url, { credentials: 'include' })
        .then(resp => {
            if (resp.status === 401) {
                window.location.reload();
                return null;
            }
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
        .then(data => {
            if (!data) return;
            clusterPageData = Object.assign({ loaded: true, fetchedAt: Date.now() }, data);
        })
        .catch(err => {
            console.error('Error loading cluster details:', err);
            clusterPageData = {
                loaded: true,
                fetchedAt: Date.now(),
                machinesError: 'Failed to load machines',
                addonResourcesError: 'Failed to load deployed add-on resources',
            };
        })
        .finally(() => {
            clusterPageData.loading = false;
            setButtonLoading(button, false);
            if (currentClustersList.length > 0) updateClusters(currentClustersList);
        });
}

function renderClusterPage(cluster) {
    const addons = clusterAddons(cluster);
    const issues = clusterIssues(cluster);
    const parameters = renderMoreDetails(cluster, addons);
    const machines = clusterPageData.machines || null;

    const sections = [
        { id: 'section-overview', label: 'Overview', icon: 'info' },
        { id: 'section-health', label: 'Health', icon: 'monitor_heart', badge: issues.filter(c => c.cls === 'not-ready').length },
        { id: 'section-machines', label: 'Machines', icon: 'dns', count: machines ? machines.length : null },
        parameters ? { id: 'section-parameters', label: 'Parameters', icon: 'tune' } : null,
        addons ? {
            id: 'section-addons', label: 'Add-ons', icon: 'extension', count: addons.items.length,
            badge: addons.items.filter(a => addonStatusClass(a.state) === 'not-ready').length,
        } : null,
    ].filter(Boolean);

    const nav = sections.map(s => `
        <a class="page-nav-link" href="#${s.id}">
            <span class="material-symbols-outlined">${s.icon}</span>${escapeHtml(s.label)}
            ${s.badge ? `<span class="nav-badge alert">${s.badge}</span>` : (s.count != null ? `<span class="nav-badge">${s.count}</span>` : '')}
        </a>`).join('');

    return `
        <div class="cluster-page${cluster.readOnly ? ' read-only' : ''}">
            ${renderPageHero(cluster)}
            ${renderSummaryTiles(cluster, addons, machines)}
            <nav class="page-nav" aria-label="Cluster sections">${nav}</nav>
            ${renderOverview(cluster)}
            ${renderHealth(cluster, issues)}
            ${renderMachines(cluster)}
            ${parameters}
            ${renderAddons(cluster, addons)}
        </div>`;
}

function renderPageHero(cluster) {
    const idKey = clusterDomId(cluster.namespace, cluster.name);
    const meta = [
        { icon: 'folder', text: cluster.namespace, title: 'Namespace' },
        cluster.clusterClass ? { icon: 'category', text: cluster.clusterClass, title: 'ClusterClass' } : null,
        cluster.creator ? { icon: 'person', text: cluster.creator, title: 'Created by' } : null,
        {
            icon: 'schedule',
            text: `Created ${getAge(cluster.createdAt)} ago`,
            title: new Date(cluster.createdAt).toLocaleString(),
        },
    ].filter(Boolean).map(m => `
        <span class="hero-meta-item" title="${escapeHtml(m.title)}">
            <span class="material-symbols-outlined">${m.icon}</span>${escapeHtml(m.text)}
        </span>`).join('');

    return `
        <div class="page-hero">
            <div class="hero-main">
                <div class="hero-title-row">
                    <h2 class="hero-title">${escapeHtml(cluster.name)}</h2>
                    <div class="cluster-badges">${clusterBadges(cluster)}</div>
                </div>
                <div class="hero-meta">${meta}</div>
            </div>
            <div class="hero-actions">
                ${kubeconfigButton(cluster)}
                ${deleteButton(cluster)}
            </div>
            <div class="kubeconfig-status" id="kubeconfig-status-${idKey}"></div>
        </div>`;
}

function renderSummaryTiles(cluster, addons, machines) {
    const nameJs = escapeJs(cluster.name);
    const nsJs = escapeJs(cluster.namespace);
    const cp = replicaCounts(cluster.controlPlaneStatus, cluster.controlPlaneReplicas);
    const workers = replicaCounts(cluster.workersStatus, workerGroupsTotal(cluster));

    const tiles = [
        {
            label: 'Kubernetes',
            value: cluster.version || 'N/A',
            edit: canEditField(cluster, 'version')
                ? editButton(`openEditVersionModal('${nameJs}', '${nsJs}', '${escapeJs(cluster.version || '')}')`, 'Upgrade version') : '',
        },
        {
            label: 'Control plane',
            value: cp.ready !== null ? `${cp.ready}/${cp.desired ?? 0}` : String(cp.desired ?? 0),
            sub: cp.ready !== null ? 'ready' : 'replicas',
            cls: meterClass(cp),
            edit: canEditField(cluster, 'controlPlaneReplicas')
                ? editButton(`openEditControlPlaneModal('${nameJs}', '${nsJs}', ${Number(cluster.controlPlaneReplicas) || 0})`, 'Edit control plane replicas') : '',
        },
        {
            label: 'Workers',
            value: workers.ready !== null ? `${workers.ready}/${workers.desired ?? 0}` : String(workers.desired ?? 0),
            sub: workers.ready !== null ? 'ready' : 'replicas',
            cls: meterClass(workers),
            edit: canEditField(cluster, 'workerGroups')
                ? editButton(`openEditWorkerGroupsModal('${nameJs}', '${nsJs}')`, 'Edit worker groups') : '',
        },
        machines ? {
            label: 'Machines',
            value: `${machines.filter(m => m.ready).length}/${machines.length}`,
            sub: 'ready',
            cls: machines.every(m => m.ready) ? 'ready' : 'pending',
        } : null,
        addons ? {
            label: 'Add-ons',
            value: `${addons.items.filter(a => addonStatusClass(a.state) === 'ready').length}/${addons.items.length}`,
            sub: 'ready',
            cls: addons.items.length === 0 ? '' : addonStatusClass(worstStatus(addons.items.map(a => a.state))),
        } : null,
    ].filter(Boolean);

    return `
        <div class="summary-tiles">
            ${tiles.map(t => `
                <div class="summary-tile ${t.cls || ''}">
                    <div class="tile-label">${escapeHtml(t.label)}${t.edit || ''}</div>
                    <div class="tile-value">${escapeHtml(t.value)}${t.sub ? `<span class="tile-sub">${escapeHtml(t.sub)}</span>` : ''}</div>
                </div>`).join('')}
        </div>`;
}

function meterClass(counts) {
    if (counts.ready === null) return '';
    if (counts.ready >= (counts.desired ?? 0)) return 'ready';
    return counts.ready === 0 ? 'not-ready' : 'pending';
}

function renderOverview(cluster) {
    const nameJs = escapeJs(cluster.name);
    const nsJs = escapeJs(cluster.namespace);
    const net = cluster.network || {};
    const ref = r => r ? `${r.kind}${r.name ? ` ${r.name}` : ''}` : '';
    const row = (label, value, opts = {}) => {
        if (!value && !opts.always) return '';
        return `
            <div class="kv-row">
                <div class="kv-label">${escapeHtml(label)}${opts.edit || ''}</div>
                <div class="kv-value${opts.mono ? ' mono' : ''}">${value ? (opts.html ? value : escapeHtml(value)) : '<span class="muted">N/A</span>'}${opts.copy && value ? copyButton(value) : ''}</div>
            </div>`;
    };

    const labels = Object.entries(cluster.labels || {}).sort(([a], [b]) => a.localeCompare(b));
    const labelsHtml = labels.length ? `
        <details class="labels-panel" id="labels-${clusterDomId(cluster.namespace, cluster.name)}">
            <summary><span class="material-symbols-outlined">label</span>Labels<span class="nav-badge">${labels.length}</span></summary>
            <div class="label-chips">
                ${labels.map(([k, v]) => `<span class="label-chip"><span class="label-key">${escapeHtml(k)}</span>${v !== '' ? `<span class="label-val">${escapeHtml(v)}</span>` : ''}</span>`).join('')}
            </div>
        </details>` : '';

    return `
        <section class="detail-section" id="section-overview">
            <h4 class="section-title"><span class="material-symbols-outlined">info</span>Overview</h4>
            <div class="overview-grid">
                <div class="panel">
                    <div class="panel-title">Configuration</div>
                    ${row('Worker groups', String(formatWorkerGroups(cluster.workerGroups, replicaCounts(cluster.workersStatus, workerGroupsTotal(cluster)).desired)), {
                        html: true, always: true,
                        edit: canEditField(cluster, 'workerGroups') ? editButton(`openEditWorkerGroupsModal('${nameJs}', '${nsJs}')`, 'Edit worker groups') : '',
                    })}
                    ${row('ClusterClass', cluster.clusterClass)}
                    ${row('Infrastructure', ref(cluster.infrastructureRef))}
                    ${row('Control plane', ref(cluster.controlPlaneRef))}
                    ${row('Failure domains', (cluster.failureDomains || []).join(', '))}
                    ${row('Phase', cluster.phase)}
                </div>
                <div class="panel">
                    <div class="panel-title">Networking</div>
                    ${row('API endpoint', cluster.apiEndpoint, { mono: true, copy: true, always: true })}
                    ${row('Pod CIDR', (net.podCIDRs || []).join(', '), { mono: true, always: true })}
                    ${row('Service CIDR', (net.serviceCIDRs || []).join(', '), { mono: true, always: true })}
                    ${row('Service domain', net.serviceDomain, { mono: true, always: true })}
                </div>
                <div class="panel">
                    <div class="panel-title">
                        Access
                        ${canEditField(cluster, 'groups') ? editButton(`openEditGroupsModal('${nameJs}', '${nsJs}', '${escapeJs((cluster.groups || []).join(','))}')`, 'Edit access groups') : ''}
                    </div>
                    <div class="group-chips">${renderGroupChips(cluster)}</div>
                    ${row('Created by', cluster.creator)}
                    ${row('Created', new Date(cluster.createdAt).toLocaleString())}
                    ${cluster.readOnly ? '<div class="addon-note">Read-only: not managed by chihiro.</div>' : ''}
                </div>
            </div>
            ${labelsHtml}
        </section>`;
}

function copyButton(value) {
    return `<button class="copy-btn" onclick="copyText('${escapeJs(value)}', this)" title="Copy"><span class="material-symbols-outlined">content_copy</span></button>`;
}

function copyText(value, btn) {
    navigator.clipboard.writeText(value).then(() => {
        const icon = btn && btn.querySelector('.material-symbols-outlined');
        if (!icon) return;
        icon.textContent = 'check';
        setTimeout(() => { icon.textContent = 'content_copy'; }, 1500);
    }).catch(err => console.error('Copy failed:', err));
}

function renderHealth(cluster, issues) {
    const conditions = (cluster.conditions || [])
        .map(c => Object.assign({ cls: conditionClass(c) }, c))
        .sort((a, b) => ADDON_SEVERITY[a.cls] - ADDON_SEVERITY[b.cls] || a.type.localeCompare(b.type));

    const flags = [
        { label: 'Infrastructure', ok: cluster.infraReady },
        { label: 'Control plane', ok: cluster.controlPlane },
        { label: 'Available', ok: cluster.available },
        { label: 'API reachable', ok: cluster.ready },
        { label: 'Kubeconfig', ok: cluster.kubeconfigReady },
    ].map(f => `<span class="health-flag ${f.ok ? 'ready' : 'pending'}"><span class="material-symbols-outlined">${f.ok ? 'check_circle' : 'radio_button_unchecked'}</span>${escapeHtml(f.label)}</span>`).join('');

    const rows = conditions.map(c => {
        const since = c.lastTransitionTime ? `${getAge(c.lastTransitionTime)} ago` : '';
        return `
            <li class="condition ${c.cls}">
                <span class="material-symbols-outlined condition-icon">${conditionIcon(c.cls)}</span>
                <div class="condition-body">
                    <div class="condition-head">
                        <span class="condition-type">${escapeHtml(humanizeCondition(c.type))}</span>
                        ${c.reason ? `<span class="condition-reason">${escapeHtml(c.reason)}</span>` : ''}
                        ${since ? `<span class="condition-since" title="${escapeHtml(new Date(c.lastTransitionTime).toLocaleString())}">${escapeHtml(since)}</span>` : ''}
                    </div>
                    ${c.message ? `<div class="condition-message">${escapeHtml(c.message)}</div>` : ''}
                </div>
            </li>`;
    }).join('');

    const failing = issues.filter(c => c.cls === 'not-ready').length;
    const counts = conditions.length
        ? `${conditions.length - issues.length}/${conditions.length} healthy${failing ? ` · ${failing} failing` : ''}`
        : '';

    return `
        <section class="detail-section" id="section-health">
            <h4 class="section-title">
                <span class="material-symbols-outlined">monitor_heart</span>Health
                ${counts ? `<span class="section-counts">${escapeHtml(counts)}</span>` : ''}
            </h4>
            <div class="health-flags">${flags}</div>
            ${rows ? `<ul class="condition-list">${rows}</ul>` : '<div class="addon-note">The cluster reports no conditions.</div>'}
        </section>`;
}

function renderMachines(cluster) {
    const data = clusterPageData;
    let body;
    if (!data.loaded) {
        body = '<div class="addon-note"><span class="material-symbols-outlined spin inline-icon">progress_activity</span>Loading machines…</div>';
    } else if (data.machinesError) {
        body = `<div class="addon-note error">${escapeHtml(data.machinesError)}</div>`;
    } else if (!data.machines || data.machines.length === 0) {
        body = '<div class="addon-note">No Machines for this cluster (hosted control planes such as Kamaji have none).</div>';
    } else {
        // Group rows under "Control plane" and each worker group.
        const groups = [];
        data.machines.forEach(m => {
            const key = m.role === 'control-plane' ? 'Control plane' : (m.group || 'Workers');
            let g = groups.find(x => x.key === key);
            if (!g) groups.push(g = { key, items: [] });
            g.items.push(m);
        });
        body = `
            <div class="table-wrap">
                <table class="machine-table">
                    <thead>
                        <tr><th>Machine</th><th>Status</th><th>Version</th><th>Address</th><th>Zone</th><th>Age</th></tr>
                    </thead>
                    ${groups.map(g => `
                    <tbody>
                        <tr class="group-row"><th colspan="6">${escapeHtml(g.key)}<span class="nav-badge">${g.items.filter(m => m.ready).length}/${g.items.length} ready</span></th></tr>
                        ${g.items.map(renderMachineRow).join('')}
                    </tbody>`).join('')}
                </table>
            </div>`;
    }

    return `
        <section class="detail-section" id="section-machines">
            <h4 class="section-title">
                <span class="material-symbols-outlined">dns</span>Machines
                <span class="section-counts">
                    ${data.fetchedAt ? `updated ${escapeHtml(new Date(data.fetchedAt).toLocaleTimeString())}` : ''}
                    <button class="btn btn-text btn-xs" onclick="loadClusterPageData(this)" title="Refresh machines and add-on resources">
                        <span class="material-symbols-outlined">refresh</span>
                    </button>
                </span>
            </h4>
            ${body}
        </section>`;
}

function renderMachineRow(m) {
    const cls = m.deleting ? 'not-ready' : (m.ready ? 'ready' : (m.phase === 'Failed' ? 'not-ready' : 'pending'));
    const status = m.deleting ? 'Deleting' : (m.phase || (m.ready ? 'Ready' : 'Unknown'));
    const node = m.nodeName && m.nodeName !== m.name ? `<div class="cell-sub">node ${escapeHtml(m.nodeName)}</div>` : '';
    const os = [m.osImage, m.architecture].filter(Boolean).join(' · ');
    return `
        <tr>
            <td data-label="Machine">
                <div class="cell-main mono">${escapeHtml(m.name)}</div>
                ${node}
                ${os ? `<div class="cell-sub">${escapeHtml(os)}</div>` : ''}
            </td>
            <td data-label="Status">
                <span class="cluster-status ${cls}">${escapeHtml(status)}</span>
                ${m.message ? `<div class="cell-sub error" title="${escapeHtml(m.message)}">${escapeHtml(m.message)}</div>` : ''}
            </td>
            <td data-label="Version">${m.version ? escapeHtml(m.version) : '<span class="muted">—</span>'}</td>
            <td data-label="Address" class="mono">${(m.addresses || []).length ? escapeHtml(m.addresses[0]) : '<span class="muted">—</span>'}${(m.addresses || []).length > 1 ? `<div class="cell-sub" title="${escapeHtml(m.addresses.join(', '))}">+${m.addresses.length - 1} more</div>` : ''}</td>
            <td data-label="Zone">${m.failureDomain ? escapeHtml(m.failureDomain) : '<span class="muted">—</span>'}</td>
            <td data-label="Age" title="${m.createdAt ? escapeHtml(new Date(m.createdAt).toLocaleString()) : ''}">${m.createdAt ? escapeHtml(getAge(m.createdAt)) : '—'}</td>
        </tr>`;
}

// renderDeployedResources lists, inside an add-on card, what the add-on
// actually deployed on the cluster (Sveltos ClusterConfiguration).
function renderDeployedResources(cluster, addon) {
    if (addon.provider !== 'Sveltos') return '';
    const data = clusterPageData;
    if (!data.loaded) return '';
    if (data.addonResourcesError) {
        return `<div class="addon-note error">${escapeHtml(data.addonResourcesError)}</div>`;
    }
    const profile = (data.addonResources || []).find(p => p.kind === addon.kind && p.name === addon.name);
    const items = profile ? profile.items : [];
    if (items.length === 0) return '';

    const byKind = {};
    items.forEach(i => { byKind[i.kind] = (byKind[i.kind] || 0) + 1; });
    const summary = Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ');
    const id = `deployed-${addonDomId(cluster, addon)}`;
    return `
        <details class="deployed-panel" id="${id}">
            <summary>
                <span class="material-symbols-outlined">inventory_2</span>
                ${items.length} deployed resource${items.length === 1 ? '' : 's'}
                <span class="deployed-summary">${escapeHtml(summary)}</span>
            </summary>
            <ul class="deployed-list">
                ${items.map(i => {
                    const target = i.namespace ? `${i.namespace}/${i.name}` : i.name;
                    const version = i.kind === 'HelmChart'
                        ? [i.version && `chart ${i.version}`, i.appVersion && `app ${i.appVersion}`].filter(Boolean).join(' · ')
                        : [i.group, i.version].filter(Boolean).join('/');
                    const applied = i.lastAppliedTime ? `Last applied ${new Date(i.lastAppliedTime).toLocaleString()}` : '';
                    return `
                    <li title="${escapeHtml([applied, i.repoURL].filter(Boolean).join('\n'))}">
                        <span class="addon-kind">${escapeHtml(i.kind)}</span>
                        <span class="deployed-name">${escapeHtml(target)}</span>
                        ${version ? `<span class="deployed-version">${escapeHtml(version)}</span>` : ''}
                    </li>`;
                }).join('')}
            </ul>
        </details>`;
}
