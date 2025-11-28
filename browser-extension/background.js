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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'cast') {
        const serverUrl = `http://${serverHost}:${serverPort}`;
        fetch(`${serverUrl}/metadata`, {
            method: "POST",
            body: JSON.stringify({ source_url: message.url, start_time: message.currentTime }),
            headers: {
                "Content-Type": "application/json"
            }
        })
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