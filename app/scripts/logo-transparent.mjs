// Makes the logo's outer black background transparent (flood fill from the edges, so black
// inside the white outline is kept), softens the edge, and crops to the artwork.
//   node scripts/logo-transparent.mjs public/degenwild-logo.png public/degenwild-logo-t.png
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [src, dst] = process.argv.slice(2);
const img = PNG.sync.read(readFileSync(src));
const { width: W, height: H, data } = img;
const lum = (i) => Math.max(data[i], data[i + 1], data[i + 2]);
const DARK = 60;

const bg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const p = stack.pop();
  if (bg[p] || lum(p * 4) > DARK) continue;
  bg[p] = 1;
  const x = p % W, y = (p / W) | 0;
  if (x > 0) stack.push(p - 1);
  if (x < W - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - W);
  if (y < H - 1) stack.push(p + W);
}

let minX = W, minY = H, maxX = 0, maxY = 0;
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  if (bg[p]) {
    data[i + 3] = 0;
    continue;
  }
  // Anti-alias pixels touching the background: fade dark fringe.
  const x = p % W, y = (p / W) | 0;
  const edge = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
  if (edge) data[i + 3] = Math.min(255, Math.round((lum(i) / 140) * 255));
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}

const pad = 8;
minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
const out = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
PNG.bitblt(img, out, minX, minY, out.width, out.height, 0, 0);
writeFileSync(dst, PNG.sync.write(out, { colorType: 6 }));
console.log(`${W}x${H} -> ${out.width}x${out.height}, ${(readFileSync(dst).length / 1024).toFixed(0)} KB`);
