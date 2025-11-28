// Convert seconds to MM:SS or HH:MM:SS format
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    } else {
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
}

setInterval(async () => {
    let status = await fetch("http://127.0.0.1:8080/status").then(r => r.json())
    if (status.stream_type === "METADATA") {
        document.getElementById("seekRange").value = status.position
        document.getElementById("seekRange").max = status.duration
        document.getElementById("seekRangeOut").textContent = formatTime(status.position)
    }
}, 1000)

document.getElementById("seekRange").addEventListener("input", async e => {
    const position = parseFloat(e.target.value)
    document.getElementById("seekRangeOut").textContent = formatTime(position)
    await fetch("http://127.0.0.1:8080/control/seek", {
        method: "POST",
        body: JSON.stringify({ position: position }),
        headers: {
            "Content-Type": "application/json"
        }
    })
})

document.getElementById("playButton").addEventListener("click", async () => {
    await fetch("http://127.0.0.1:8080/control/play", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    })
})

document.getElementById("pauseButton").addEventListener("click", async () => {
    await fetch("http://127.0.0.1:8080/control/pause", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    })
})

// Screen mirroring with WHIP
let whipClient = null;
let peerConnection = null;
let displayStream = null;

document.getElementById("mirrorButton").addEventListener("click", async () => {
    try {
        // Request screen capture using getDisplayMedia
        displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        // Create RTCPeerConnection
        peerConnection = new RTCPeerConnection({
            bundlePolicy: "max-bundle"
        });

        // Add tracks from display stream to peer connection
        for (const track of displayStream.getTracks()) {
            peerConnection.addTransceiver(track, { direction: 'sendonly' });
        }

        // Handle ICE connection state changes
        peerConnection.addEventListener("iceconnectionstatechange", (event) => {
            if (peerConnection.iceConnectionState === "failed" || 
                peerConnection.iceConnectionState === "disconnected") {
                peerConnection.restartIce();
            }
        });

        // Handle track ended (user stops sharing)
        displayStream.getVideoTracks()[0].addEventListener("ended", () => {
            stopMirroring();
        });

        // Import and initialize WHIP client
        const { WHIPClient } = await import(chrome.runtime.getURL("/libs/whip.js"));
        whipClient = new WHIPClient();

        // Publish to WHIP endpoint
        const whipUrl = "http://localhost:8080/whip";
        await whipClient.publish(peerConnection, whipUrl, null);

        console.log("Screen mirroring started successfully");
    } catch (error) {
        console.error("Error starting screen mirroring:", error);
        alert("Failed to start screen mirroring: " + error.message);
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

document.getElementById("mirrorStopButton").addEventListener("click", async () => {
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

        console.log("Screen mirroring stopped");
    } catch (error) {
        console.error("Error stopping screen mirroring:", error);
    }
}