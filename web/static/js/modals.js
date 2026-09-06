// Modal open/close functions for all dashboard modals.

function openCreateModal() {
    console.log('Opening create modal, isAdmin:', isAdmin);
    document.getElementById('createModalOverlay').style.display = 'flex';
    loadLimitsInfo(); // Load and display limits
    renderDynamicParameters();

    // Re-render dynamic parameters when the cluster name changes so
    // parameter defaults embedding {{ chihiro.name }} stay resolved.
    const nameInput = document.getElementById('clusterName');
    if (nameInput && !nameInput._rerenderWired) {
        nameInput.addEventListener('input', renderDynamicParameters);
        nameInput._rerenderWired = true;
    }

    // Initialize worker groups editor with one default group seeded
    // from the schema defaults.
    document.getElementById('createWorkerGroups').innerHTML = '';
    createGroupIndex = 0;
    addCreateWorkerGroup(defaultWorkerGroupValues());

    if (isAdmin) {
        console.log('Admin user - showing text input');
        document.getElementById('groupsSection').style.display = 'none';
        document.getElementById('groupsTextSection').style.display = 'block';
    } else {
        console.log('Regular user - showing dropdown');
        document.getElementById('groupsSection').style.display = 'block';
        document.getElementById('groupsTextSection').style.display = 'none';
    }
}

function closeCreateModal() {
    document.getElementById('createModalOverlay').style.display = 'none';
    document.getElementById('createClusterForm').reset();
}

function openEditGroupsModal(name, namespace, currentGroups) {
    console.log('Opening edit modal, isAdmin:', isAdmin, 'currentGroups:', currentGroups);
    editClusterData = { name, namespace, currentGroups };
    document.getElementById('editClusterName').textContent = name;
    document.getElementById('editGroupsModalOverlay').style.display = 'flex';

    if (isAdmin) {
        console.log('Admin user - showing text input for editing');
        document.getElementById('editGroupsSection').style.display = 'none';
        document.getElementById('editGroupsTextSection').style.display = 'block';
        document.getElementById('editClusterGroupsText').value = currentGroups;
    } else {
        console.log('Regular user - showing dropdown for editing');
        document.getElementById('editGroupsSection').style.display = 'block';
        document.getElementById('editGroupsTextSection').style.display = 'none';

        // Set current selections - only for groups the user belongs to
        const select = document.getElementById('editClusterGroups');
        const currentGroupsList = currentGroups.split(',').filter(g => g.trim());
        Array.from(select.options).forEach(option => {
            // Only pre-select groups the user belongs to
            option.selected = currentGroupsList.includes(option.value) && userGroups.includes(option.value);
        });

        // Show info about groups user doesn't control
        const groupsNotOwned = currentGroupsList.filter(g => !userGroups.includes(g));
        if (groupsNotOwned.length > 0) {
            console.log('Cluster has groups user does not belong to:', groupsNotOwned);
        }
    }
}

function closeEditGroupsModal() {
    document.getElementById('editGroupsModalOverlay').style.display = 'none';
    editClusterData = null;
}

function openEditWorkerGroupsModal(name, namespace) {
    editNodesData = { name, namespace };
    document.getElementById('editWorkerGroupsClusterName').textContent = name;

    // Find the cluster to get current worker groups
    const cluster = currentClustersList.find(c => c.name === name && c.namespace === namespace);
    const groups = (cluster && cluster.workerGroups) ? cluster.workerGroups : [];

    const container = document.getElementById('editWorkerGroupsList');
    container.innerHTML = '';
    editGroupIndex = 0;
    if (groups.length === 0) {
        addEditWorkerGroup(defaultWorkerGroupValues());
    } else {
        groups.forEach(g => addEditWorkerGroup(g));
    }

    document.getElementById('editWorkerGroupsModalOverlay').style.display = 'flex';

    // Load limits info
    fetch('/api/limits', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
            const el = document.getElementById('editWorkerGroupsLimitsInfo');
            if (data.maxTotalNodes > 0) {
                el.textContent = `Available: ${data.availableNodes} nodes | Max: ${data.maxTotalNodes} nodes (${data.currentTotalNodes} in use)`;
            } else {
                el.textContent = 'No node limits configured';
            }
        })
        .catch(() => {
            document.getElementById('editWorkerGroupsLimitsInfo').textContent = '';
        });
}

function closeEditWorkerGroupsModal() {
    document.getElementById('editWorkerGroupsModalOverlay').style.display = 'none';
    editNodesData = null;
}

function openEditControlPlaneModal(name, namespace, currentReplicas) {
    editControlPlaneData = { name, namespace };
    document.getElementById('editControlPlaneClusterName').textContent = name;

    const input = document.getElementById('editClusterControlPlane');
    const cfg = editableFields['controlplanereplicas'] || {};
    const min = (cfg.min != null) ? cfg.min : 1;
    input.min = min;
    if (cfg.max != null) {
        input.max = cfg.max;
    } else {
        input.removeAttribute('max');
    }
    input.value = currentReplicas;

    const hint = document.getElementById('editControlPlaneHint');
    hint.textContent = (cfg.max != null)
        ? `Allowed range: ${min}–${cfg.max} replicas`
        : `Minimum: ${min} replica${min === 1 ? '' : 's'}`;

    document.getElementById('editControlPlaneModalOverlay').style.display = 'flex';
}

function closeEditControlPlaneModal() {
    document.getElementById('editControlPlaneModalOverlay').style.display = 'none';
    editControlPlaneData = null;
}

function openEditVersionModal(name, namespace, currentVersion) {
    console.log('Opening edit version modal for cluster:', name, 'current version:', currentVersion);
    const cluster = currentClustersList.find(c => c.name === name && c.namespace === namespace);
    editVersionData = { name, namespace, currentVersion, cluster };
    document.getElementById('editVersionClusterName').textContent = name;

    // Populate dropdown with upgrade-only versions
    populateUpgradeVersions(currentVersion);
    // Clear any previous dependent-parameter preview.
    renderVersionDependents('');

    document.getElementById('editVersionModalOverlay').style.display = 'flex';
}

function closeEditVersionModal() {
    document.getElementById('editVersionModalOverlay').style.display = 'none';
    editVersionData = null;
}

function populateUpgradeVersions(currentVersion) {
    const select = document.getElementById('editClusterVersion');
    select.innerHTML = '<option value="">Select a version to upgrade to...</option>';

    // Filter versions to only show newer ones
    const upgradeVersions = availableVersions.filter(version => {
        return compareVersions(version, currentVersion) > 0;
    });

    if (upgradeVersions.length === 0) {
        select.innerHTML = '<option value="">No upgrade versions available</option>';
        select.disabled = true;
    } else {
        select.disabled = false;
        upgradeVersions.forEach(version => {
            const option = document.createElement('option');
            option.value = version;
            option.textContent = version;
            select.appendChild(option);
        });
    }

    // Refresh the dependent-parameter preview (e.g. node image) whenever
    // the selected target version changes.
    select.onchange = function() { renderVersionDependents(select.value); };
}

function openDeleteModal(name, namespace) {
    deleteClusterData = { name, namespace };
    document.getElementById('deleteClusterName').textContent = name;
    document.getElementById('deleteModalOverlay').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('deleteModalOverlay').style.display = 'none';
    deleteClusterData = null;
}

// Close modals when clicking outside
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.style.display = 'none';
        }
    });
});
