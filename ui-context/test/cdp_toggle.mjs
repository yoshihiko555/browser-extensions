// ショートカット経路（background → content の toggle メッセージ）が通るかを CDP で確認する。
// 使い方: node test/cdp_toggle.mjs [port]
const PORT = process.argv[2] || 9224;
const BASE = `http://127.0.0.1:${PORT}`;

function rpc(ws, id, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        resolve(data);
      }
    };
    ws.addEventListener('message', handler);
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ver = await (await fetch(`${BASE}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 1;

  const logs = [];
  ws.addEventListener('message', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      const args = (d.params.args || []).map((a) => a.value ?? a.description).join(' ');
      logs.push(`[${d.params.type}] ${args}`);
    }
    if (d.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${d.params.exceptionDetails.exception?.description || JSON.stringify(d.params.exceptionDetails)}`);
    }
  });

  // 1. ui-context の service worker を探す
  const targets = (await rpc(ws, id++, 'Target.getTargets')).result.targetInfos;
  const workers = targets.filter((t) => t.type === 'service_worker');
  let swSession = null;
  for (const w of workers) {
    const s = (await rpc(ws, id++, 'Target.attachToTarget', { targetId: w.targetId, flatten: true })).result.sessionId;
    await rpc(ws, id++, 'Runtime.enable', {}, s);
    const name = (await rpc(ws, id++, 'Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest().name', returnByValue: true,
    }, s)).result?.result?.value;
    if (name === 'ui-context') { swSession = s; break; }
  }
  console.log('service worker (ui-context):', swSession ? 'FOUND' : 'NOT FOUND');
  if (!swSession) process.exit(1);

  // 2. テストページを開く
  const targetId = (await rpc(ws, id++, 'Target.createTarget', { url: 'http://127.0.0.1:8766/testpage.html' })).result.targetId;
  const pageSession = (await rpc(ws, id++, 'Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await rpc(ws, id++, 'Runtime.enable', {}, pageSession);
  await rpc(ws, id++, 'Page.enable', {}, pageSession);
  await rpc(ws, id++, 'Page.reload', {}, pageSession);
  await sleep(2500);
  await rpc(ws, id++, 'Target.activateTarget', { targetId });
  await sleep(500);

  // 3. commands のハンドラが登録されているか
  const cmds = (await rpc(ws, id++, 'Runtime.evaluate', {
    expression: 'chrome.commands.getAll().then(c => JSON.stringify(c))',
    awaitPromise: true, returnByValue: true,
  }, swSession)).result?.result?.value;
  console.log('registered commands:', cmds);

  // 4. onCommand と同じ経路（tabs.sendMessage で toggle）を叩く
  const toggle = (await rpc(ws, id++, 'Runtime.evaluate', {
    expression: `(async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!t) return 'no active tab';
      try {
        await chrome.tabs.sendMessage(t.id, { type: 'dia-poc-toggle' });
        return 'sent to ' + t.url;
      } catch (e) { return 'ERROR ' + e.message + ' (tab: ' + t.url + ')'; }
    })()`,
    awaitPromise: true, returnByValue: true,
  }, swSession)).result?.result?.value;
  console.log('toggle via tabs.sendMessage:', toggle);

  await sleep(500);

  // 5. キャプチャモードに入ったか（カーソルが crosshair になる）
  const cursor = (await rpc(ws, id++, 'Runtime.evaluate', {
    expression: 'document.body.style.cursor', returnByValue: true,
  }, pageSession)).result?.result?.value;
  console.log('body cursor after toggle:', JSON.stringify(cursor), cursor === 'crosshair' ? 'OK' : 'NG');

  console.log('=== console ===');
  for (const l of logs) console.log(l);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
