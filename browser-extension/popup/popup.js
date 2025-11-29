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
    
    // Update volume control
    if (status.volume !== undefined) {
        const volumePercent = Math.round(status.volume * 100);
        const volumeRange = document.getElementById('volumeRange');
        const volumeValue = document.getElementById('volumeValue');
        
        // Only update if user is not currently changing volume
        if (!isUserChangingVolume) {
            volumeRange.value = volumePercent;
        }
        volumeValue.textContent = `${volumePercent}%`;
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

// Volume range input
let isUserChangingVolume = false;
document.getElementById('volumeRange').addEventListener('input', async (e) => {
    const volumePercent = parseInt(e.target.value);
    document.getElementById('volumeValue').textContent = `${volumePercent}%`;
    isUserChangingVolume = true;
    
    try {
        const volume = volumePercent / 100.0; // Convert to 0.0-1.0 range
        await fetch(`${getServerUrl()}/control/volume`, {
            method: 'POST',
            body: JSON.stringify({ volume: volume }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Failed to set volume:', error);
    } finally {
        // Reset flag after a short delay to allow status update
        setTimeout(() => {
            isUserChangingVolume = false;
        }, 500);
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

// File upload functionality
let selectedFile = null;

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// File input handler
document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = formatFileSize(file.size);
        document.getElementById('fileInfo').style.display = 'flex';
        document.getElementById('uploadButton').disabled = false;
    } else {
        selectedFile = null;
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('uploadButton').disabled = true;
    }
});

// Upload button handler
document.getElementById('uploadButton').addEventListener('click', async () => {
    if (!selectedFile) {
        return;
    }

    const uploadButton = document.getElementById('uploadButton');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    // Disable button and show progress
    uploadButton.disabled = true;
    uploadProgress.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';

    try {
        // Create FormData
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('start_time', '0.0');

        // Upload file with progress tracking
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressFill.style.width = percentComplete + '%';
                progressText.textContent = Math.round(percentComplete) + '%';
            }
        });

        xhr.addEventListener('load', async () => {
            if (xhr.status === 200) {
                progressFill.style.width = '100%';
                progressText.textContent = '100%';
                
                // Wait a bit then hide progress and update status
                setTimeout(() => {
                    uploadProgress.style.display = 'none';
                    uploadButton.disabled = false;
                    updateStatus();
                }, 500);
            } else {
                throw new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`);
            }
        });

        xhr.addEventListener('error', () => {
            throw new Error('Upload failed: Network error');
        });

        // Send request
        xhr.open('POST', `${getServerUrl()}/upload`);
        xhr.send(formData);

    } catch (error) {
        console.error('File upload error:', error);
        alert('ファイルのアップロードに失敗しました: ' + error.message);
        uploadProgress.style.display = 'none';
        uploadButton.disabled = false;
    }
});

// Cast URL function
async function castUrl(url, startTime = 0) {
    try {
        const response = await fetch(`${getServerUrl()}/metadata`, {
            method: "POST",
            body: JSON.stringify({ source_url: url, start_time: startTime }),
            headers: {
                "Content-Type": "application/json"
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return true;
    } catch (error) {
        console.error('Failed to cast URL:', error);
        return false;
    }
}

// Get current tab URL
async function getCurrentTabUrl() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            return tabs[0].url;
        }
        return null;
    } catch (error) {
        console.error('Failed to get current tab URL:', error);
        return null;
    }
}

// Cast current page button
document.getElementById('castCurrentPageButton').addEventListener('click', async () => {
    const button = document.getElementById('castCurrentPageButton');
    const originalText = button.innerHTML;
    
    button.disabled = true;
    button.innerHTML = '<span class="icon">⏳</span><span>キャスト中...</span>';
    
    try {
        const url = await getCurrentTabUrl();
        if (!url) {
            showMessage('現在のページのURLを取得できませんでした', 'error');
            return;
        }
        
        const success = await castUrl(url, 0);
        if (success) {
            showMessage('キャストを開始しました', 'success');
            // Update input field with current URL
            document.getElementById('castUrlInput').value = url;
            // Update status
            setTimeout(updateStatus, 500);
        } else {
            showMessage('キャストの開始に失敗しました', 'error');
        }
    } catch (error) {
        console.error('Error casting current page:', error);
        showMessage('エラーが発生しました: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
});

// Cast URL button
document.getElementById('castUrlButton').addEventListener('click', async () => {
    const button = document.getElementById('castUrlButton');
    const input = document.getElementById('castUrlInput');
    const url = input.value.trim();
    
    if (!url) {
        showMessage('URLを入力してください', 'error');
        return;
    }
    
    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        showMessage('有効なURLを入力してください', 'error');
        return;
    }
    
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="icon">⏳</span><span>キャスト中...</span>';
    
    try {
        const success = await castUrl(url, 0);
        if (success) {
            showMessage('キャストを開始しました', 'success');
            // Update status
            setTimeout(updateStatus, 500);
        } else {
            showMessage('キャストの開始に失敗しました', 'error');
        }
    } catch (error) {
        console.error('Error casting URL:', error);
        showMessage('エラーが発生しました: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
});

// Initialize current page URL in input field
(async () => {
    const url = await getCurrentTabUrl();
    if (url) {
        document.getElementById('castUrlInput').value = url;
    }
})();

// Initialize
(async () => {
    await loadSettings();
    updateStatus();
    setInterval(updateStatus, 1000);
})();
