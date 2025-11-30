// Synchronization state management
const syncState = {
    active: false,
    videoElement: null,
    syncInterval: null,
    lastSeekTime: 0,
    isAdjusting: false,
    lastServerSeekTime: 0, // Timestamp when we last sent seek to server
    lastServerSeekPosition: null, // Position we last sent to server
    lastServerPosition: null, // Last known server position (for detecting resets)
    threshold: 1.0, // seconds - threshold for sync adjustment
    pollInterval: 1000, // milliseconds - how often to check server status
    serverHost: '127.0.0.1',
    serverPort: 8080,
    serverSeekCooldown: 3000, // milliseconds - ignore server sync after sending seek (increased for reliability)
    castButton: null, // Reference to the cast button element
    isHandlingClick: false // Flag to prevent multiple simultaneous click handlers
};

// Get server URL
function getServerUrl() {
    return `http://${syncState.serverHost}:${syncState.serverPort}`;
}

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['serverHost', 'serverPort']);
        if (result.serverHost) syncState.serverHost = result.serverHost;
        if (result.serverPort) syncState.serverPort = result.serverPort;
        console.log('[MTXCast] Settings loaded:', syncState.serverHost, syncState.serverPort);
    } catch (error) {
        console.error('[MTXCast] Failed to load settings:', error);
    }
}

// Initialize settings
loadSettings();

// Listen for settings updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'settingsUpdated') {
        loadSettings();
    }
});

// Get server status
async function getServerStatus() {
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'apiRequest',
            endpoint: '/status',
            method: 'GET'
        });
        
        if (result && result.success) {
            return result.data;
        }
        return null;
    } catch (error) {
        console.error('[MTXCast] Failed to get server status:', error);
        return null;
    }
}

// Stop casting on server
async function stopCasting() {
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'apiRequest',
            endpoint: '/control/stop',
            method: 'POST'
        });
        
        if (result && result.success) {
            console.log('[MTXCast] Server stop successful');
            return true;
        } else {
            console.error(`[MTXCast] Server stop failed: ${result?.error || 'Unknown error'}`);
            return false;
        }
    } catch (error) {
        console.error('[MTXCast] Failed to stop server:', error);
        return false;
    }
}

// Seek server to position
async function seekServer(position) {
    // Immediately record that we're sending a seek to prevent sync interference
    const seekStartTime = Date.now();
    syncState.lastServerSeekTime = seekStartTime;
    syncState.lastServerSeekPosition = position;
    
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'apiRequest',
            endpoint: '/control/seek',
            method: 'POST',
            body: { position: position }
        });
        
        if (result && result.success) {
            console.log(`[MTXCast] Server seek successful: ${position.toFixed(2)}s`);
            return true;
        } else {
            console.error(`[MTXCast] Server seek failed: ${result?.error || 'Unknown error'}`);
            // Reset on error so sync can continue
            syncState.lastServerSeekTime = 0;
            syncState.lastServerSeekPosition = null;
            return false;
        }
    } catch (error) {
        console.error('[MTXCast] Failed to seek server:', error);
        // Reset on error so sync can continue
        syncState.lastServerSeekTime = 0;
        syncState.lastServerSeekPosition = null;
        return false;
    }
}

