// 検証用プロファイルの Dia で「構成を反映」を通しで動かす。node test/dia_structure_e2e.mjs [port]
// 前提は dia_e2e.mjs と同じ（別 user-data-dir・--remote-debugging-port・--load-extension で起動した Dia）
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FORMAT, planStructure, shape, flattenTree } from '../extension/restructure.js';

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

// unpacked 拡張の ID は読み込んだディレクトリの絶対パスから決まる（service worker は止まっていることがある）
const extDir = fileURLToPath(new URL('../extension', import.meta.url));
const extId = [...createHash('sha256').update(extDir).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');

const { targetId } = await rpc(ws, 'Target.createTarget', { url: `chrome-extension://${extId}/structure.html` });
const { sessionId: page } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
const ev = (expr) => evaluate(ws, page, expr);

async function waitFor(expr, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ev(expr).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`waitFor timeout: ${expr}`);
}
await waitFor(`document.readyState === 'complete'`);

// 履歴の全削除などをするので、普段のプロファイルらしければ中止する
const historySize = await ev(`chrome.history.search({ text: '', startTime: 0, maxResults: 2000 }).then((r) => r.length)`);
assert.ok(historySize < 1000, `履歴が ${historySize} 件あるため中止します（検証用プロファイルで実行しているか確認）`);

const send = async (type, extra = {}) => {
  const res = await ev(`chrome.runtime.sendMessage(${JSON.stringify({ type, ...extra })})`);
  assert.ok(res.ok, `${type}: ${res.error}`);
  return res.result;
};
const barTree = () =>
  ev(`chrome.bookmarks.getTree().then(([root]) => root.children.find((n) => n.folderType === 'bookmarks-bar') ?? root.children[0])`);
const storage = () => ev(`chrome.storage.local.get(null)`);

// 合成データ（ブックマークバーを空にしてから作る）
const ids = await ev(`(async () => {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children.find((n) => n.folderType === 'bookmarks-bar') ?? root.children[0];
  for (const c of await chrome.bookmarks.getChildren(bar.id)) await chrome.bookmarks.removeTree(c.id);
  await chrome.storage.local.clear();
  await chrome.history.deleteAll();
  const mk = (parentId, title, url) => chrome.bookmarks.create({ parentId, title, ...(url && { url }) });
  const out = {};
  out.home = (await mk(bar.id, 'home', 'https://home.example/')).id;
  const me = await mk(bar.id, 'Me');
  out.m1 = (await mk(me.id, 'm1', 'https://m1.example/')).id;
  out.m2 = (await mk(me.id, 'm2', 'https://m2.example/')).id;
  const dev = await mk(bar.id, 'Dev');
  for (const k of ['d1', 'd2', 'd3']) out[k] = (await mk(dev.id, k, 'https://' + k + '.example/')).id;
  const idea = await mk(bar.id, 'Idea');
  out.idea = idea.id;
  out.i1 = (await mk(idea.id, 'i1', 'https://i1.example/')).id;
  out.i2 = (await mk(idea.id, 'i2', 'https://i2.example/')).id;
  const llm = await mk(bar.id, 'LLM');
  const lb = await mk(llm.id, 'Leaderborad');
  out.lb = lb.id;
  await mk(lb.id, 'l1', 'https://l1.example/');
  const news = await mk(bar.id, 'News');
  await mk(news.id, 'n1', 'https://n1.example/');
  for (let i = 0; i < 3; i++) await chrome.history.addUrl({ url: 'https://d3.example/x' });
  return out;
})()`);

// 並び替えの記録を作っておく（構成の反映中は退避され、元に戻すと復元されるはず）
await send('sort');
const sortKeys = await storage();
assert.ok(sortKeys.last && sortKeys.original);

const plan = {
  format: FORMAT,
  createFolders: ['Daily', 'Dev/Console', 'Design', 'Design/Interior'],
  folders: [
    { id: ids.idea, title: 'Idea', to: 'Design', rename: 'Inspiration' },
    { id: ids.lb, title: 'Leaderborad', rename: 'Leaderboard' },
  ],
  moves: [
    { id: ids.d3, url: 'https://d3.example/', to: 'Dev/Console' },
    { id: ids.m2, url: 'https://m2.example/', to: 'Daily' },
    { id: ids.d1, url: 'https://d1.example/', to: 'Dev/Console' },
    { id: ids.i2, url: 'https://i2.example/', to: 'Design/Interior' },
  ],
  folderOrder: { '': ['Me', 'Daily', 'Dev', 'LLM', 'Design', 'News'], Design: ['Inspiration', 'Interior'] },
};

