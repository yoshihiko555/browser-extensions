// Dia Element Capture PoC - background service worker
const SERVER_URL = "http://127.0.0.1:8765/capture";

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-capture" && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "dia-poc-toggle" }).catch((e) => {
      console.warn("toggle-capture: could not message tab", e);
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "dia-poc-capture") {
    handleCapture(msg.payload, sender.tab)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for async sendResponse
  }
});

async function handleCapture(payload, tab) {
  let screenshotDataUrl = null;
  let screenshotError = null;
  try {
    if (tab && tab.windowId !== undefined) {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
    } else {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    }
  } catch (e) {
    screenshotError = String(e);
  }

  const body = {
    ...payload,
    screenshotDataUrl,
    screenshotError,
    capturedAt: new Date().toISOString(),
  };

  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`server responded ${res.status}`);
  }
  return await res.json();
}
