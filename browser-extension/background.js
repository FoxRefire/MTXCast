// Default settings
let serverHost = '127.0.0.1';
let serverPort = 8080;

// Load settings from storage
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['serverHost', 'serverPort']);
        if (result.serverHost) serverHost = result.serverHost;
        if (result.serverPort) serverPort = result.serverPort;
    } catch (error) {
        console.error('[MTXCast] Failed to load settings:', error);
    }
}

// Initialize settings
loadSettings();

// Listen for settings updates
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && (changes.serverHost || changes.serverPort)) {
        loadSettings();
    }
});

// Get server URL
function getServerUrl() {
    return `http://${serverHost}:${serverPort}`;
}

// API request handler
async function handleApiRequest(endpoint, method = 'GET', body = null) {
    const serverUrl = getServerUrl();
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(`${serverUrl}${endpoint}`, options);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // Try to parse as JSON, fallback to text
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return { success: true, data: await response.json() };
        } else {
            return { success: true, data: await response.text() };
        }
    } catch (error) {
        console.error(`[MTXCast] API request failed for ${endpoint}:`, error);
        return { success: false, error: error.message };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle async responses
    if (message.type === 'cast') {
        const serverUrl = getServerUrl();
        fetch(`${serverUrl}/metadata`, {
            method: "POST",
            body: JSON.stringify({ source_url: message.url, start_time: message.currentTime }),
            headers: {
                "Content-Type": "application/json"
            }
        }).then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            sendResponse({ success: false, error: error.message });
        });
        return true; // Keep channel open for async response
    }
    
    // Handle API requests
    if (message.type === 'apiRequest') {
        handleApiRequest(message.endpoint, message.method, message.body)
            .then((result) => {
                sendResponse(result);
            })
            .catch((error) => {
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep channel open for async response
    }
});

// Cast URL function
async function castUrl(url, startTime = 0) {
    const serverUrl = `http://${serverHost}:${serverPort}`;
    try {
        const response = await fetch(`${serverUrl}/metadata`, {
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
        console.error('[MTXCast] Failed to cast URL:', error);
        return false;
    }
}

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'cast-current-page',
        title: 'Cast this page',
        contexts: ['page', 'frame']
    });
    chrome.contextMenus.create({
        id: 'cast-link',
        title: 'Cast this link',
        contexts: ['link']
    });
});

// Handle context menu clicks
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'cast-current-page') {
        if (tab && tab.url) {
            const success = await castUrl(tab.url, 0);
            if (success) {
                console.log('[MTXCast] Page cast started:', tab.url);
            } else {
                console.error('[MTXCast] Failed to cast page:', tab.url);
            }
        }
    } else if (info.menuItemId === 'cast-link') {
        if (info.linkUrl) {
            const success = await castUrl(info.linkUrl, 0);
            if (success) {
                console.log('[MTXCast] Link cast started:', info.linkUrl);
            } else {
                console.error('[MTXCast] Failed to cast link:', info.linkUrl);
            }
        }
    }
});

if(chrome.windows){
    chrome.action.onClicked.addListener(() => {
        chrome.windows.create({
            url: "popup/popup.html",
            type: "popup",
            width: 380,
            height: 580
        });
    });
} else {
    chrome.action.onClicked.addListener(() => {
        chrome.tabs.create({url: "popup/popup.html"})
    })
}
