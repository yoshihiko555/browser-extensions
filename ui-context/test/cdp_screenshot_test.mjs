const PORT = process.argv[2] || 9224;
const BASE = `http://127.0.0.1:${PORT}`;
function wsRPC(ws, id, method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id === id) { ws.removeEventListener('message', handler); resolve(data); }
    };
    ws.addEventListener('message', handler);
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    setTimeout(() => reject(new Error(`timeout ${method}`)), 10000);
  });
}
async function main() {
  const ver = await (await fetch(`${BASE}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 1;
  const list = await (await fetch(`${BASE}/json`)).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('testpage'));
  if (!page) { console.log('no test page target found', list.map(t=>t.url)); process.exit(1); }
  const attach = await wsRPC(ws, id++, 'Target.attachToTarget', { targetId: page.id, flatten: true });
  const sessionId = attach.result.sessionId;
  await wsRPC(ws, id++, 'Target.activateTarget', { targetId: page.id });
  await new Promise(r => setTimeout(r, 500));
  const shot = await wsRPC(ws, id++, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  const dataLen = shot.result?.data ? shot.result.data.length : 0;
  console.log('Page.captureScreenshot base64 length:', dataLen, shot.result?.data ? '' : JSON.stringify(shot));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
