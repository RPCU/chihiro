// Form submissions, YAML preview, delete confirmation, and initialization.

// collectCreateClusterPayload reads the create form into the request
// body shared by both the create and preview endpoints. It validates the
// inputs and shows an alert + returns null if anything is invalid.
function collectCreateClusterPayload() {
    const name = document.getElementById('clusterName').value;
    const version = document.getElementById('clusterVersion').value;
    const controlPlaneReplicas = parseInt(document.getElementById('clusterControlPlaneReplicas').value);
    let groups = '';

    if (isAdmin) {
        groups = document.getElementById('clusterGroupsText').value;
    } else {
        const selectedOptions = Array.from(document.getElementById('clusterGroups').selectedOptions);
        groups = selectedOptions.map(option => option.value).join(',');
    }

    // Collect worker groups
    const workerGroups = collectWorkerGroups('create');
    if (workerGroups.length === 0) {
        alert('At least one worker group is required');
        return null;
    }

    // Validate control plane replicas
    if (controlPlaneReplicas < 1) {
        alert('Control plane replicas must be at least 1');
        return null;
    }

    // Non-admin users must select at least one group
    if (!isAdmin && (!groups || groups.trim() === '')) {
        alert('You must assign at least one of your groups to the cluster');
        return null;
    }

    // Collect dynamic template parameters
    const parameters = {};
    const builtins = { version: document.getElementById('clusterVersion').value || '' };
    clusterParameters.forEach(p => {
        const el = document.getElementById('param_' + p.key);
        if (p.type === 'boolean') {
            // Always send the explicit on/off state for booleans.
            parameters[p.key] = (el ? el.checked : (p.default === 'true')) ? 'true' : 'false';
        } else if (el && el.tagName === 'SELECT' && el.value) {
            // Selects always send the user's chosen value.
            parameters[p.key] = el.value;
        } else if (p.default && /\{\{\s*chihiro\.\w+\s*\}\}/.test(p.default)) {
            // Auto-resolved params send the resolved value when no
            // explicit selection was made (e.g. text inputs).
            parameters[p.key] = resolveParameterValue(p.default, builtins);
        } else if (el && el.value) {
            parameters[p.key] = el.value;
        } else if (p.default) {
            parameters[p.key] = p.default;
        }
    });

    return { name, version, controlPlaneReplicas, groups, workerGroups, parameters };
}

// previewClusterYaml renders the manifest that would be applied and shows
// it in a read-only modal. It does not create anything.
function previewClusterYaml(triggerBtn) {
    const payload = collectCreateClusterPayload();
    if (!payload) return;

    setButtonLoading(triggerBtn, true, 'Rendering…');

    fetch('/api/clusters/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json().then(data => {
        if (!response.ok) {
            throw new Error(data.error || 'Failed to render preview');
        }
        return data;
    }))
    .then(data => {
        document.getElementById('previewYamlContent').textContent = data.yaml || '';
        document.getElementById('previewYamlModalOverlay').style.display = 'flex';
    })
    .catch(error => {
        console.error('Error rendering preview:', error);
        alert('Failed to render preview: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(triggerBtn, false);
    });
}

function closePreviewYamlModal() {
    document.getElementById('previewYamlModalOverlay').style.display = 'none';
}

function copyPreviewYaml(btn) {
    const text = document.getElementById('previewYamlContent').textContent || '';
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 1.1rem; margin-right: 4px;">check</span>Copied';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }).catch(err => {
        console.error('Failed to copy YAML:', err);
        alert('Failed to copy to clipboard');
    });
}

