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