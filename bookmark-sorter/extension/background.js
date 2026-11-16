import { aggregateHostCounts, planSort, moveSteps, fitOrder, snapshotOf, mergeOriginal } from './sort.js';

// endTime でのページ送りは再訪問した URL で途中終了するため、1 回で全件取る
const HISTORY_LIMIT = 1_000_000;
let running = false;

async function findBar() {
  const [root] = await chrome.bookmarks.getTree();
  const byType = root.children.find((n) => n.folderType === 'bookmarks-bar');
  return byType ? { bar: byType, pickedBy: 'folderType' } : { bar: root.children[0], pickedBy: 'position' };
}

async function buildPlan() {
  const { bar, pickedBy } = await findBar();
  const history = await chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_LIMIT });
  const counts = aggregateHostCounts(history);
  const changes = planSort(bar, counts);
  return {
    bar: { id: bar.id, title: bar.title, pickedBy },
    historyUrls: history.length,
    historyTruncated: history.length >= HISTORY_LIMIT,
    hosts: counts.size,
    changes,
  };
}

const childIds = async (folderId) => (await chrome.bookmarks.getChildren(folderId)).map((c) => c.id);

/** targets（{ folderId, path, ids }）の並びにする。適用後に読み直して食い違ったフォルダを返す。 */
async function applyOrder(targets) {
  const mismatches = [];
  let moves = 0;
  for (const t of targets) {
    let current;
    try {
      current = await childIds(t.folderId);
    } catch {
      continue;
    }
    const goal = fitOrder(current, t.ids);
    for (const step of moveSteps(current, goal)) {
      await chrome.bookmarks.move(step.id, { parentId: t.folderId, index: step.index });
      moves++;
    }
    if ((await childIds(t.folderId)).join() !== goal.join()) mismatches.push(t.path);
  }
  return { moves, mismatches };
}

function summarize(plan) {
  return {
    bar: plan.bar,
    historyUrls: plan.historyUrls,
    historyTruncated: plan.historyTruncated,
    hosts: plan.hosts,
    folders: plan.changes.map((c) => ({ path: c.path, moved: c.moved })),
    moved: plan.changes.reduce((n, c) => n + c.moved, 0),
  };
}

async function snapshots() {
  const { last, original } = await chrome.storage.local.get(['last', 'original']);
  const info = (s) => (s ? { takenAt: s.takenAt, folders: Object.keys(s.folders).length } : null);
  return { last: info(last), original: info(original) };
}

async function preview() {
  return summarize(await buildPlan());
}

async function sort() {
  const plan = await buildPlan();
  if (plan.changes.length === 0) return { ...summarize(plan), moves: 0, mismatches: [] };
  const snap = snapshotOf(plan.changes, Date.now());
  const { original } = await chrome.storage.local.get('original');
  await chrome.storage.local.set({ last: snap, original: mergeOriginal(original, snap) });
  const result = await applyOrder(plan.changes.map((c) => ({ folderId: c.folderId, path: c.path, ids: c.after })));
  return { ...summarize(plan), ...result };
}

async function restore(key) {
  const snap = (await chrome.storage.local.get(key))[key];
  if (!snap) return { moves: 0, mismatches: [] };
  const targets = Object.entries(snap.folders).map(([folderId, { path, ids }]) => ({ folderId, path, ids }));
  const result = await applyOrder(targets);
  await chrome.storage.local.remove('last');
  return result;
}

const HANDLERS = {
  status: async () => ({ running, ...(await snapshots()) }),
  preview,
  sort,
  undoLast: () => restore('last'),
  undoOriginal: () => restore('original'),
};
const MUTATING = new Set(['sort', 'undoLast', 'undoOriginal']);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return false;
  if (MUTATING.has(msg.type)) {
    if (running) {
      sendResponse({ ok: false, error: '別の処理を実行中です' });
      return false;
    }
    running = true;
  }
  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
    .finally(() => {
      if (MUTATING.has(msg.type)) running = false;
    });
  return true;
});
