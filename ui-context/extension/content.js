// Dia Element Capture PoC - content script
(function () {
  if (window.__diaPocInstalled) return;
  window.__diaPocInstalled = true;

  let captureMode = false;
  let hoverEl = null;
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "z-index:2147483647",
    "background:rgba(255,80,0,0.25)",
    "outline:2px solid rgba(255,80,0,0.9)",
    "display:none",
  ].join(";");

  function ensureOverlay() {
    if (!overlay.isConnected && document.body) {
      document.body.appendChild(overlay);
    }
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    const path = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 8) {
      let selector = node.nodeName.toLowerCase();
      if (node.id) {
        selector += `#${node.id}`;
        path.unshift(selector);
        break;
      } else {
        let sibling = node;
        let nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.nodeName.toLowerCase() === selector) nth++;
        }
        selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      node = node.parentElement;
    }
    return path.join(" > ");
  }

  function computedStyleSubset(el) {
    const cs = window.getComputedStyle(el);
    const keys = [
      "display",
      "position",
      "color",
      "backgroundColor",
      "fontSize",
      "fontFamily",
      "width",
      "height",
      "margin",
      "padding",
      "border",
    ];
    const out = {};
    for (const k of keys) out[k] = cs.getPropertyValue(k) || cs[k];
    return out;
  }

  function buildPayload(el, comment) {
    const rect = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      outerHTML: (el.outerHTML || "").slice(0, 2048),
      computedStyle: computedStyleSubset(el),
      boundingRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      },
      devicePixelRatio: window.devicePixelRatio,
      url: location.href,
      title: document.title,
      comment: comment || "",
    };
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // 切り抜きは captureVisibleTab のビューポート画像が元なので、
  // 要素が画面外・見切れている場合はスクロールして収めてから撮る。
  async function ensureVisible(el) {
    const r = el.getBoundingClientRect();
    const fits =
      r.top >= 0 &&
      r.left >= 0 &&
      r.bottom <= window.innerHeight &&
      r.right <= window.innerWidth;
    if (fits) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    // スクロール後の再描画を待つ
    await nextFrame();
    await nextFrame();
  }

  async function sendCapture(el, comment) {
    await ensureVisible(el);
    const payload = buildPayload(el, comment);
    console.log("dia-poc: sending capture", payload.selector);
    chrome.runtime.sendMessage(
      { type: "dia-poc-capture", payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("dia-poc: sendMessage failed", chrome.runtime.lastError);
          window.__diaPocLastResult = { ok: false, error: String(chrome.runtime.lastError.message) };
          return;
        }
        window.__diaPocLastResult = response;
        console.log("dia-poc capture result", response);
      }
    );
  }

  function onMouseOver(e) {
    if (!captureMode) return;
    hoverEl = e.target;
    ensureOverlay();
    const r = hoverEl.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  function onClick(e) {
    if (!captureMode) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    // ハイライトがスクリーンショットに写らないよう、先に解除する
    setCaptureMode(false);
    let comment = "";
    try {
      comment = window.prompt("キャプチャに付けるコメント (任意):") || "";
    } catch (err) {
      comment = "";
    }
    sendCapture(el, comment);
  }

  function setCaptureMode(on) {
    captureMode = on;
    overlay.style.display = on ? overlay.style.display : "none";
    if (!on) hoverEl = null;
    document.body && (document.body.style.cursor = on ? "crosshair" : "");
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onClick, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "dia-poc-toggle") {
      setCaptureMode(!captureMode);
    }
  });

  // Programmatic trigger for automated verification (CDP / test harness),
  // bypasses prompt() so it can run without a real user gesture.
  window.addEventListener("dia-poc-trigger", (e) => {
    console.log("dia-poc: trigger event received", e && e.detail);
    try {
      const detail = e && e.detail;
      const el = (detail && detail.selector)
        ? document.querySelector(detail.selector)
        : document.body;
      console.log("dia-poc: resolved element", el);
      if (el) sendCapture(el, (detail && detail.comment) || "(auto-trigger)");
      else console.warn("dia-poc: no element resolved for trigger");
    } catch (err) {
      console.error("dia-poc: trigger handler error", err);
    }
  });

  window.__diaPocReady = true;
  console.log("dia-poc: content script injected on", location.href);
})();
