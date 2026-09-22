// 切り抜き矩形の計算。background.js とテストの両方から使う。
// captureVisibleTab の画像はビューポートを実ピクセルで撮ったものなので、
// CSS px の boundingRect に devicePixelRatio を掛けて合わせる。

// 切り抜きの外側に付ける余白（CSS px）。要素の周辺が見えた方が直しやすい。
export const CROP_PADDING = 8;

/**
 * @param {{left:number, top:number, width:number, height:number}} rect CSS px
 * @param {number} dpr devicePixelRatio
 * @param {{width:number, height:number}} image 実ピクセルの画像サイズ
 * @param {number} padding CSS px
 * @returns {{sx:number, sy:number, sw:number, sh:number}|null} 切り抜けない場合は null
 */
export function computeCropRect(rect, dpr, image, padding = CROP_PADDING) {
  if (!rect || !rect.width || !rect.height) return null;
  const scale = dpr || 1;
  const pad = padding * scale;

  let sx = Math.round(rect.left * scale - pad);
  let sy = Math.round(rect.top * scale - pad);
  let sw = Math.round(rect.width * scale + pad * 2);
  let sh = Math.round(rect.height * scale + pad * 2);

  // ビューポート外にはみ出した分を詰める
  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  sw = Math.min(sw, image.width - sx);
  sh = Math.min(sh, image.height - sy);

  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}
