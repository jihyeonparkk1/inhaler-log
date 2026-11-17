// 아이콘 PNG 생성 (외부 라이브러리 없이). 실행: node tools/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [29, 95, 138], FG = [255, 255, 255], SOFT = [190, 220, 238];
function rrect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
// 단위 좌표(0~1)에서 흡입기 모양: 위쪽 약통 + 아래 본체 + 왼쪽 마우스피스
function color(u, v) {
  if (rrect(u, v, 0.42, 0.14, 0.62, 0.44, 0.05)) return SOFT;           // 약통
  if (rrect(u, v, 0.38, 0.40, 0.66, 0.80, 0.07)) return FG;             // 본체
  if (rrect(u, v, 0.22, 0.62, 0.50, 0.80, 0.06)) return FG;             // 마우스피스
  if (u > 0.12 && u < 0.24 && Math.abs(v - 0.71) < 0.018) return SOFT;  // 분사선
  if (u > 0.10 && u < 0.19 && Math.abs(v - 0.64 + (0.19 - u) * 0.3) < 0.015) return SOFT;
  if (u > 0.10 && u < 0.19 && Math.abs(v - 0.78 - (0.19 - u) * 0.3) < 0.015) return SOFT;
  return BG;
}
function png(size) {
  const ss = 4, raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = color((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size); r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3, n = ss * ss;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dir = new URL("../icons/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) writeFileSync(new URL(name, dir), png(size));
console.log("icons written");
