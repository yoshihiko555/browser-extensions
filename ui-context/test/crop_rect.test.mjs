// computeCropRect の単体テスト。node --test test/crop_rect.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { computeCropRect } from "../extension/crop.js";

const IMAGE = { width: 1440, height: 900 };

test("等倍・画面中央の要素は余白付きで切り抜かれる", () => {
  const r = computeCropRect({ left: 100, top: 200, width: 300, height: 50 }, 1, IMAGE);
  assert.deepEqual(r, { sx: 92, sy: 192, sw: 316, sh: 66 });
});

test("devicePixelRatio 2 では実ピクセルに換算される", () => {
  const r = computeCropRect({ left: 100, top: 200, width: 300, height: 50 }, 2, {
    width: 2880,
    height: 1800,
  });
  assert.deepEqual(r, { sx: 184, sy: 384, sw: 632, sh: 132 });
});

test("左上にはみ出す要素は画像内に詰められる", () => {
  const r = computeCropRect({ left: 0, top: 0, width: 100, height: 40 }, 1, IMAGE);
  assert.deepEqual(r, { sx: 0, sy: 0, sw: 108, sh: 48 });
});

test("右下にはみ出す要素は画像の端で止まる", () => {
  const r = computeCropRect({ left: 1400, top: 880, width: 200, height: 100 }, 1, IMAGE);
  assert.equal(r.sx + r.sw, IMAGE.width);
  assert.equal(r.sy + r.sh, IMAGE.height);
});

test("サイズ 0 の要素は切り抜かない", () => {
  assert.equal(computeCropRect({ left: 10, top: 10, width: 0, height: 0 }, 1, IMAGE), null);
});

test("完全に画面外の要素は切り抜かない", () => {
  assert.equal(
    computeCropRect({ left: 2000, top: 2000, width: 100, height: 100 }, 1, IMAGE),
    null
  );
});
