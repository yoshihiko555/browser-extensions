// ui-context - background service worker
import { computeCropRect } from "./crop.js";

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
  let screenshotKind = null;
  try {
    if (tab && tab.windowId !== undefined) {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
    } else {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab({ format: "png" });
    }
    screenshotKind = "viewport";
  } catch (e) {
    screenshotError = String(e);
  }

  // 選択要素だけに切り抜く。失敗したらビューポート全体のまま送る。
  if (screenshotDataUrl) {
    try {
      const cropped = await cropToElement(
        screenshotDataUrl,
        payload.boundingRect,
        payload.devicePixelRatio || 1
      );
      if (cropped) {
        screenshotDataUrl = cropped;
        screenshotKind = "element";
      }
    } catch (e) {
      screenshotError = `crop failed: ${e}`;
    }
  }

  const body = {
    ...payload,
    screenshotDataUrl,
    screenshotError,
    screenshotKind,
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

// captureVisibleTab のビューポート画像から、要素の矩形だけを切り出す。
async function cropToElement(dataUrl, rect, dpr) {
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));

  const crop = computeCropRect(rect, dpr, {
    width: bitmap.width,
    height: bitmap.height,
  });
  if (!crop) {
    bitmap.close();
    return null;
  }
  const { sx, sy, sw, sh } = crop;

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return `data:image/png;base64,${await blobToBase64(blob)}`;
}

function dataUrlToBlob(dataUrl) {
  const base64 = dataUrl.split(",", 2)[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000; // 引数が多すぎると String.fromCharCode が落ちる
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
