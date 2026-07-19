#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Generate a simple placeholder gallery image (assets/demo.png) with no external
// deps. Replace with a real screenshot before publishing; this exists so the
// pi.image URL resolves once the repo is on GitHub.
import { deflateSync } from "node:zlib";

const WIDTH = 1280;
const HEIGHT = 640;

// Palette (GitHub-dark-ish).
const BG = [13, 17, 23];
const BANDS = [
  [248, 81, 73], // needs-you (red)
  [210, 153, 34], // running (amber)
  [63, 185, 80], // idle (green)
  [110, 118, 129], // dormant (gray)
];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Build raw RGB scanlines with a filter byte per row.
const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
let o = 0;
const bandHeight = Math.floor(HEIGHT / 6);
const bandStart = HEIGHT - bandHeight * (BANDS.length + 1);
for (let y = 0; y < HEIGHT; y++) {
  raw[o++] = 0; // filter: none
  const bandIndex = Math.floor((y - bandStart) / bandHeight);
  const inBands = y >= bandStart && bandIndex >= 0 && bandIndex < BANDS.length;
  for (let x = 0; x < WIDTH; x++) {
    let color = BG;
    if (inBands && x > 120 && x < WIDTH - 120) {
      const filled = 120 + (WIDTH - 240) * ((bandIndex + 1) / (BANDS.length + 1));
      if (x < filled) color = BANDS[bandIndex];
    }
    raw[o++] = color[0];
    raw[o++] = color[1];
    raw[o++] = color[2];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "demo.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${WIDTH}x${HEIGHT})`);
