// Synchronization state management
const syncState = {
    active: false,
    videoElement: null,
    syncInterval: null,
    lastSeekTime: 0,
    isAdjusting: false,
    threshold: 1.0, // seconds - threshold for sync adjustment
    pollInterval: 1000, // milliseconds - how often to check server status
    serverUrl: 'http://127.0.0.1:8080'
};

// Get server status
async function getServerStatus() {
    try {
        const response = await fetch(`${syncState.serverUrl}/status`);
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (error) {
        console.error('[MTXCast] Failed to get server status:', error);
        return null;
    }
}

// Seek server to position
async function seekServer(position) {
    try {
        await fetch(`${syncState.serverUrl}/control/seek`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ position: position })
        });
        return true;
    } catch (error) {
        console.error('[MTXCast] Failed to seek server:', error);
        return false;
    }
}

// Synchronize video with server
async function syncWithServer() {
    if (!syncState.active || !syncState.videoElement) {
        return;
    }

    const video = syncState.videoElement;
    const status = await getServerStatus();

    if (!status || status.stream_type !== 'METADATA') {
        return;
    }

    // Skip if position/duration is not available
    if (status.position === undefined || status.duration === undefined) {
        return;
    }

    const serverPosition = status.position;
    const videoPosition = video.currentTime;
    const diff = Math.abs(serverPosition - videoPosition);

    // If difference exceeds threshold and we're not currently adjusting, sync the video
    if (diff > syncState.threshold && !syncState.isAdjusting) {
        console.log(`[MTXCast] Sync: Server=${serverPosition.toFixed(2)}s, Video=${videoPosition.toFixed(2)}s, Diff=${diff.toFixed(2)}s`);
        
        syncState.isAdjusting = true;
        video.currentTime = serverPosition;
        
        // Reset adjusting flag after a short delay
        setTimeout(() => {
            syncState.isAdjusting = false;
        }, 500);
    }
}

// Start synchronization
function startSync(videoElement) {
    if (syncState.active) {
        stopSync();
    }

    syncState.active = true;
    syncState.videoElement = videoElement;
    syncState.lastSeekTime = Date.now();

    // Poll server status periodically
    syncState.syncInterval = setInterval(syncWithServer, syncState.pollInterval);

    // Track last known position for jump detection
    syncState.lastVideoTime = videoElement.currentTime;

    // Listen for user-initiated seeks
    const handleSeek = () => {
        // Only sync if this is a user-initiated seek (not our own adjustment)
        if (!syncState.isAdjusting && syncState.active) {
            const currentTime = videoElement.currentTime;
            console.log(`[MTXCast] User seek detected: ${currentTime.toFixed(2)}s`);
            seekServer(currentTime);
        }
    };

    // Listen for seeking events - seeked fires when seek completes
    const seekedHandler = () => {
        if (!syncState.isAdjusting) {
            handleSeek();
        }
    };

    // Listen for timeupdate to detect large jumps (fallback for cases where seeked doesn't fire)
    const timeupdateHandler = () => {
        if (syncState.isAdjusting) {
            return;
        }

        const currentTime = videoElement.currentTime;
        const lastTime = syncState.lastVideoTime;
        const jump = Math.abs(currentTime - lastTime);

        // Detect large jumps (user seeking)
        // Normal playback advances gradually, so jumps > 0.5s are likely user seeks
        if (jump > 0.5) {
            handleSeek();
        }

        syncState.lastVideoTime = currentTime;
    };

    videoElement.addEventListener('seeked', seekedHandler);
    videoElement.addEventListener('timeupdate', timeupdateHandler);

    // Store event handlers for cleanup
    videoElement._mtxcastSeekedHandler = seekedHandler;
    videoElement._mtxcastTimeupdateHandler = timeupdateHandler;

    console.log('[MTXCast] Synchronization started');
}

// Stop synchronization
function stopSync() {
    if (syncState.syncInterval) {
        clearInterval(syncState.syncInterval);
        syncState.syncInterval = null;
    }

    if (syncState.videoElement) {
        if (syncState.videoElement._mtxcastSeekedHandler) {
            syncState.videoElement.removeEventListener('seeked', syncState.videoElement._mtxcastSeekedHandler);
            delete syncState.videoElement._mtxcastSeekedHandler;
        }
        if (syncState.videoElement._mtxcastTimeupdateHandler) {
            syncState.videoElement.removeEventListener('timeupdate', syncState.videoElement._mtxcastTimeupdateHandler);
            delete syncState.videoElement._mtxcastTimeupdateHandler;
        }
    }

    syncState.active = false;
    syncState.videoElement = null;
    syncState.isAdjusting = false;
    syncState.lastVideoTime = null;

    console.log('[MTXCast] Synchronization stopped');
}

// Add cast button to video elements
function addCastButtonToVideo(videoElement) {
    // Skip if button already exists
    if (videoElement.parentElement.querySelector('.mtxcast-button')) {
        return;
    }

    // Create button element
    const castButton = document.createElement('button');
    castButton.className = 'mtxcast-button';
    castButton.innerHTML = '📺 Cast';
    castButton.title = 'Cast this video';
    
    // Add styles
    castButton.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        transition: background-color 0.2s;
    `;

    // Hover effect
    castButton.addEventListener('mouseenter', () => {
        castButton.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    });
    castButton.addEventListener('mouseleave', () => {
        castButton.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    });

    // Click handler - apply casting.css and debug log
    castButton.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // Apply casting.css by adding a class to the video element
        videoElement.classList.add('mtxcast-casting');
        videoElement.muted = true;
        
        console.log('[MTXCast] Cast button clicked');
        console.log('[MTXCast] Video element:', videoElement);
        console.log('[MTXCast] Video source:', videoElement.src || videoElement.currentSrc);
        console.log('[MTXCast] Video duration:', videoElement.duration);
        console.log('[MTXCast] Video current time:', videoElement.currentTime);
        console.log('[MTXCast] Video paused:', videoElement.paused);
        console.log('[MTXCast] Casting CSS applied');

        let currentTime = videoElement.currentTime;
        let url = location.href;
        
        chrome.runtime.sendMessage({
            type: 'cast',
            currentTime: currentTime,
            url: url
        });

        // Start synchronization
        startSync(videoElement);
    });

    // Make sure parent element has relative positioning
    const parent = videoElement.parentElement;
    if (parent && window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
    }

    // Insert button into parent element
    parent.insertBefore(castButton, videoElement.nextSibling);
}

// Process all video elements on the page
function processVideoElements() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        addCastButtonToVideo(video);
    });
}

// Initial processing
processVideoElements();

// Watch for dynamically added video elements
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if the added node is a video element
                if (node.tagName === 'VIDEO') {
                    addCastButtonToVideo(node);
                }
                // Check for video elements within the added node
                const videos = node.querySelectorAll?.('video');
                if (videos) {
                    videos.forEach(video => {
                        addCastButtonToVideo(video);
                    });
                }
            }
        });
    });
});

// Start observing
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Stop synchronization when page is unloaded or video is removed
window.addEventListener('beforeunload', () => {
    stopSync();
});

// Watch for video element removal
const videoObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Check if the removed node is the video we're syncing
                if (node === syncState.videoElement || node.contains?.(syncState.videoElement)) {
                    console.log('[MTXCast] Video element removed, stopping sync');
                    stopSync();
                }
            }
        });
    });
});

videoObserver.observe(document.body, {
    childList: true,
    subtree: true
});

console.log('[MTXCast] Content script loaded');
