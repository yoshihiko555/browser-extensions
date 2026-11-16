import { aggregateHostCounts, planSort, moveSteps, fitOrder, snapshotOf, mergeOriginal } from './sort.js';
import { planStructure, shape, folderOutline, flattenTree } from './restructure.js';

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

async function reorder(folderId, ids) {
  const current = await childIds(folderId);
  const goal = fitOrder(current, ids);
  const steps = moveSteps(current, goal);
  for (const step of steps) await chrome.bookmarks.move(step.id, { parentId: folderId, index: step.index });
  return { goal, moves: steps.length };
}

/** targets（{ folderId, path, ids }）の並びにする。適用後に読み直して食い違ったフォルダを返す。 */
async function applyOrder(targets) {
  const mismatches = [];
  let moves = 0;
  for (const t of targets) {
    let result;
    try {
      result = await reorder(t.folderId, t.ids);
    } catch {
      continue;
    }
    moves += result.moves;
    if ((await childIds(t.folderId)).join() !== result.goal.join()) mismatches.push(t.path);
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
  const { last, original, structureBackup } = await chrome.storage.local.get(['last', 'original', 'structureBackup']);
  const info = (s) => (s ? { takenAt: s.takenAt, folders: Object.keys(s.folders).length } : null);
  return {
    last: info(last),
    original: info(original),
    structure: structureBackup ? { takenAt: structureBackup.takenAt, created: structureBackup.created.length } : null,
  };
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

function structureSummary(planned) {
  return {
    errors: planned.errors,
    stats: planned.stats,
    operations: planned.ops.length,
    outline: planned.tree ? folderOutline(planned.tree) : [],
  };
}

async function structurePreview(msg) {
  const { bar } = await findBar();
  return structureSummary(planStructure(bar, msg.plan));
}

async function structureApply(msg) {
  const { bar } = await findBar();
  const planned = planStructure(bar, msg.plan);
  if (planned.errors.length || planned.ops.length === 0) return { ...structureSummary(planned), applied: false };

  // 最初の書き込みの前に、元に戻すための記録を保存する。記録が残っていれば最初のものを使い、
  // 並び替えの記録（反映前の構成のもの）もこのときだけ退避する
  const stored = await chrome.storage.local.get(['structureBackup', 'last', 'original']);
  let backup = stored.structureBackup;
  if (!backup) {
    backup = {
      takenAt: Date.now(),
      nodes: flattenTree(bar),
      sort: { last: stored.last ?? null, original: stored.original ?? null },
      created: [],
    };
    await chrome.storage.local.set({ structureBackup: backup });
    await chrome.storage.local.remove(['last', 'original']);
  }

  const ids = new Map();
  const real = (id) => ids.get(id) ?? id;
  for (const o of planned.ops) {
    if (o.op === 'create') {
      const node = await chrome.bookmarks.create({ parentId: real(o.parent), title: o.title });
      ids.set(o.ref, node.id);
      backup.created.push(node.id);
      await chrome.storage.local.set({ structureBackup: backup });
    } else if (o.op === 'move') {
      await chrome.bookmarks.move(real(o.id), { parentId: real(o.parent) });
    } else if (o.op === 'rename') {
      await chrome.bookmarks.update(real(o.id), { title: o.title });
    } else if (o.op === 'order') {
      await reorder(real(o.parent), o.ids.map(real));
    }
  }

  const live = (await findBar()).bar;
  const matches = JSON.stringify(shape(live)) === JSON.stringify(shape(planned.tree));
  return { ...structureSummary(planned), applied: true, matches };
}

async function structureUndo() {
  const { structureBackup: backup } = await chrome.storage.local.get('structureBackup');
  if (!backup) return { restored: false };
  const get = async (id) => (await chrome.bookmarks.get(id).catch(() => []))[0];
  let missing = 0;

  for (const n of backup.nodes) {
    const cur = await get(n.id);
    if (cur && n.folder && cur.title !== n.title) await chrome.bookmarks.update(n.id, { title: n.title });
  }
  // 前順なので、親と、同じ親の前の兄弟は先に確定している
  for (const n of backup.nodes) {
    const cur = await get(n.id);
    if (!cur) {
      missing++;
      continue;
    }
    if (cur.parentId === n.parentId && cur.index === n.index) continue;
    await chrome.bookmarks.move(n.id, { parentId: n.parentId, index: n.index });
  }
  const leftovers = [];
  for (const id of [...backup.created].reverse()) {
    const cur = await get(id);
    if (!cur) continue;
    if ((await chrome.bookmarks.getChildren(id)).length === 0) await chrome.bookmarks.remove(id);
    else leftovers.push(cur.title);
  }

  const restoredSort = Object.fromEntries(Object.entries(backup.sort).filter(([, v]) => v));
  await chrome.storage.local.remove(['last', 'original', 'structureBackup']);
  if (Object.keys(restoredSort).length) await chrome.storage.local.set(restoredSort);

  const mismatched = [];
  for (const n of backup.nodes) {
    const cur = await get(n.id);
    if (cur && (cur.parentId !== n.parentId || cur.index !== n.index || cur.title !== n.title)) mismatched.push(n.title);
  }
  return { restored: true, missing, leftovers, mismatched };
}

const HANDLERS = {
  status: async () => ({ running, ...(await snapshots()) }),
  preview,
  sort,
  undoLast: () => restore('last'),
  undoOriginal: () => restore('original'),
  structurePreview,
  structureApply,
  structureUndo,
};
const MUTATING = new Set(['sort', 'undoLast', 'undoOriginal', 'structureApply', 'structureUndo']);

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
  handler(msg)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }))
    .finally(() => {
      if (MUTATING.has(msg.type)) running = false;
    });
  return true;
});
