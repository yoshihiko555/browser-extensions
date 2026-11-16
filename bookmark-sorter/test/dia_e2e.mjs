// 検証用プロファイルの Dia で拡張を通しで動かす。node test/dia_e2e.mjs [port]
// 前提: open -na Dia --args --user-data-dir=<別ディレクトリ> --remote-debugging-port=9226 --load-extension=<extension の絶対パス>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PORT = process.argv[2] || 9226;
const BASE = `http://127.0.0.1:${PORT}`;
let seq = 1;

function rpc(ws, method, params = {}, sessionId) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20000);
    const onMessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.id !== id) return;
      ws.removeEventListener('message', onMessage);
      clearTimeout(timer);
      data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
}

async function evaluate(ws, sessionId, expression) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const ver = await (await fetch(`${BASE}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
console.log('browser:', ver.Browser);

// unpacked 拡張の ID は読み込んだディレクトリの絶対パスから決まる（service worker は止まっていることがある）
const extDir = fileURLToPath(new URL('../extension', import.meta.url));
const extId = [...createHash('sha256').update(extDir).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');

const { targetId } = await rpc(ws, 'Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const { sessionId: page } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
await new Promise((r) => setTimeout(r, 1500));
const ev = (expr) => evaluate(ws, page, expr);
const send = async (type) => {
  const res = await ev(`chrome.runtime.sendMessage({ type: ${JSON.stringify(type)} })`);
  assert.ok(res.ok, `${type}: ${res.error}`);
  return res.result;
};

console.log('chrome.history:', await ev('typeof chrome.history?.search'));

// 履歴の全削除などをするので、普段のプロファイルらしければ中止する
const historySize = await ev(`chrome.history.search({ text: '', startTime: 0, maxResults: 2000 }).then((r) => r.length)`);
assert.ok(historySize < 1000, `履歴が ${historySize} 件あるため中止します（検証用プロファイルで実行しているか確認）`);

// 合成データを投入
const folderId = await ev(`(async () => {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children.find((n) => n.folderType === 'bookmarks-bar') ?? root.children[0];
  for (const old of (await chrome.bookmarks.getChildren(bar.id)).filter((n) => n.title === 'E2E')) {
    await chrome.bookmarks.removeTree(old.id);
  }
  const f = await chrome.bookmarks.create({ parentId: bar.id, title: 'E2E' });
  const add = (title, url) => chrome.bookmarks.create({ parentId: f.id, title, url });
  await add('cold', 'https://cold.example/');
  await add('hot', 'https://www.hot.example/a');
  const sub = await chrome.bookmarks.create({ parentId: f.id, title: 'Sub' });
  await chrome.bookmarks.create({ parentId: sub.id, title: 's-cold', url: 'https://cold.example/s' });
  await chrome.bookmarks.create({ parentId: sub.id, title: 's-hot', url: 'https://hot.example/s' });
  await add('warm', 'https://warm.example/');
  await add('bookmarklet', 'javascript:void(0)');
  for (let i = 0; i < 3; i++) await chrome.history.addUrl({ url: 'https://hot.example/visit' });
  await chrome.history.addUrl({ url: 'https://warm.example/visit' });
  return f.id;
})()`);
const order = (id = folderId) => ev(`chrome.bookmarks.getChildren(${JSON.stringify(id)}).then((c) => c.map((n) => n.title))`);
const initial = await order();
console.log('initial:', initial);

const plan = await send('preview');
console.log('preview:', { bar: plan.bar, historyUrls: plan.historyUrls, hosts: plan.hosts, folders: plan.folders });
assert.ok(plan.historyUrls >= 2, '履歴が集計されていない');

const sorted = await send('sort');
assert.deepEqual(sorted.mismatches, []);
assert.deepEqual(await order(), ['Sub', 'hot', 'warm', 'cold', 'bookmarklet']);
const subId = await ev(`chrome.bookmarks.getChildren(${JSON.stringify(folderId)}).then((c) => c.find((n) => n.title === 'Sub').id)`);
assert.deepEqual(await order(subId), ['s-hot', 's-cold']);
console.log('sort: ok', { moves: sorted.moves });

const lastBefore = (await send('status')).last;
const again = await send('sort');
assert.equal(again.moves, 0);
assert.deepEqual((await send('status')).last, lastBefore, '並び済みの再実行で直前のスナップショットが上書きされた');
console.log('re-sort no-op: ok');

await send('undoLast');
assert.deepEqual(await order(), initial);
assert.equal((await send('status')).last, null);
console.log('undoLast: ok');

await send('sort');
for (let i = 0; i < 6; i++) await ev(`chrome.history.addUrl({ url: 'https://cold.example/visit' })`);
await send('sort');
assert.deepEqual(await order(), ['Sub', 'cold', 'hot', 'warm', 'bookmarklet']);
await send('undoOriginal');
assert.deepEqual(await order(), initial);
assert.deepEqual(await order(subId), ['s-cold', 's-hot']);
console.log('undoOriginal: ok');

// 再訪問のある履歴でも全 URL を数える
await ev(`(async () => {
  await chrome.history.deleteAll();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visit = async (p, n) => {
    for (let i = 0; i < n; i++) {
      await chrome.history.addUrl({ url: 'https://' + p + i + '.example/' });
      await sleep(2);
    }
  };
  await visit('a', 5);
  await visit('b', 12);
  await visit('c', 25);
  await visit('b', 12);
})()`);
assert.equal((await send('preview')).historyUrls, 42);
console.log('history with revisits: ok');

// 150 件のフォルダをポップアップのボタン操作で並び替え・戻す
const bulkId = await ev(`(async () => {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children.find((n) => n.folderType === 'bookmarks-bar') ?? root.children[0];
  for (const old of (await chrome.bookmarks.getChildren(bar.id)).filter((n) => n.title === 'Bulk')) {
    await chrome.bookmarks.removeTree(old.id);
  }
  const f = await chrome.bookmarks.create({ parentId: bar.id, title: 'Bulk' });
  for (let i = 0; i < 150; i++) {
    await chrome.bookmarks.create({ parentId: f.id, title: 'b' + i, url: 'https://bulk' + i + '.example/' });
  }
  for (let i = 50; i < 150; i++) await chrome.history.addUrl({ url: 'https://bulk' + i + '.example/x' });
  for (let i = 100; i < 150; i++) await chrome.history.addUrl({ url: 'https://bulk' + i + '.example/y' });
  return f.id;
})()`);
const range = (from, to) => Array.from({ length: to - from }, (_, k) => 'b' + (from + k));

async function waitFor(expr, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ev(expr).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`waitFor timeout: ${expr}`);
}

async function click(buttonId) {
  await ev('location.reload()').catch(() => {});
  await waitFor(`document.readyState === 'complete' && !document.getElementById(${JSON.stringify(buttonId)}).disabled`);
  await ev(`document.getElementById(${JSON.stringify(buttonId)}).click()`);
  await waitFor(`document.getElementById('status').textContent.includes('完了')`);
  const [text, className] = await ev(`(() => { const s = document.getElementById('status'); return [s.textContent, s.className]; })()`);
  assert.notEqual(className, 'error', text);
  return text;
}

console.log('click sort:', await click('sort'));
assert.deepEqual(await order(bulkId), [...range(100, 150), ...range(50, 100), ...range(0, 50)]);
console.log('click undoLast:', await click('undoLast'));
assert.deepEqual(await order(bulkId), range(0, 150));
console.log('bulk via buttons: ok');

await ev('location.reload()').catch(() => {});
await waitFor(`document.readyState === 'complete' && document.getElementById('summary').textContent !== ''`);
console.log('popup:', await ev(`[source.textContent, summary.textContent, sort.disabled].join(' | ')`));

await rpc(ws, 'Target.closeTarget', { targetId });
ws.close();
console.log('ALL OK');
