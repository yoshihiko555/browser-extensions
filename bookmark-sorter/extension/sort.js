// 並び替えの計画を作る純粋関数。chrome.* には触らない。

/** 集計用のホストキー（先頭の www. を除き、ポートは残す）。http(s) 以外は null。 */
export function hostKey(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  return u.port ? `${host}:${u.port}` : host;
}

/** 履歴項目（{ url, visitCount }）をホストごとの訪問回数に集計する。 */
export function aggregateHostCounts(historyItems) {
  const counts = new Map();
  for (const item of historyItems) {
    const key = hostKey(item.url);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + (item.visitCount ?? 0));
  }
  return counts;
}

/** 1 フォルダの子の並び。サブフォルダは今の順で先頭、ブックマークは訪問回数の多い順（同数は今の順）。 */
export function orderChildren(children, counts) {
  const folders = children.filter((c) => !c.url);
  const bookmarks = children
    .map((c, index) => ({ c, index, score: c.url ? (counts.get(hostKey(c.url)) ?? 0) : 0 }))
    .filter((x) => x.c.url)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.c);
  return [...folders, ...bookmarks].map((c) => c.id);
}

/** root 配下の全フォルダのうち、並びが変わるものを返す。root 直下の並びは変えない。 */
export function planSort(root, counts) {
  const changes = [];
  const walk = (folder, path) => {
    for (const child of folder.children ?? []) {
      if (child.url) continue;
      const childPath = [...path, child.title];
      const children = child.children ?? [];
      const before = children.map((c) => c.id);
      const after = orderChildren(children, counts);
      const moved = after.filter((id, i) => before[i] !== id).length;
      if (moved > 0) changes.push({ folderId: child.id, path: childPath.join('/'), before, after, moved });
      walk(child, childPath);
    }
  };
  walk(root, []);
  return changes;
}

/** before を after に並べ替える move 手順（{ id, index }）。前から順に確定させるので、移動は常に上方向になる。 */
export function moveSteps(before, after) {
  const cur = [...before];
  const steps = [];
  after.forEach((id, i) => {
    const from = cur.indexOf(id);
    if (from === i || from === -1) return;
    cur.splice(from, 1);
    cur.splice(i, 0, id);
    steps.push({ id, index: i });
  });
  return steps;
}

/** 目標の並びを今の子に当てはめる。消えたものは飛ばし、目標に無いものは今の順で末尾に置く。 */
export function fitOrder(currentIds, targetIds) {
  const present = new Set(currentIds);
  const kept = targetIds.filter((id) => present.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...currentIds.filter((id) => !keptSet.has(id))];
}

/** 変更前の並びのスナップショット。 */
export function snapshotOf(changes, takenAt) {
  return {
    takenAt,
    folders: Object.fromEntries(changes.map((c) => [c.folderId, { path: c.path, ids: c.before }])),
  };
}

/** 初回の並びを保持する。original に無いフォルダだけ snapshot から足す。 */
export function mergeOriginal(original, snapshot) {
  if (!original) return snapshot;
  const folders = { ...original.folders };
  for (const [id, entry] of Object.entries(snapshot.folders)) {
    if (!(id in folders)) folders[id] = entry;
  }
  return { takenAt: original.takenAt, folders };
}
