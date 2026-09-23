// Generates the app + tray icons as PNGs with no external dependencies.
// A soft glowing orb with a crescent "rest" cutout. Run: npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// mono = true draws a flat white glyph (for the tray), otherwise a colored app icon.
function render(size, { mono = false, background = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size * 2 - 1;
          const v = (y + (sy + 0.5) / ss) / size * 2 - 1;
          let cr = 0, cg = 0, cb = 0, ca = 0;

          if (background && !mono) {
            // Rounded-square night background
            const q = Math.max(Math.abs(u), Math.abs(v));
            const rr = Math.hypot(Math.max(Math.abs(u) - 0.62, 0), Math.max(Math.abs(v) - 0.62, 0));
            const inside = q < 0.62 ? 1 : 1 - smooth(0.34, 0.36, rr);
            const t = (v + 1) / 2;
            cr = 22 + 20 * t; cg = 24 + 8 * t; cb = 52 + 20 * t; ca = inside;
          }

          // Orb with crescent cut
          const d = Math.hypot(u, v);
          const cut = Math.hypot(u - 0.26, v + 0.22);
          const orbR = mono ? 0.86 : 0.56;
          const cutR = mono ? 0.62 : 0.47;
          const edge = mono ? 0.04 : 0.02;
          const orb = (1 - smooth(orbR - edge, orbR + edge, d)) * smooth(cutR - edge, cutR + edge, mono ? Math.hypot(u - 0.42, v + 0.36) : cut);
          if (orb > 0) {
            let or, og, ob;
            if (mono) { or = og = ob = 255; } else {
              const t = (u + v + 2) / 4;
              or = 186 + 50 * t; og = 176 + 30 * (1 - t); ob = 255;
            }
            cr = cr * (1 - orb) + or * orb;
            cg = cg * (1 - orb) + og * orb;
            cb = cb * (1 - orb) + ob * orb;
            ca = Math.max(ca, orb);
          }

          // Soft glow around orb (colored icon only)
          if (!mono) {
            const glow = Math.exp(-Math.pow((d - 0.56) / 0.12, 2)) * 0.25 * (d > 0.56 ? 1 : 0);
            cr += glow * 160; cg += glow * 150; cb += glow * 255;
          }

          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      px[i] = alpha ? Math.min(255, r / a) : 0;
      px[i + 1] = alpha ? Math.min(255, g / a) : 0;
      px[i + 2] = alpha ? Math.min(255, b / a) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(size, px);
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512));
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), render(256));
fs.writeFileSync(path.join(root, 'assets', 'tray.png'), render(16, { mono: true }));
fs.writeFileSync(path.join(root, 'assets', 'tray@2x.png'), render(32, { mono: true }));
console.log('Icons written.');
