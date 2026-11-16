// 構成ファイル（bookmark-sorter/structure@1）を木に当てはめ、操作列と結果の木を作る純粋関数。

export const FORMAT = 'bookmark-sorter/structure@1';

const isFolder = (n) => n.url === undefined;

function clone(n) {
  const c = { id: n.id, title: n.title };
  if (!isFolder(n)) c.url = n.url;
  else c.children = (n.children ?? []).map(clone);
  return c;
}

function indexTree(root) {
  const byId = new Map();
  const walk = (n, parent) => {
    byId.set(n.id, { node: n, parent });
    for (const c of n.children ?? []) walk(c, n);
  };
  walk(root, null);
  return byId;
}

function resolve(root, path) {
  if (path === '') return { node: root };
  let cur = root;
  for (const name of path.split('/')) {
    const hits = (cur.children ?? []).filter((c) => isFolder(c) && c.title === name);
    if (hits.length === 0) return { error: `フォルダが見つかりません: ${path}` };
    if (hits.length > 1) return { error: `同じ名前のフォルダが複数あります: ${path}` };
    cur = hits[0];
  }
  return { node: cur };
}

/** 同じ親の中で、フォルダの位置だけを names の順に入れ替える（names に無いものは今の順で後ろ）。ブックマークの位置は変えない。 */
export function arrangeFolders(children, names) {
  const rank = (c) => (names.includes(c.title) ? names.indexOf(c.title) : names.length);
  const folders = children
    .map((c, i) => ({ c, i }))
    .filter((x) => isFolder(x.c))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
  let k = 0;
  return children.map((c) => (isFolder(c) ? folders[k++] : c).id);
}

/**
 * root（ブックマークバー）に構成ファイルを当てはめる。
 * 戻り値の ops は errors が空のときだけ入る。反映済みの操作は飛ばすので、途中で止まっても再実行で収束する。
 */
export function planStructure(rootIn, plan) {
  const empty = { create: 0, folderMoves: 0, renames: 0, moves: 0, reorders: 0, already: 0 };
  if (plan?.format !== FORMAT) {
    return { errors: [`構成ファイルの形式が違います（format: ${plan?.format ?? 'なし'}）`], ops: [], tree: null, stats: empty };
  }
  const root = clone(rootIn);
  const byId = indexTree(root);
  const position = new Map([...byId.keys()].map((id, i) => [id, i]));
  const errors = [];
  const ops = [];
  const stats = { ...empty };
  let seq = 0;

  const detach = (node) => {
    const { parent } = byId.get(node.id);
    parent.children.splice(parent.children.indexOf(node), 1);
  };
  const attach = (node, parent) => {
    parent.children.push(node);
    byId.set(node.id, { node, parent });
  };
  const within = (node, ancestor) => {
    for (let cur = node; cur; cur = byId.get(cur.id)?.parent) if (cur === ancestor) return true;
    return false;
  };

  for (const path of plan.createFolders ?? []) {
    if (resolve(root, path).node) {
      stats.already++;
      continue;
    }
    const cut = path.lastIndexOf('/');
    const parent = resolve(root, cut < 0 ? '' : path.slice(0, cut));
    if (parent.error) {
      errors.push(parent.error);
      continue;
    }
    const node = { id: `new:${seq++}`, title: path.slice(cut + 1), children: [] };
    attach(node, parent.node);
    ops.push({ op: 'create', ref: node.id, parent: parent.node.id, title: node.title });
    stats.create++;
  }

  for (const f of plan.folders ?? []) {
    const hit = byId.get(f.id);
    if (!hit || !isFolder(hit.node) || hit.node === root) {
      errors.push(`フォルダが見つかりません: ${f.title}（id ${f.id}）`);
      continue;
    }
    const node = hit.node;
    const title = f.rename ?? f.title;
    if (node.title !== f.title && node.title !== title) {
      errors.push(`フォルダ名が想定と違います: id ${f.id} は「${node.title}」（想定は「${f.title}」）`);
      continue;
    }
    let dest = hit.parent;
    if (f.to !== undefined) {
      const r = resolve(root, f.to);
      if (r.error) {
        errors.push(r.error);
        continue;
      }
      dest = r.node;
      if (within(dest, node)) {
        errors.push(`フォルダを自分の中へは移せません: ${f.title}`);
        continue;
      }
    }
    if (dest.children.some((c) => c !== node && isFolder(c) && c.title === title)) {
      errors.push(`移動先に同じ名前のフォルダがあります: ${title}`);
      continue;
    }
    let changed = false;
    if (hit.parent !== dest) {
      detach(node);
      attach(node, dest);
      ops.push({ op: 'move', id: node.id, parent: dest.id });
      stats.folderMoves++;
      changed = true;
    }
    if (node.title !== title) {
      node.title = title;
      ops.push({ op: 'rename', id: node.id, title });
      stats.renames++;
      changed = true;
    }
    if (!changed) stats.already++;
  }

  const moves = [...(plan.moves ?? [])].sort(
    (a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity),
  );
  for (const m of moves) {
    const hit = byId.get(m.id);
    if (!hit || isFolder(hit.node)) {
      errors.push(`ブックマークが見つかりません: id ${m.id}`);
      continue;
    }
    if (hit.node.url !== m.url) {
      errors.push(`ブックマークの URL が想定と違います: id ${m.id}（${hit.node.title}）`);
      continue;
    }
    const dest = resolve(root, m.to);
    if (dest.error) {
      errors.push(dest.error);
      continue;
    }
    if (hit.parent === dest.node) {
      stats.already++;
      continue;
    }
    detach(hit.node);
    attach(hit.node, dest.node);
    ops.push({ op: 'move', id: m.id, parent: dest.node.id });
    stats.moves++;
  }

  for (const [path, names] of Object.entries(plan.folderOrder ?? {})) {
    const parent = resolve(root, path);
    if (parent.error) {
      errors.push(parent.error);
      continue;
    }
    const before = parent.node.children.map((c) => c.id);
    const after = arrangeFolders(parent.node.children, names);
    if (before.join() === after.join()) continue;
    parent.node.children = after.map((id) => byId.get(id).node);
    ops.push({ op: 'order', parent: parent.node.id, ids: after });
    stats.reorders++;
  }

  return { errors, ops: errors.length ? [] : ops, tree: root, stats };
}

/** 比較・表示用に id を除いた形（フォルダは [title, children]、ブックマークは [title, url]）。 */
export function shape(node) {
  return isFolder(node) ? [node.title, (node.children ?? []).map(shape)] : [node.title, node.url];
}

/** フォルダだけの一覧（表示用）。 */
export function folderOutline(node, depth = 0, out = []) {
  for (const c of node.children ?? []) {
    if (!isFolder(c)) continue;
    out.push({ depth, title: c.title, bookmarks: (c.children ?? []).filter((x) => !isFolder(x)).length });
    folderOutline(c, depth + 1, out);
  }
  return out;
}

/** 元に戻すための記録。root 配下の全ノードの親・位置・名前を前順で持つ。 */
export function flattenTree(root) {
  const out = [];
  const walk = (n) => {
    (n.children ?? []).forEach((c, index) => {
      out.push({ id: c.id, parentId: n.id, index, title: c.title, folder: isFolder(c) });
      if (isFolder(c)) walk(c);
    });
  };
  walk(root);
  return out;
}