// Synchronize video with server
async function syncWithServer() {
    if (!syncState.active || !syncState.videoElement) {
        return;
    }

    // Don't sync if we recently sent a seek to server (cooldown period)
    const timeSinceLastSeek = Date.now() - syncState.lastServerSeekTime;
    if (timeSinceLastSeek < syncState.serverSeekCooldown) {
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

    // Detect if server position has reset to 0 unexpectedly
    // This can happen during media loading or buffering issues
    if (serverPosition < 0.5 && syncState.lastServerPosition !== null && syncState.lastServerPosition > 1.0) {
        // Server position appears to have reset to 0, but we were at a later position
        // This is likely an unwanted reset - don't sync to 0
        console.log(`[MTXCast] Ignoring server position reset from ${syncState.lastServerPosition.toFixed(2)}s to ${serverPosition.toFixed(2)}s`);
        // Update lastServerPosition but don't sync
        syncState.lastServerPosition = serverPosition;
        return;
    }

    // If we recently sent a seek to server, be more lenient with sync
    if (syncState.lastServerSeekPosition !== null && timeSinceLastSeek < syncState.serverSeekCooldown * 2) {
        const serverDiffFromLastSeek = Math.abs(serverPosition - syncState.lastServerSeekPosition);
        
        // If server is close to the position we sent (within 1 second), don't sync
        // This allows server time to process the seek
        if (serverDiffFromLastSeek < 1.0) {
            // Server is at or near the position we sent, this is expected - don't sync
            syncState.lastServerPosition = serverPosition;
            return;
        }
        
        // If server is still far from the position we sent after cooldown, 
        // it might have failed - allow sync but with higher threshold
        if (timeSinceLastSeek > syncState.serverSeekCooldown) {
            // Use a higher threshold to avoid unnecessary syncs during seek processing
            if (diff < syncState.threshold * 2) {
                syncState.lastServerPosition = serverPosition;
                return;
            }
        }
    }

    // If difference exceeds threshold and we're not currently adjusting, sync the video
    if (diff > syncState.threshold && !syncState.isAdjusting) {
        // Don't sync to 0 if video is at a reasonable position (likely unwanted reset)
        if (serverPosition < 0.5 && videoPosition > 1.0) {
            console.log(`[MTXCast] Ignoring sync to 0: Server=${serverPosition.toFixed(2)}s, Video=${videoPosition.toFixed(2)}s`);
            syncState.lastServerPosition = serverPosition;
            return;
        }
        
        console.log(`[MTXCast] Sync: Server=${serverPosition.toFixed(2)}s, Video=${videoPosition.toFixed(2)}s, Diff=${diff.toFixed(2)}s`);
        
        syncState.isAdjusting = true;
        video.currentTime = serverPosition;
        syncState.lastServerPosition = serverPosition;
        
        // Reset adjusting flag after a longer delay to prevent immediate re-triggering
        setTimeout(() => {
            syncState.isAdjusting = false;
        }, 1500);
    } else {
        // Update last server position even if we don't sync
        syncState.lastServerPosition = serverPosition;
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
    syncState.lastServerPosition = null; // Reset server position tracking

    // Poll server status periodically
    syncState.syncInterval = setInterval(syncWithServer, syncState.pollInterval);

    // Track last known position for jump detection
    syncState.lastVideoTime = videoElement.currentTime;

    // Listen for user-initiated seeks
    const handleSeek = async () => {
        // Only sync if this is a user-initiated seek (not our own adjustment)
        if (!syncState.isAdjusting && syncState.active) {
            const currentTime = videoElement.currentTime;
            console.log(`[MTXCast] User seek detected: ${currentTime.toFixed(2)}s`);
            
            // Temporarily mark as adjusting to prevent sync interference
            syncState.isAdjusting = true;
            
            // Send seek to server and wait for completion
            const success = await seekServer(currentTime);
            
            if (success) {
                // Keep adjusting flag for a bit longer to ensure server processes the seek
                setTimeout(() => {
                    syncState.isAdjusting = false;
                }, 500);
            } else {
                // Reset immediately on failure
                syncState.isAdjusting = false;
            }
        }
    };

    // Listen for seeking events - seeked fires when seek completes
    const seekedHandler = () => {
        if (!syncState.isAdjusting) {
            handleSeek();
        }
    };

    // Track timeupdate for jump detection
    let lastTimeupdateTime = Date.now();
    const timeupdateHandler = () => {
        if (syncState.isAdjusting) {
            return;
        }

        const currentTime = videoElement.currentTime;
        const lastTime = syncState.lastVideoTime;
        const now = Date.now();
        const timeSinceLastUpdate = now - lastTimeupdateTime;
        
        // Only check for jumps if enough time has passed (avoid checking every frame)
        if (timeSinceLastUpdate < 100) {
            return;
        }

        const jump = Math.abs(currentTime - lastTime);
        
        // Detect large jumps (user seeking)
        // Normal playback advances gradually, so jumps > 0.5s are likely user seeks
        // Also check that the jump is not just normal playback (consider time elapsed)
        const expectedAdvance = (timeSinceLastUpdate / 1000) * 1.0; // Assume 1x playback speed
        if (jump > 0.5 && jump > expectedAdvance * 1.5) {
            handleSeek();
        }

        syncState.lastVideoTime = currentTime;
        lastTimeupdateTime = now;
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
    syncState.lastServerSeekTime = 0;
    syncState.lastServerSeekPosition = null;
    syncState.lastServerPosition = null;
    
    // Don't clean up position updater - button still needs position updates
    // The position updater and interval will continue to work as long as
    // syncState.castButton and syncState.videoElementForButton exist
    
    // Don't remove button from DOM - just update its state
    // The button should remain visible for future casting
    // Note: videoElementForButton is kept so the button can still reference the video
    
    // Update button state (will hide it, but keep it in DOM for hover to show)
    updateCastButton(false);

    console.log('[MTXCast] Synchronization stopped');
}

// Update cast button state
function updateCastButton(isCasting) {
    if (!syncState.castButton) {
        return;
    }
    
    if (isCasting) {
        syncState.castButton.innerHTML = '⏹ Stop';
        syncState.castButton.title = 'Stop casting';
        syncState.castButton.style.backgroundColor = 'rgba(200, 0, 0, 0.7)';
        // Always show button when casting
        syncState.castButton.style.opacity = '1';
    } else {
        syncState.castButton.innerHTML = '📺 Cast';
        syncState.castButton.title = 'Cast this video';
        syncState.castButton.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        // Hide button when not casting (will show on hover)
        syncState.castButton.style.opacity = '0';
    }
}

// Add cast button to video elements
function addCastButtonToVideo(videoElement) {
    // Skip if button already exists
    if (document.querySelector('.mtxcast-button')) {
        return;
    }

    // Create button element
    const castButton = document.createElement('button');
    castButton.className = 'mtxcast-button';
    castButton.innerHTML = '📺 Cast';
    castButton.title = 'Cast this video';
    
    // Store button reference and video element
    syncState.castButton = castButton;
    syncState.videoElementForButton = videoElement;
    
    // Function to update button position based on video element
    const updateButtonPosition = () => {
        const rect = videoElement.getBoundingClientRect();
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        castButton.style.left = `${rect.right - 120 + scrollX}px`;
        castButton.style.top = `${rect.top + 10 + scrollY}px`;
    };
    
    // Add styles
    castButton.style.cssText = `
        position: absolute !important;
        z-index: 2147483647 !important;
        background-color: rgba(0, 0, 0, 0.7) !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 8px 12px !important;
        font-size: 14px !important;
        font-weight: bold !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        transition: opacity 0.3s, background-color 0.2s !important;
        opacity: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
    `;
    
    // Initial position update
    updateButtonPosition();
    
    // Update position on scroll and resize
    const positionUpdater = () => {
        if (syncState.castButton && syncState.videoElementForButton) {
            updateButtonPosition();
        }
    };
    window.addEventListener('scroll', positionUpdater, true);
    window.addEventListener('resize', positionUpdater);
    
    // Store updater for cleanup
    syncState.positionUpdater = positionUpdater;

    // Show button on hover (always visible when casting)
    const showButton = () => {
        if (!syncState.active) {
            castButton.style.opacity = '1';
        }
    };

    const hideButton = () => {
        if (!syncState.active) {
            castButton.style.opacity = '0';
        }
    };

    // Show button when hovering over video or parent container
    videoElement.addEventListener('mouseenter', showButton);
    videoElement.addEventListener('mouseleave', hideButton);
    
    // Also show on button hover
    castButton.addEventListener('mouseenter', () => {
        castButton.style.opacity = '1';
        if (syncState.active) {
            castButton.style.backgroundColor = 'rgba(200, 0, 0, 0.9)';
        } else {
            castButton.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        }
    });
    castButton.addEventListener('mouseleave', () => {
        if (!syncState.active) {
            castButton.style.opacity = '0';
        }
        if (syncState.active) {
            castButton.style.backgroundColor = 'rgba(200, 0, 0, 0.7)';
        } else {
            castButton.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        }
    });

    // Click handler with multiple event types for reliability
    const handleClick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        
        // Prevent multiple simultaneous click handlers
        if (syncState.isHandlingClick) {
            console.log('[MTXCast] Click handler already processing, ignoring duplicate event');
            return;
        }
        
        syncState.isHandlingClick = true;
        
        try {
            const targetVideo = syncState.videoElementForButton || videoElement;
            
            // If already casting, stop casting
            if (syncState.active) {
                console.log('[MTXCast] Stop button clicked');
                
                // Stop synchronization
                stopSync();
                
                // Stop server casting
                await stopCasting();
                
                // Remove casting state from video
                targetVideo.classList.remove('mtxcast-casting');
                
                // Update button
                updateCastButton(false);
                
                console.log('[MTXCast] Casting stopped');
                return;
            }
            
            // Start casting
            // Apply casting.css by adding a class to the video element
            targetVideo.classList.add('mtxcast-casting');
            targetVideo.pause();
            
            console.log('[MTXCast] Cast button clicked');
            console.log('[MTXCast] Video element:', targetVideo);
            console.log('[MTXCast] Video source:', targetVideo.src || targetVideo.currentSrc);
            console.log('[MTXCast] Video duration:', targetVideo.duration);
            console.log('[MTXCast] Video current time:', targetVideo.currentTime);
            console.log('[MTXCast] Video paused:', targetVideo.paused);
            console.log('[MTXCast] Casting CSS applied');

            let currentTime = targetVideo.currentTime;
            let url = location.href;
            
            chrome.runtime.sendMessage({
                type: 'cast',
                currentTime: currentTime,
                url: url
            });

            // Start synchronization
            startSync(targetVideo);
            
            // Update button
            updateCastButton(true);
        } finally {
            // Reset flag after a short delay to allow state to settle
            setTimeout(() => {
                syncState.isHandlingClick = false;
            }, 300);
        }
    };
    
    castButton.addEventListener('click', handleClick, true);
    castButton.addEventListener('mousedown', handleClick, true);
    castButton.addEventListener('touchstart', handleClick, true);

    // Insert button into document body for better z-index control
    document.body.appendChild(castButton);
    
    // Update position periodically to handle dynamic layout changes
    const positionInterval = setInterval(() => {
        if (syncState.castButton && syncState.videoElementForButton) {
            const rect = syncState.videoElementForButton.getBoundingClientRect();
            const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
            const scrollY = window.pageYOffset || document.documentElement.scrollTop;
            
            syncState.castButton.style.left = `${rect.right - 120 + scrollX}px`;
            syncState.castButton.style.top = `${rect.top + 10 + scrollY}px`;
        } else {
            clearInterval(positionInterval);
        }
    }, 100);
    
    // Store interval for cleanup
    syncState.positionInterval = positionInterval;
    
    // Initially hide the button
    updateCastButton(false);
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
