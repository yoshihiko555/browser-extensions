const PORT = process.argv[2] || 9224;
const BASE = `http://127.0.0.1:${PORT}`;

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
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10000);
  });
}

async function main() {
  const verRes = await fetch(`${BASE}/json/version`);
  const ver = await verRes.json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve) => browserWs.addEventListener('open', resolve));
  let id = 1;

  const contexts = [];
  const consoleMsgs = [];
  browserWs.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data);
    if (data.method === 'Runtime.executionContextCreated') {
      contexts.push(data.params.context);
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = (data.params.args || []).map(a => a.value ?? a.description).join(' ');
      consoleMsgs.push(`[${data.params.type}] ${args}`);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      consoleMsgs.push(`[exception] ${JSON.stringify(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails)}`);
    }
  });

  const testUrl = 'http://127.0.0.1:8766/testpage.html';
  const createRes = await wsRPC(browserWs, id++, 'Target.createTarget', { url: testUrl });
  const targetId = createRes.result.targetId;
  const attach = await wsRPC(browserWs, id++, 'Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attach.result.sessionId;

  await wsRPC(browserWs, id++, 'Runtime.enable', {}, sessionId);
  await wsRPC(browserWs, id++, 'Page.enable', {}, sessionId);

  // reload to make sure we catch executionContextCreated events for all worlds after Runtime.enable
  await wsRPC(browserWs, id++, 'Page.reload', {}, sessionId);
  await new Promise((r) => setTimeout(r, 2500));

  console.log('=== execution contexts ===');
  for (const c of contexts) {
    console.log(c.id, c.auxData, c.name, c.origin);
  }

  const isolated = contexts.filter(c => c.auxData && c.auxData.type === 'isolated').pop();
  console.log('isolated world found:', isolated ? isolated.id : 'NONE');

  if (isolated) {
    const readyRes = await wsRPC(browserWs, id++, 'Runtime.evaluate', {
      expression: 'JSON.stringify({installed: window.__diaPocInstalled, ready: window.__diaPocReady})',
      contextId: isolated.id,
      returnByValue: true,
    }, sessionId);
    console.log('isolated-world state:', readyRes.result?.result?.value, readyRes.result?.exceptionDetails);
  }

  await wsRPC(browserWs, id++, 'Target.activateTarget', { targetId });
  await new Promise((r) => setTimeout(r, 300));

  // trigger from MAIN world (dispatchEvent crosses worlds via shared DOM)
  const triggerRes = await wsRPC(browserWs, id++, 'Runtime.evaluate', {
    expression: `window.dispatchEvent(new CustomEvent('dia-poc-trigger', { detail: { selector: '#target-btn', comment: 'CDP automated test' } })); 'dispatched'`,
    returnByValue: true,
  }, sessionId);
  console.log('trigger dispatch (main world):', triggerRes.result?.result?.value, triggerRes.result?.exceptionDetails);

  await new Promise((r) => setTimeout(r, 3000));

  if (isolated) {
    const resultRes = await wsRPC(browserWs, id++, 'Runtime.evaluate', {
      expression: 'JSON.stringify(window.__diaPocLastResult || null)',
      contextId: isolated.id,
      returnByValue: true,
    }, sessionId);
    console.log('capture result (isolated world):', resultRes.result?.result?.value, resultRes.result?.exceptionDetails);
  }

  console.log('=== console messages ===');
  for (const m of consoleMsgs) console.log(m);

  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
