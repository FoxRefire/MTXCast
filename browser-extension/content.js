// When a message is received on clicking an icon, the audio in the DOM element is retrieved and responds to the pop-up script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let elements = findMediaElements()
    let promises = []
    let stream = createStream(elements[0])
    let connection = createPeerConnection(stream)
    let whip = startCast(connection)
    // Promise.allSettled(promises).then(arr => sendResponse(arr.map(r => r.value)))
    return true
})

// Workaround for some websites librezam wont work
const script = document.createElement('script');
script.type = 'text/javascript';
script.src = chrome.runtime.getURL("/utils/fixHeadlessAudio.js");
(document.head || document.documentElement).appendChild(script);

// Ensure Shadow-root is explored recursively (Fix for some websites such as reddit)
// https://stackoverflow.com/a/75787966/27020071
function findMediaElements() {
    const elements = Array.from(document.querySelectorAll('audio, video'))
    for (const {shadowRoot} of document.querySelectorAll("*")) {
        if (shadowRoot) {
            elements.push(...shadowRoot.querySelectorAll("audio, video"));
        }
    }
    return elements.filter(media => !media.paused);
}

function createStream(elem){
    let stream = elem.captureStream ? elem.captureStream() : elem.mozCaptureStream()

    if (!elem.classList.contains("librezamFlag") && !elem.captureStream){
        let audioCtx = new AudioContext()
        let source = audioCtx.createMediaElementSource(elem)
        source.connect(audioCtx.destination)
        elem.classList.add("librezamFlag")
    }
    return stream
}

function createPeerConnection(stream){
    const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" })
    for (const track of stream.getTracks()) {
        //You could add simulcast too here
        pc.addTransceiver(track, { 'direction': 'sendonly' });
    }
    pc.addEventListener("iceconnectionstatechange", (event) => {
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
            /* possibly reconfigure the connection in some way here */
            /* then request ICE restart */
            pc.restartIce();
        }
    });
    return pc
}

async function startCast(connection) {
    const { WHIPClient } = await import(chrome.runtime.getURL("/libs/whip.js"));
    const whip = new WHIPClient();
    const url = "http://127.0.0.1:8889/mystream/whip"
    whip.publish(connection, url, null);
    return whip
}
