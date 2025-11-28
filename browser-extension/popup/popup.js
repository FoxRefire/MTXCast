// Default settings
const DEFAULT_SETTINGS = {
    serverHost: '127.0.0.1',
    serverPort: 8080
};

// Current settings
let settings = { ...DEFAULT_SETTINGS };

// Convert seconds to MM:SS or HH:MM:SS format
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}

// Get server URL
function getServerUrl() {
    return `http://${settings.serverHost}:${settings.serverPort}`;
}

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['serverHost', 'serverPort']);
        if (result.serverHost) settings.serverHost = result.serverHost;
        if (result.serverPort) settings.serverPort = result.serverPort;
        
        // Update UI
        document.getElementById('serverHost').value = settings.serverHost;
        document.getElementById('serverPort').value = settings.serverPort;
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings to storage
async function saveSettings() {
    const host = document.getElementById('serverHost').value.trim();
    const port = parseInt(document.getElementById('serverPort').value);
    
    if (!host) {
        showMessage('サーバーIP/ホスト名を入力してください', 'error');
        return;
    }
    
    if (isNaN(port) || port < 1 || port > 65535) {
        showMessage('有効なポート番号を入力してください (1-65535)', 'error');
        return;
    }
    
    try {
        settings.serverHost = host;
        settings.serverPort = port;
        await chrome.storage.sync.set({
            serverHost: host,
            serverPort: port
        });
        showMessage('設定を保存しました', 'success');
        
        // Notify content script to reload settings
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'settingsUpdated' });
            }
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
        showMessage('設定の保存に失敗しました', 'error');
    }
}

// Show status message
function showMessage(message, type) {
    const messageEl = document.getElementById('settingsMessage');
    messageEl.textContent = message;
    messageEl.className = `status-message ${type}`;
    setTimeout(() => {
        messageEl.className = 'status-message';
    }, 3000);
}

// Fetch server status
async function fetchStatus() {
    try {
        const response = await fetch(`${getServerUrl()}/status`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch status:', error);
        return null;
    }
}

// Update UI with server status
async function updateStatus() {
    const status = await fetchStatus();
    
    if (!status) {
        document.getElementById('streamStatus').textContent = '接続エラー';
        document.getElementById('streamStatus').style.color = '#dc3545';
        document.getElementById('seekSection').style.display = 'none';
        document.getElementById('titleItem').style.display = 'none';
        return;
    }
    
    // Update status
    const statusText = {
        'IDLE': '待機中',
        'METADATA': 'メタデータ再生中',
        'WHIP': 'WHIPストリーム中'
    };
    document.getElementById('streamStatus').textContent = statusText[status.stream_type] || status.stream_type;
    document.getElementById('streamStatus').style.color = status.stream_type === 'IDLE' ? '#6c757d' : '#28a745';
    
    // Update title
    if (status.title) {
        document.getElementById('streamTitle').textContent = status.title;
        document.getElementById('titleItem').style.display = 'flex';
    } else {
        document.getElementById('titleItem').style.display = 'none';
    }
    
    // Update seek control for METADATA streams
    if (status.stream_type === 'METADATA' && status.position !== undefined && status.duration !== undefined) {
        const seekRange = document.getElementById('seekRange');
        const currentTimeEl = document.getElementById('currentTime');
        const durationEl = document.getElementById('duration');
        
        seekRange.max = status.duration;
        seekRange.value = status.position;
        currentTimeEl.textContent = formatTime(status.position);
        durationEl.textContent = formatTime(status.duration);
        document.getElementById('seekSection').style.display = 'block';
    } else {
        document.getElementById('seekSection').style.display = 'none';
    }
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        
        // Update buttons
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update content
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}-tab`).classList.add('active');
    });
});

// Seek range input
document.getElementById('seekRange').addEventListener('input', async (e) => {
    const position = parseFloat(e.target.value);
    document.getElementById('currentTime').textContent = formatTime(position);
    
    try {
        await fetch(`${getServerUrl()}/control/seek`, {
            method: 'POST',
            body: JSON.stringify({ position: position }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Failed to seek:', error);
    }
});

// Control buttons
document.getElementById('playButton').addEventListener('click', async () => {
    try {
        await fetch(`${getServerUrl()}/control/play`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Failed to play:', error);
    }
});

document.getElementById('pauseButton').addEventListener('click', async () => {
    try {
        await fetch(`${getServerUrl()}/control/pause`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Failed to pause:', error);
    }
});

document.getElementById('stopButton').addEventListener('click', async () => {
    try {
        await fetch(`${getServerUrl()}/control/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Failed to stop:', error);
    }
});

// Save settings button
document.getElementById('saveSettingsButton').addEventListener('click', saveSettings);

// Screen mirroring with WHIP
let whipClient = null;
let peerConnection = null;
let displayStream = null;

document.getElementById('mirrorButton').addEventListener('click', async () => {
    try {
        // Request screen capture using getDisplayMedia
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        // Create RTCPeerConnection
        peerConnection = new RTCPeerConnection({
            bundlePolicy: 'max-bundle'
        });

        // Add tracks from display stream to peer connection
        for (const track of displayStream.getTracks()) {
            peerConnection.addTransceiver(track, { direction: 'sendonly' });
        }

        // Handle ICE connection state changes
        peerConnection.addEventListener('iceconnectionstatechange', (event) => {
            if (peerConnection.iceConnectionState === 'failed' || 
                peerConnection.iceConnectionState === 'disconnected') {
                peerConnection.restartIce();
            }
        });

        // Handle track ended (user stops sharing)
        displayStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopMirroring();
        });

        // Import and initialize WHIP client
        const { WHIPClient } = await import(chrome.runtime.getURL('/libs/whip.js'));
        whipClient = new WHIPClient();

        // Publish to WHIP endpoint
        const whipUrl = `${getServerUrl()}/whip`;
        await whipClient.publish(peerConnection, whipUrl, null);

        // Update UI
        document.getElementById('mirrorButton').disabled = true;
        document.getElementById('mirrorStopButton').disabled = false;

        console.log('Screen mirroring started successfully');
    } catch (error) {
        console.error('Error starting screen mirroring:', error);
        alert('画面ミラーリングの開始に失敗しました: ' + error.message);
        // Clean up on error
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
    }
});

document.getElementById('mirrorStopButton').addEventListener('click', async () => {
    stopMirroring();
});

async function stopMirroring() {
    try {
        // Stop WHIP client
        if (whipClient) {
            await whipClient.stop();
            whipClient = null;
        }

        // Stop all tracks
        if (displayStream) {
            displayStream.getTracks().forEach(track => track.stop());
            displayStream = null;
        }

        // Close peer connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }

        // Update UI
        document.getElementById('mirrorButton').disabled = false;
        document.getElementById('mirrorStopButton').disabled = true;

        console.log('Screen mirroring stopped');
    } catch (error) {
        console.error('Error stopping screen mirroring:', error);
    }
}

// Initialize
(async () => {
    await loadSettings();
    updateStatus();
    setInterval(updateStatus, 1000);
})();
