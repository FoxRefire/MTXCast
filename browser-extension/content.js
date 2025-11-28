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
        
        console.log('[MTXCast] Cast button clicked');
        console.log('[MTXCast] Video element:', videoElement);
        console.log('[MTXCast] Video source:', videoElement.src || videoElement.currentSrc);
        console.log('[MTXCast] Video duration:', videoElement.duration);
        console.log('[MTXCast] Video current time:', videoElement.currentTime);
        console.log('[MTXCast] Video paused:', videoElement.paused);
        console.log('[MTXCast] Casting CSS applied');

        let currentTime = videoElement.currentTime;
        let url = location.href
        chrome.runtime.sendMessage({
            type: 'cast',
            currentTime: currentTime,
            url: url
        });
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

console.log('[MTXCast] Content script loaded');
