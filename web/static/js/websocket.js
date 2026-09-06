// WebSocket connection management and auto-refresh fallback.

// WebSocket connection
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = protocol + '//' + window.location.host + '/ws';

    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
        console.log('WebSocket connected');
        updateConnectionStatus(true);
        reconnectInterval = 5000;
    };

    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            if (data.clusters) {
                updateClusters(data.clusters);
                updateStats(data.clusters);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };

    ws.onclose = function() {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false);

        // Check if session is still valid before reconnecting
        checkSessionAndReconnect();
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
        statusEl.className = 'status-indicator connected';
        statusEl.innerHTML = '<span class="material-symbols-outlined">cloud_done</span><span>Connected</span>';
    } else {
        statusEl.className = 'status-indicator disconnected';
        statusEl.innerHTML = '<span class="material-symbols-outlined">cloud_off</span><span>Disconnected</span>';
    }
}

function checkSessionAndReconnect() {
    // Try to fetch user info to check if session is still valid
    fetch('/api/user', {
        credentials: 'include'
    })
    .then(response => {
        if (response.status === 401 || response.status === 403) {
            // Session expired, redirect to login
            console.log('Session expired, redirecting to login...');
            window.location.reload();
        } else if (response.ok) {
            // Session is valid, continue reconnecting
            console.log('Session valid, attempting to reconnect WebSocket...');
            setTimeout(connectWebSocket, reconnectInterval);
            reconnectInterval = Math.min(reconnectInterval * 1.5, 30000);
        } else {
            // Other error, try reconnecting anyway
            setTimeout(connectWebSocket, reconnectInterval);
            reconnectInterval = Math.min(reconnectInterval * 1.5, 30000);
        }
    })
    .catch(error => {
        console.error('Error checking session:', error);
        // Network error, try reconnecting
        setTimeout(connectWebSocket, reconnectInterval);
        reconnectInterval = Math.min(reconnectInterval * 1.5, 30000);
    });
}

// Auto-refresh functionality
function startAutoRefresh() {
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }

    // Set up periodic refresh as fallback
    refreshInterval = setInterval(() => {
        console.log('Auto-refreshing cluster status...');
        loadClusters();
    }, REFRESH_INTERVAL);

    console.log('Auto-refresh started (every 30 seconds)');
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('Auto-refresh stopped');
    }
}