function confirmDelete(btn) {
    if (!deleteClusterData) return;

    setButtonLoading(btn, true, 'Deleting…');

    fetch(`/api/clusters/${deleteClusterData.name}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: deleteClusterData.namespace })
    })
    .then(response => {
        if (response.ok) {
            closeDeleteModal();
            loadClusters(); // Refresh clusters
        } else {
            throw new Error('Failed to delete cluster');
        }
    })
    .catch(error => {
        console.error('Error deleting cluster:', error);
        alert('Failed to delete cluster');
    })
    .finally(() => {
        setButtonLoading(btn, false);
    });
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', function() {
    loadUserInfo().then(() => {
        loadVersions();
        loadUserGroups();
        loadUserPermissions();
        loadClusterParameters();
        loadWorkerGroupFields();
        loadEditableFields();
        loadConfig();
        connectWebSocket();
        loadClusters();
        startAutoRefresh(); // Start periodic refresh as fallback
    });
});

// Clean up when page unloads
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
    if (ws) {
        ws.close();
    }
});

// Form submit handlers

document.getElementById('createClusterForm').addEventListener('submit', function(e) {
    e.preventDefault();

    const payload = collectCreateClusterPayload();
    if (!payload) return;

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Creating…');

    fetch('/api/clusters', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            closeCreateModal();
            loadClusters(); // Refresh clusters
        } else {
            return response.json().then(data => {
                throw new Error(data.error || 'Failed to create cluster');
            });
        }
    })
    .catch(error => {
        console.error('Error creating cluster:', error);
        alert('Failed to create cluster: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});

document.getElementById('editGroupsForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (!editClusterData) return;

    let groups = '';
    if (isAdmin) {
        groups = document.getElementById('editClusterGroupsText').value;
    } else {
        // Get selected groups (user's groups only)
        const selectedOptions = Array.from(document.getElementById('editClusterGroups').selectedOptions);
        const selectedUserGroups = selectedOptions.map(option => option.value);

        // Preserve groups the user doesn't belong to
        const currentGroupsList = editClusterData.currentGroups.split(',').filter(g => g.trim());
        const groupsNotOwned = currentGroupsList.filter(g => !userGroups.includes(g));

        // Combine: user's selected groups + groups user doesn't own (preserved)
        const allGroups = [...selectedUserGroups, ...groupsNotOwned];
        groups = allGroups.join(',');

        console.log('Submitting groups:', 'selected:', selectedUserGroups, 'preserved:', groupsNotOwned, 'combined:', groups);
    }

    // Non-admin users must select at least one of their own groups
    if (!isAdmin) {
        const selectedOptions = Array.from(document.getElementById('editClusterGroups').selectedOptions);
        if (selectedOptions.length === 0) {
            alert('You must assign at least one of your groups to the cluster');
            return;
        }
    }

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Saving…');

    fetch(`/api/clusters/${editClusterData.name}/groups`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: editClusterData.namespace,
            groups: groups
        })
    })
    .then(response => {
        if (response.ok) {
            closeEditGroupsModal();
            loadClusters(); // Refresh clusters
        } else {
            throw new Error('Failed to update groups');
        }
    })
    .catch(error => {
        console.error('Error updating groups:', error);
        alert('Failed to update groups');
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});

document.getElementById('editWorkerGroupsForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (!editNodesData) return;

    const workerGroups = collectWorkerGroups('edit');
    if (workerGroups.length === 0) {
        alert('At least one worker group is required');
        return;
    }

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Saving…');

    fetch(`/api/clusters/${editNodesData.name}/worker-groups`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: editNodesData.namespace,
            workerGroups: workerGroups
        })
    })
    .then(response => {
        if (response.ok) {
            closeEditWorkerGroupsModal();
            loadClusters(); // Refresh clusters
        } else {
            return response.json().then(data => {
                throw new Error(data.error || 'Failed to update worker groups');
            });
        }
    })
    .catch(error => {
        console.error('Error updating worker groups:', error);
        alert('Failed to update worker groups: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});

document.getElementById('editControlPlaneForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (!editControlPlaneData) return;

    const replicas = parseInt(document.getElementById('editClusterControlPlane').value);

    if (isNaN(replicas) || replicas < 1) {
        alert('Control plane replicas must be at least 1');
        return;
    }

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Saving…');

    fetch(`/api/clusters/${editControlPlaneData.name}/control-plane`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: editControlPlaneData.namespace,
            controlPlaneReplicas: replicas
        })
    })
    .then(response => {
        if (response.ok) {
            closeEditControlPlaneModal();
            loadClusters();
        } else {
            return response.json().then(data => {
                throw new Error(data.error || 'Failed to update control plane replicas');
            });
        }
    })
    .catch(error => {
        console.error('Error updating control plane replicas:', error);
        alert('Failed to update control plane replicas: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});

document.getElementById('editVersionForm').addEventListener('submit', function(e) {
    e.preventDefault();

    if (!editVersionData) return;

    const newVersion = document.getElementById('editClusterVersion').value;

    if (!newVersion) {
        alert('Please select a version to upgrade to');
        return;
    }

    // Double-check that the selected version is newer
    if (compareVersions(newVersion, editVersionData.currentVersion) <= 0) {
        alert('Selected version must be newer than the current version');
        return;
    }

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Upgrading…');

    fetch(`/api/clusters/${editVersionData.name}/version`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: editVersionData.namespace,
            version: newVersion
        })
    })
    .then(response => {
        if (response.ok) {
            closeEditVersionModal();
            loadClusters(); // Refresh clusters
        } else {
            return response.json().then(data => {
                throw new Error(data.error || 'Failed to update cluster version');
            });
        }
    })
    .catch(error => {
        console.error('Error updating version:', error);
        alert('Failed to update cluster version: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});

document.getElementById('editParameterForm').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!editParameterData) return;

    const input = document.getElementById('editParameterInput');
    let value;
    if (editParameterData.type === 'boolean') {
        value = input.checked ? 'true' : 'false';
    } else {
        value = input.value;
    }

    const submitBtn = e.submitter;
    setButtonLoading(submitBtn, true, 'Saving…');

    const url = `/api/clusters/${encodeURIComponent(editParameterData.name)}/parameter`
        + `?namespace=${encodeURIComponent(editParameterData.namespace)}`;
    fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            namespace: editParameterData.namespace,
            key: editParameterData.key,
            value: value
        })
    })
    .then(response => {
        if (response.ok) {
            closeEditParameterModal();
            loadClusters();
        } else {
            return response.json().then(data => {
                throw new Error(data.error || 'Failed to update parameter');
            });
        }
    })
    .catch(error => {
        console.error('Error updating parameter:', error);
        alert('Failed to update parameter: ' + error.message);
    })
    .finally(() => {
        setButtonLoading(submitBtn, false);
    });
});