const before = await barTree();
const expected = planStructure(before, plan);
assert.deepEqual(expected.errors, []);

// 食い違いがあると 1 件も書き込まない
const bad = structuredClone(plan);
bad.moves[0].url = 'https://changed.example/';
const badResult = await send('structureApply', { plan: bad });
assert.equal(badResult.applied, false);
assert.equal(badResult.errors.length, 1);
assert.deepEqual(shape(await barTree()), shape(before));
assert.equal((await storage()).structureBackup, undefined);
console.log('mismatch -> no writes: ok');

// ページでファイルを選んで反映する
async function selectFile(obj) {
  await ev(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(JSON.stringify(obj))}], 'structure.json', { type: 'application/json' }));
    const input = document.getElementById('file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  })()`);
}
await selectFile(plan);
await waitFor(`!document.getElementById('apply').disabled`);
await ev(`document.getElementById('apply').click()`);
await waitFor(`document.getElementById('status').textContent.startsWith('反映')
  && !document.getElementById('status').textContent.endsWith('中…')`);
const applyStatus = await ev(`document.getElementById('status').textContent`);
assert.equal(applyStatus, '反映完了');
assert.deepEqual(shape(await barTree()), shape(expected.tree));
const afterApply = await storage();
assert.ok(afterApply.structureBackup);
assert.equal(afterApply.last, undefined);
assert.equal(afterApply.original, undefined);
assert.ok((await send('status')).structure);
console.log('apply via page: ok');

// 再実行は何もしない
const again = await send('structurePreview', { plan });
assert.equal(again.operations, 0);
assert.equal((await send('structureApply', { plan })).applied, false);
assert.equal(await ev(`document.getElementById('apply').disabled`), true);
console.log('re-run no-op: ok');

// 反映後に並び替えると「直前に戻す」が使え、ポップアップから構成のページも開ける
await send('sort');
assert.ok((await send('status')).last);
const { targetId: popupId } = await rpc(ws, 'Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
const { sessionId: popup } = await rpc(ws, 'Target.attachToTarget', { targetId: popupId, flatten: true });
const pev = (expr) => evaluate(ws, popup, expr);
const pWait = async (expr) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await pev(expr).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout: ${expr}`);
};
await pWait(`document.getElementById('summary').textContent !== ''`);
assert.equal(await pev(`document.getElementById('undoLast').disabled`), false);
const pagesBefore = (await rpc(ws, 'Target.getTargets')).targetInfos.filter((t) => t.url.endsWith('/structure.html')).length;
await pev(`document.getElementById('openStructure').click()`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const structurePages = (await rpc(ws, 'Target.getTargets')).targetInfos.filter((t) => t.url.endsWith('/structure.html'));
assert.equal(structurePages.length, pagesBefore + 1);
for (const t of structurePages) if (t.targetId !== targetId) await rpc(ws, 'Target.closeTarget', { targetId: t.targetId });
await rpc(ws, 'Target.closeTarget', { targetId: popupId }).catch(() => {});
console.log('sort undo after apply + open from popup: ok');

// 構成を元に戻すと、反映前の構成と、退避した並び替えの記録に戻る
await ev(`document.getElementById('undo').click()`);
await waitFor(`document.getElementById('status').textContent.startsWith('元に戻す処理完了')`);
console.log('undo status:', await ev(`document.getElementById('status').textContent`));
assert.deepEqual(flattenTree(await barTree()), flattenTree(before));
const afterUndo = await storage();
assert.equal(afterUndo.structureBackup, undefined);
assert.deepEqual(afterUndo.last, sortKeys.last);
assert.deepEqual(afterUndo.original, sortKeys.original);
console.log('undo via page: ok');

await rpc(ws, 'Target.closeTarget', { targetId });
ws.close();
console.log('ALL OK');
