const PORT = process.argv[2] || 9224;
const BASE = `http://127.0.0.1:${PORT}`;

async function jsonList() {
  const res = await fetch(`${BASE}/json`);
  return res.json();
}

function wsSend(ws, id, method, params, sessionId) {
  const msg = { id, method, params: params || {} };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
}

function wsRPC(ws, id, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        resolve(data);
      }
    };
    ws.addEventListener('message', handler);
    wsSend(ws, id, method, params, sessionId);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 8000);
  });
}

async function main() {
  const targets = await jsonList();
  console.log('=== targets ===');
  for (const t of targets) {
    console.log(t.type, t.url, '|', t.title);
  }

  // connect to browser-level websocket via first target's browser ws (need browser ws url)
  const verRes = await fetch(`${BASE}/json/version`);
  const ver = await verRes.json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve) => browserWs.addEventListener('open', resolve));

  let id = 1;

  // Evaluate manifest name in each service_worker target
  for (const t of targets.filter(t => t.type === 'service_worker')) {
    try {
      const attach = await wsRPC(browserWs, id++, 'Target.attachToTarget', { targetId: t.id, flatten: true });
      const sessionId = attach.result.sessionId;
      const evalRes = await wsRPC(browserWs, id++, 'Runtime.evaluate', {
        expression: 'JSON.stringify(chrome.runtime.getManifest())',
        returnByValue: true,
      }, sessionId);
      console.log('SW', t.url, '=>', evalRes.result?.result?.value || JSON.stringify(evalRes));
    } catch (e) {
      console.log('SW', t.url, 'ERROR', String(e));
    }
  }

  // Check chrome://version for command line flags
  const createRes = await wsRPC(browserWs, id++, 'Target.createTarget', { url: 'chrome://version' });
  const versionTargetId = createRes.result.targetId;
  const attachVer = await wsRPC(browserWs, id++, 'Target.attachToTarget', { targetId: versionTargetId, flatten: true });
  const verSession = attachVer.result.sessionId;
  await new Promise(r => setTimeout(r, 1500));
  const cmdLineRes = await wsRPC(browserWs, id++, 'Runtime.evaluate', {
    expression: `(() => { const el = document.getElementById('command_line'); return el ? el.innerText : 'NOT FOUND'; })()`,
    returnByValue: true,
  }, verSession);
  console.log('=== chrome://version command_line ===');
  console.log(cmdLineRes.result?.result?.value);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
