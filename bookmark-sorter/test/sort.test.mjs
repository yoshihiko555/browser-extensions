// sort.js の単体テスト。node --test test/sort.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hostKey,
  aggregateHostCounts,
  orderChildren,
  planSort,
  moveSteps,
  fitOrder,
  snapshotOf,
  mergeOriginal,
} from '../extension/sort.js';

const bm = (id, url) => ({ id, title: id, url });
const folder = (id, children = []) => ({ id, title: id, children });

test('hostKey は www. を除きポートを残す', () => {
  assert.equal(hostKey('https://www.example.com/a?b=1'), 'example.com');
  assert.equal(hostKey('http://localhost:3000/x'), 'localhost:3000');
  assert.equal(hostKey('http://www.localhost:8000/admin/'), 'localhost:8000');
});

test('hostKey は http(s) 以外と壊れた URL で null', () => {
  assert.equal(hostKey('javascript:alert(1)'), null);
  assert.equal(hostKey('chrome://inspect/#devices'), null);
  assert.equal(hostKey('not a url'), null);
});

test('aggregateHostCounts はホストごとに visitCount を合算する', () => {
  const counts = aggregateHostCounts([
    { url: 'https://a.example/1', visitCount: 3 },
    { url: 'https://www.a.example/2', visitCount: 2 },
    { url: 'https://b.example/', visitCount: 1 },
    { url: 'chrome://history', visitCount: 9 },
  ]);
  assert.equal(counts.get('a.example'), 5);
  assert.equal(counts.get('b.example'), 1);
  assert.equal(counts.size, 2);
});

test('orderChildren はサブフォルダを今の順で先頭に、ブックマークを回数順に並べる', () => {
  const counts = new Map([['b.example', 10], ['c.example', 5]]);
  const children = [
    bm('a', 'https://a.example/'),
    folder('F2'),
    bm('b', 'https://b.example/'),
    folder('F1'),
    bm('c', 'https://c.example/'),
  ];
  assert.deepEqual(orderChildren(children, counts), ['F2', 'F1', 'b', 'c', 'a']);
});

test('orderChildren は同数・未訪問・特殊 URL の今の順を保つ', () => {
  const counts = new Map([['x.example', 1]]);
  const children = [
    bm('z1', 'https://zero1.example/'),
    bm('js', 'javascript:void(0)'),
    bm('x1', 'https://x.example/1'),
    bm('z2', 'https://zero2.example/'),
    bm('x2', 'https://x.example/2'),
  ];
  assert.deepEqual(orderChildren(children, counts), ['x1', 'x2', 'z1', 'js', 'z2']);
});

test('planSort は root 直下を動かさず、並びが変わるフォルダだけ返す', () => {
  const counts = new Map([['hot.example', 9]]);
  const root = folder('bar', [
    bm('top', 'https://cold.example/'),
    folder('A', [bm('a1', 'https://cold.example/'), bm('a2', 'https://hot.example/')]),
    folder('B', [bm('b1', 'https://hot.example/'), folder('B1', [bm('x', 'https://cold.example/')])]),
  ]);
  const changes = planSort(root, counts);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0], { folderId: 'A', path: 'A', before: ['a1', 'a2'], after: ['a2', 'a1'], moved: 2 });
  assert.equal(changes[1].path, 'B');
  assert.deepEqual(changes[1].after, ['B1', 'b1']);
});

test('planSort は並び済みなら空', () => {
  const counts = new Map([['hot.example', 9]]);
  const root = folder('bar', [folder('A', [bm('a2', 'https://hot.example/'), bm('a1', 'https://cold.example/')])]);
  assert.deepEqual(planSort(root, counts), []);
});

/** Chrome の move（同一フォルダ内で下へ動かす時は index を移動前の位置で解釈する）を再現する。 */
function applyChromeMoves(ids, steps) {
  const cur = [...ids];
  for (const { id, index } of steps) {
    const from = cur.indexOf(id);
    const to = index > from ? index - 1 : index;
    cur.splice(from, 1);
    cur.splice(to, 0, id);
  }
  return cur;
}

test('moveSteps の手順を Chrome の move 規則で適用すると目標の並びになる', () => {
  const before = ['a', 'b', 'c', 'd', 'e'];
  for (const after of [
    ['e', 'd', 'c', 'b', 'a'],
    ['b', 'c', 'd', 'e', 'a'],
    ['a', 'b', 'c', 'd', 'e'],
    ['c', 'a', 'e', 'b', 'd'],
  ]) {
    assert.deepEqual(applyChromeMoves(before, moveSteps(before, after)), after);
  }
  assert.deepEqual(moveSteps(before, before), []);
});

test('fitOrder は消えたものを飛ばし、増えたものを末尾に置く', () => {
  assert.deepEqual(fitOrder(['c', 'new', 'a'], ['a', 'gone', 'c']), ['a', 'c', 'new']);
});

test('mergeOriginal は最初の並びを上書きせず、未記録のフォルダだけ足す', () => {
  const first = snapshotOf([{ folderId: 'A', path: 'A', before: ['1', '2'] }], 100);
  const second = snapshotOf(
    [
      { folderId: 'A', path: 'A', before: ['2', '1'] },
      { folderId: 'B', path: 'B', before: ['3', '4'] },
    ],
    200,
  );
  assert.equal(mergeOriginal(undefined, first), first);
  const merged = mergeOriginal(first, second);
  assert.equal(merged.takenAt, 100);
  assert.deepEqual(merged.folders.A.ids, ['1', '2']);
  assert.deepEqual(merged.folders.B.ids, ['3', '4']);
});
