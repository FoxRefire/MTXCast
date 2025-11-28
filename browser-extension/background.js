chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'cast') {
        fetch("http://127.0.0.1:8080/metadata", {
            method: "POST",
            body: JSON.stringify({ source_url: message.url, start_time: message.currentTime }),
            headers: {
                "Content-Type": "application/json"
            }
        })
    }
});