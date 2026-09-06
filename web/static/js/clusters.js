// Cluster display: rendering, stats, permissions, kubeconfig download.

// Update clusters display
function updateClusters(clusters) {
    currentClustersList = clusters || [];
    const container = document.getElementById('clustersContainer');
    const emptyState = document.getElementById('emptyState');

    if (!clusters || clusters.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    container.style.display = 'grid';
    emptyState.style.display = 'none';

    container.innerHTML = clusters.map(cluster => {
        const age = getAge(cluster.createdAt);
        const statusText = cluster.available ? 'Available' : (cluster.phase || 'Unknown');
        const statusClass = cluster.available ? 'ready' : phaseStatusClass(cluster.phase);

        // All cluster fields below originate from Kubernetes resources
        // (names, groups, creator, parameters) and must be treated as
        // untrusted. Escape for HTML text context and, separately, for
        // the single-quoted JS string literals used inside inline
        // onclick handlers to prevent stored XSS.
        const nameHtml = escapeHtml(cluster.name);
        const nsHtml = escapeHtml(cluster.namespace);
        const nameJs = escapeJs(cluster.name);
        const nsJs = escapeJs(cluster.namespace);
        const versionHtml = cluster.version ? escapeHtml(cluster.version) : 'N/A';
        const versionJs = escapeJs(cluster.version || '');
        const apiEndpointHtml = cluster.apiEndpoint ? escapeHtml(cluster.apiEndpoint) : 'N/A';
        const groupsJoined = cluster.groups ? cluster.groups.join(',') : '';
        const podCidrHtml = cluster.network && cluster.network.podCIDRs && cluster.network.podCIDRs.length > 0
            ? escapeHtml(cluster.network.podCIDRs.join(', ')) : 'N/A';
        const serviceCidrHtml = cluster.network && cluster.network.serviceCIDRs && cluster.network.serviceCIDRs.length > 0
            ? escapeHtml(cluster.network.serviceCIDRs.join(', ')) : 'N/A';
        const serviceDomainHtml = cluster.network && cluster.network.serviceDomain
            ? escapeHtml(cluster.network.serviceDomain) : 'N/A';
        // Element IDs embed namespace/name; sanitize to a safe charset so
        // they can't break out of the attribute or collide with markup.
        const idKey = `${cluster.namespace}-${cluster.name}`.replace(/[^A-Za-z0-9_.-]/g, '_');

        return `
            <div class="cluster-card">
                <div class="cluster-header">
                    <h3 class="cluster-name">${nameHtml}</h3>
                    <div class="cluster-status ${statusClass}">${escapeHtml(statusText)}</div>
                </div>

                <div class="cluster-details">
                    <div class="detail-item">
                        <div class="detail-label">
                            Version
                            ${canEditField(cluster, 'version') ? `<button class="edit-btn" onclick="openEditVersionModal('${nameJs}', '${nsJs}', '${versionJs}')"><span class="material-symbols-outlined">edit</span></button>` : ''}
                        </div>
                        <div class="detail-value">${versionHtml}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">
                            Worker Groups
                            ${canEditField(cluster, 'workerGroups') ? `<button class="edit-btn" onclick="openEditWorkerGroupsModal('${nameJs}', '${nsJs}')"><span class="material-symbols-outlined">edit</span></button>` : ''}
                        </div>
                        <div class="detail-value">${formatWorkerGroups(cluster.workerGroups, cluster.nodes)}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">
                            Control Plane
                            ${canEditField(cluster, 'controlPlaneReplicas') ? `<button class="edit-btn" onclick="openEditControlPlaneModal('${nameJs}', '${nsJs}', ${Number(cluster.controlPlaneReplicas) || 0})"><span class="material-symbols-outlined">edit</span></button>` : ''}
                        </div>
                        <div class="detail-value">${Number(cluster.controlPlaneReplicas) || 0}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Age</div>
                        <div class="detail-value">${escapeHtml(age)}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Pod CIDR</div>
                        <div class="detail-value">${podCidrHtml}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Service CIDR</div>
                        <div class="detail-value">${serviceCidrHtml}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Service Domain</div>
                        <div class="detail-value">${serviceDomainHtml}</div>
                    </div>
                    <div class="detail-item full-width">
                        <div class="detail-label">API Endpoint</div>
                        <div class="detail-value" style="font-size: 0.75rem; word-break: break-all;">${apiEndpointHtml}</div>
                    </div>
                </div>

                ${renderMoreDetails(cluster)}

                <div class="cluster-groups">
                    <div class="groups-label">
                        Access Groups
                        ${canEditField(cluster, 'groups') ? `<button class="edit-btn" onclick="openEditGroupsModal('${nameJs}', '${nsJs}', '${escapeJs(groupsJoined)}')"><span class="material-symbols-outlined">edit</span></button>` : ''}
                    </div>
                    <div class="group-chips">
                        ${cluster.groups && cluster.groups.length > 0 ?
                            cluster.groups.map(group => `<span class="group-chip">${escapeHtml(group)}</span>`).join('') :
                            '<span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.85rem;">No groups assigned</span>'
                        }
                    </div>
                </div>

                <div class="cluster-actions">
                    ${cluster.apiEndpoint && cluster.kubeconfigReady ? `
                    <button class="btn btn-filled btn-small"
                            id="kubeconfig-btn-${idKey}"
                            onclick="downloadKubeconfig('${nameJs}', '${nsJs}')">
                        <span class="material-symbols-outlined" style="margin-right: 4px;">download</span>
                        Kubeconfig
                    </button>` : `
                    <button class="btn btn-small" disabled
                            title="${!cluster.apiEndpoint ? 'Waiting for the control plane endpoint to become available.' : 'Waiting for the control plane OIDC configuration so a kubeconfig can be generated.'}"
                            style="opacity: 0.5; cursor: not-allowed; background-color: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface-variant); border: 1px solid var(--md-sys-color-outline); border-radius: 24px; padding: 0 16px; height: 36px; font-size: 0.85rem; font-family: 'Inter', sans-serif; font-weight: 500; display: inline-flex; align-items: center;">
                        <span class="material-symbols-outlined" style="margin-right: 4px;">download</span>
                        Kubeconfig
                    </button>`}
                    ${canDeleteCluster(cluster) ? `
                        <button class="btn danger btn-small" onclick="openDeleteModal('${nameJs}', '${nsJs}')">
                            <span class="material-symbols-outlined" style="margin-right: 4px;">delete</span>
                            Delete
                        </button>
                    ` : ''}
                </div>
                <div class="kubeconfig-status" id="kubeconfig-status-${idKey}" style="display: none; margin-top: 8px; font-size: 0.8rem; align-items: center; gap: 6px;"></div>
            </div>
        `;
    }).join('');

    // Re-apply any in-progress / error kubeconfig status messages that
    // were lost when the cluster cards were re-rendered (WebSocket
    // updates rebuild the whole container's innerHTML).
    for (const [key, state] of Object.entries(kubeconfigStatus)) {
        renderKubeconfigStatus(key, state);
    }
}

// Update stats
function updateStats(clusters) {
    const list = clusters || [];
    const total = list.length;
    const ready = list.filter(c => c.ready).length;
    // Pending = anything that is neither ready nor in the Provisioned phase.
    const pending = list.filter(c => !c.ready && (c.phase || '').toLowerCase() !== 'provisioned').length;

    document.getElementById('totalClusters').textContent = total;
    document.getElementById('readyClusters').textContent = ready;
    document.getElementById('pendingClusters').textContent = pending;
}

// Render the collapsible "More details" section listing every parameter
// that was set for the cluster at creation time.
function renderMoreDetails(cluster) {
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

    const id = `more-${cluster.namespace}-${cluster.name}`;
    const isExpanded = expandedDetails.has(id);
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
        return `<span class="bool-chip-item">${editBtn}<span class="param-bool ${on ? 'on' : 'off'}">${on ? 'On' : 'Off'}</span><span class="bool-chip-label">${escapeHtml(parameterLabel(key))}</span></span>`;
    }).join('');

    const boolRow = boolKeys.length > 0
        ? `<div class="detail-item full-width"><div class="detail-label" style="margin-bottom: 8px;">Options</div><div class="bool-chips-row">${boolChips}</div></div>`
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
        </div>
    `;
    }).join('');

    const rows = boolRow + otherRows;

    return `
        <button class="more-details-toggle ${isExpanded ? 'expanded' : ''}" onclick="toggleMoreDetails('${id}', this)">
            <span>${isExpanded ? 'Hide details' : 'More details'}</span>
            <span class="material-symbols-outlined">expand_more</span>
        </button>
        <div class="more-details ${isExpanded ? 'expanded' : ''}" id="${id}">
            ${rows}
        </div>
    `;
}

function toggleMoreDetails(id, btn) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const expanded = panel.classList.toggle('expanded');
    btn.classList.toggle('expanded', expanded);
    btn.querySelector('span').textContent = expanded ? 'Hide details' : 'More details';
    // Persist state so re-renders keep the panel open/closed.
    if (expanded) {
        expandedDetails.add(id);
    } else {
        expandedDetails.delete(id);
    }
}

// Permissions

function canEditCluster(cluster) {
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
