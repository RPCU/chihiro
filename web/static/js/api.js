// Data-fetching functions that call the Chihiro REST API.

// User info
function loadUserInfo() {
    return fetch('/api/user', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(user => {
            currentUser = user;
            document.getElementById('userName').textContent = user.username;
            userGroups = user.groups || [];
            isAdmin = user.isAdmin || false; // Use the backend's admin determination
            console.log('User loaded:', user.username, 'Groups:', userGroups, 'IsAdmin:', isAdmin);
        })
        .catch(error => {
            console.error('Error loading user info:', error);
        });
}

// Load configuration
function loadConfig() {
    fetch('/api/config', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(config => {
            // Show docs link if configured
            if (config.docsUrl) {
                const docsLink = document.getElementById('docsLink');
                docsLink.href = config.docsUrl;
                docsLink.style.display = 'inline-flex';
            }
        })
        .catch(error => {
            console.error('Error loading config:', error);
        });
}

// Load clusters
function loadClusters() {
    fetch('/api/clusters', {
        credentials: 'include'  // Include cookies for authentication
    })
        .then(response => {
            if (response.status === 401 || response.status === 403) {
                console.log('Session expired while loading clusters, reloading page...');
                window.location.reload();
                return;
            }
            return response.json();
        })
        .then(clusters => {
            if (clusters) {
                updateClusters(clusters);
                updateStats(clusters);
            }
        })
        .catch(error => {
            console.error('Error loading clusters:', error);
        });
}

// Load versions and groups
function loadVersions() {
    fetch('/api/versions', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            // Store available versions globally for upgrade filtering
            availableVersions = data.versions || [];

            const select = document.getElementById('clusterVersion');
            select.innerHTML = '<option value="">Select version...</option>';
            availableVersions.forEach(version => {
                const option = document.createElement('option');
                option.value = version;
                option.textContent = version;
                select.appendChild(option);
            });
            select.addEventListener('change', renderDynamicParameters);
        })
        .catch(error => console.error('Error loading versions:', error));
}

function loadLimitsInfo() {
    fetch('/api/limits', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            const limitsEl = document.getElementById('limitsInfo');
            const cpInput = document.getElementById('clusterControlPlaneReplicas');

            if (data.maxClusters > 0 || data.maxTotalNodes > 0 || data.maxTotalCP > 0) {
                let limitsText = [];

                if (data.maxClusters > 0) {
                    limitsText.push(`Clusters: ${data.currentClusters}/${data.maxClusters}`);
                }

                if (data.maxTotalNodes > 0) {
                    limitsText.push(`Total nodes: ${data.currentTotalNodes}/${data.maxTotalNodes}`);
                    limitsText.push(`Available: ${data.availableNodes}`);
                }

                if (data.maxTotalCP > 0) {
                    limitsText.push(`Control plane: ${data.currentTotalCP}/${data.maxTotalCP}`);
                    if (cpInput) cpInput.max = data.availableCP;
                }

                limitsEl.textContent = limitsText.join(' | ');

                // Check if at cluster limit
                if (data.maxClusters > 0 && data.currentClusters >= data.maxClusters) {
                    limitsEl.style.color = 'var(--md-sys-color-error)';
                    limitsEl.textContent = `Cluster limit reached (${data.currentClusters}/${data.maxClusters}). Cannot create more clusters.`;
                }
            } else {
                limitsEl.textContent = 'No limits configured';
            }
        })
        .catch(error => {
            console.error('Error loading limits:', error);
            document.getElementById('limitsInfo').textContent = 'Failed to load limits';
        });
}

function loadUserGroups() {
    fetch('/api/user/groups', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            const createSelect = document.getElementById('clusterGroups');
            const editSelect = document.getElementById('editClusterGroups');

            [createSelect, editSelect].forEach(select => {
                select.innerHTML = '';
                data.groups.forEach(group => {
                    const option = document.createElement('option');
                    option.value = group;
                    option.textContent = group;
                    select.appendChild(option);
                });
            });
        })
        .catch(error => console.error('Error loading user groups:', error));
}

function loadUserPermissions() {
    fetch('/api/user/permissions', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            canCreate = data.canCreate || false;
            isCreatorGroupMember = data.canCreate || false; // If can create, user is in creator groups
            console.log('User permissions loaded:', 'canCreate:', canCreate, 'isAdmin:', data.isAdmin, 'isCreatorGroupMember:', isCreatorGroupMember);

            // Show or hide create button based on permissions
            updateCreateButtonVisibility();
        })
        .catch(error => {
            console.error('Error loading user permissions:', error);
            canCreate = false;
            isCreatorGroupMember = false;
            updateCreateButtonVisibility();
        });
}

function loadClusterParameters() {
    // Load filtered parameters (for create form) and all parameters
    // (for "More details" read-only display) in parallel.
    Promise.all([
        fetch('/api/cluster/parameters', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/cluster/parameters?all=true', { credentials: 'include' }).then(r => r.json())
    ])
        .then(([filtered, all]) => {
            clusterParameters = filtered || [];
            allClusterParameters = all || [];
        })
        .catch(error => {
            console.error('Error loading cluster parameters:', error);
            clusterParameters = [];
            allClusterParameters = [];
        });
}

function loadWorkerGroupFields() {
    fetch('/api/cluster/worker-group-fields', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            workerGroupFields = (data && data.fields) || [];
        })
        .catch(error => {
            console.error('Error loading worker group fields:', error);
            workerGroupFields = [];
        });
}

function loadEditableFields() {
    return fetch('/api/cluster/editable', {
        credentials: 'include'
    })
        .then(response => response.json())
        .then(fields => {
            editableFields = {};
            // Keys may come back in either casing (template tokens keep
            // their original casing, built-ins are lowercased by config
            // loading), so index by lowercase for robust lookup.
            (fields || []).forEach(f => { editableFields[f.key.toLowerCase()] = f; });
            // Re-render to apply edit-button visibility once config arrives.
            if (typeof loadClusters === 'function') loadClusters();
        })
        .catch(error => {
            console.error('Error loading editable fields:', error);
            editableFields = {};
        });
}
