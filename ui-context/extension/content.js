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
    askComment().then((comment) => {
      if (comment === null) return; // キャンセル
      sendCapture(el, comment);
    });
  }

  // コメント入力のオーバーレイ。ページの CSS に影響されないよう shadow DOM に置く。
  // 送信は Cmd/Ctrl+Enter、キャンセルは Esc。キャンセルするとキャプチャは送らない。
  // 解決値は入力文字列（空文字も可）、キャンセルなら null。
  function askComment() {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "all:initial;position:fixed;z-index:2147483647";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .backdrop {
            position: fixed; inset: 0; z-index: 1;
            background: rgba(0,0,0,0.35);
            display: flex; align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .panel {
            background: #1e1e1e; color: #eee;
            border: 1px solid #444; border-radius: 10px;
            padding: 16px; width: min(520px, 90vw);
            box-shadow: 0 12px 32px rgba(0,0,0,0.45);
          }
          .title { font-size: 13px; color: #aaa; margin-bottom: 8px; }
          textarea {
            width: 100%; box-sizing: border-box; min-height: 96px;
            background: #111; color: #eee; border: 1px solid #555;
            border-radius: 6px; padding: 8px; font: inherit; font-size: 14px;
            resize: vertical;
          }
          textarea:focus { outline: 2px solid #ff7a33; border-color: transparent; }
          .row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
          .hint { font-size: 11px; color: #888; margin-right: auto; }
          button {
            font: inherit; font-size: 13px; padding: 6px 14px;
            border-radius: 6px; border: 1px solid #555;
            background: #2a2a2a; color: #eee; cursor: pointer;
          }
          button.primary { background: #ff7a33; border-color: #ff7a33; color: #201000; font-weight: 600; }
        </style>
        <div class="backdrop">
          <div class="panel">
            <div class="title">この要素に付けるコメント（任意）</div>
            <textarea placeholder="例: 余白が広すぎる。上下 8px に詰めたい"></textarea>
            <div class="row">
              <span class="hint">送信: ⌘/Ctrl+Enter　キャンセル: Esc</span>
              <button class="cancel">キャンセル</button>
              <button class="primary">送信</button>
            </div>
          </div>
        </div>
      `;
      document.documentElement.appendChild(host);

      const textarea = root.querySelector("textarea");
      textarea.focus();

      let settled = false;
      function close(value) {
        if (settled) return;
        settled = true;
        host.remove();
        // パネルがスクリーンショットに写らないよう、消えたのを見届けてから返す
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
      }

      root.querySelector(".primary").addEventListener("click", () => close(textarea.value));
      root.querySelector(".cancel").addEventListener("click", () => close(null));
      root.querySelector(".backdrop").addEventListener("mousedown", (ev) => {
        if (ev.target === ev.currentTarget) close(null); // 背景クリックでキャンセル
      });
      host.addEventListener("keydown", (ev) => {
        ev.stopPropagation(); // ページ側のショートカットに拾わせない
        if (ev.key === "Escape") close(null);
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) close(textarea.value);
      });
    });
  }

  function setCaptureMode(on) {
    captureMode = on;
    overlay.style.display = on ? overlay.style.display : "none";
    if (!on) hoverEl = null;
    document.body && (document.body.style.cursor = on ? "crosshair" : "");
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("click", onClick, true);
  // 要素を選ぶ前に Esc でキャプチャモードを抜ける
  document.addEventListener(
    "keydown",
    (e) => {
      if (captureMode && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCaptureMode(false);
      }
    },
    true
  );

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
