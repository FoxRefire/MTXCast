let audios = (await getAudiosInTab()).filter(a=> a.length)

async function getAudiosInTab(){
    let tabId = await chrome.tabs.query({active:true, currentWindow:true}).then(t => t[0].id)
    let time = await chrome.storage.local.get("time").then(o => Number(o.time)) || 3200
    let responses = await sendMessagePromises(tabId, time).then(p => Promise.allSettled(p)).then(arr => arr.map(r => r.value))
    return [].concat(...responses).map(arr => new Uint8Array(arr))
}

async function sendMessagePromises(tabId, ms){
    let promises = []
    let frames = await chrome.webNavigation.getAllFrames({tabId:tabId})
    frames.forEach(f => {
        let promise = chrome.tabs.sendMessage(tabId, {time: ms}, {frameId:f.frameId})
        promises.push(promise)
    })
    return promises
}
