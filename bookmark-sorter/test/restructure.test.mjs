// restructure.js の単体テスト。node --test test/restructure.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, arrangeFolders, planStructure, shape, flattenTree } from '../extension/restructure.js';

const bm = (id, url) => ({ id, title: id, url });
const folder = (id, title, children = []) => ({ id, title, children });

function sampleBar() {
  return folder('bar', 'Bookmarks Bar', [
    bm('home', 'https://home.example/'),
    folder('me', 'Me', [bm('m1', 'https://m1.example/'), bm('m2', 'https://m2.example/')]),
    folder('dev', 'Dev', [bm('d1', 'https://d1.example/'), bm('d2', 'https://d2.example/'), bm('d3', 'https://d3.example/')]),
    folder('idea', 'Idea', [bm('i1', 'https://i1.example/'), bm('i2', 'https://i2.example/')]),
    folder('llm', 'LLM', [folder('lb', 'Leaderborad', [bm('l1', 'https://l1.example/')])]),
    folder('news', 'News', [bm('n1', 'https://n1.example/')]),
  ]);
}

function samplePlan() {
  return {
    format: FORMAT,
    createFolders: ['Daily', 'Dev/Console', 'Design', 'Design/Interior'],
    folders: [
      { id: 'idea', title: 'Idea', to: 'Design', rename: 'Inspiration' },
      { id: 'lb', title: 'Leaderborad', rename: 'Leaderboard' },
    ],
    moves: [
      { id: 'd3', url: 'https://d3.example/', to: 'Dev/Console' },
      { id: 'm2', url: 'https://m2.example/', to: 'Daily' },
      { id: 'd1', url: 'https://d1.example/', to: 'Dev/Console' },
      { id: 'i2', url: 'https://i2.example/', to: 'Design/Interior' },
    ],
    folderOrder: { '': ['Me', 'Daily', 'Dev', 'LLM', 'Design', 'News'], Design: ['Inspiration', 'Interior'] },
  };
}

test('arrangeFolders はフォルダの位置だけを入れ替え、ブックマークの位置は保つ', () => {
  const children = [bm('u', 'https://u.example/'), folder('a', 'A'), folder('b', 'B'), folder('c', 'C')];
  assert.deepEqual(arrangeFolders(children, ['C', 'A']), ['u', 'c', 'a', 'b']);
});

test('planStructure は作成・移動・改名・並びを当てはめた木を返す', () => {
  const { errors, ops, tree, stats } = planStructure(sampleBar(), samplePlan());
  assert.deepEqual(errors, []);
  assert.deepEqual(stats, { create: 4, folderMoves: 1, renames: 2, moves: 4, reorders: 2, already: 0 });
  assert.ok(ops.length > 0);
  assert.deepEqual(shape(tree), [
    'Bookmarks Bar',
    [
      ['home', 'https://home.example/'],
      ['Me', [['m1', 'https://m1.example/']]],
      ['Daily', [['m2', 'https://m2.example/']]],
      ['Dev', [['d2', 'https://d2.example/'], ['Console', [['d1', 'https://d1.example/'], ['d3', 'https://d3.example/']]]]],
      ['LLM', [['Leaderboard', [['l1', 'https://l1.example/']]]]],
      ['Design', [['Inspiration', [['i1', 'https://i1.example/']]], ['Interior', [['i2', 'https://i2.example/']]]]],
      ['News', [['n1', 'https://n1.example/']]],
    ],
  ]);
});

test('planStructure は移動するブックマークを今の並び順で追加する', () => {
  const { tree } = planStructure(sampleBar(), samplePlan());
  const dev = tree.children.find((c) => c.title === 'Dev');
  const consoleFolder = dev.children.find((c) => c.title === 'Console');
  assert.deepEqual(consoleFolder.children.map((c) => c.id), ['d1', 'd3']);
});

test('planStructure は反映済みの木に対して操作なしになる', () => {
  const first = planStructure(sampleBar(), samplePlan());
  const again = planStructure(first.tree, samplePlan());
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.ops, []);
  assert.equal(again.stats.already, 4 + 2 + 4);
});

test('planStructure は食い違いがあれば操作を 1 つも返さない', () => {
  const plan = samplePlan();
  plan.moves[0] = { id: 'd3', url: 'https://changed.example/', to: 'Dev/Console' };
  plan.folders.push({ id: 'news', title: 'Newz', to: 'Design' });
  plan.moves.push({ id: 'gone', url: 'https://gone.example/', to: 'Daily' });
  const { errors, ops } = planStructure(sampleBar(), plan);
  assert.equal(errors.length, 3);
  assert.deepEqual(ops, []);
});

test('planStructure は形式違い・存在しない移動先・自分の中への移動・名前の衝突を弾く', () => {
  assert.equal(planStructure(sampleBar(), { format: 'other' }).errors.length, 1);
  const bar = sampleBar();
  const r = planStructure(bar, {
    format: FORMAT,
    folders: [
      { id: 'llm', title: 'LLM', to: 'LLM/Leaderborad' },
      { id: 'idea', title: 'Idea', rename: 'Me' },
    ],
    moves: [{ id: 'm1', url: 'https://m1.example/', to: 'Nowhere' }],
  });
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.ops, []);
});

test('flattenTree は全ノードの親・位置・名前を前順で記録する', () => {
  const flat = flattenTree(sampleBar());
  assert.equal(flat.length, 16);
  assert.deepEqual(flat[0], { id: 'home', parentId: 'bar', index: 0, title: 'home', folder: false });
  assert.deepEqual(
    flat.find((n) => n.id === 'l1'),
    { id: 'l1', parentId: 'lb', index: 0, title: 'l1', folder: false },
  );
});
