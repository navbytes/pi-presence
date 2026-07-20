#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Generate the README / pi-package hero image (assets/demo.png).
//
// This is an *illustration* of real `pi-presence-watch --once` output: the same
// header line, the same NEEDS-YOU / RUNNING / IDLE / DORMANT groups, and the
// same per-session line shape that packages/pi-watch/src/render.ts emits — drawn
// as a terminal window so it survives rasterization (color emoji do not).
//
// It builds an SVG (real text, Primer-dark colors, vector state glyphs) and
// rasterizes it to PNG with whatever is on PATH (rsvg-convert / resvg / magick).
// No image or font runtime dependency; if no rasterizer is found it writes the
// SVG and leaves the committed PNG untouched.
// ---------------------------------------------------------------------------

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const SVG_PATH = join(OUT_DIR, "demo.svg");
const PNG_PATH = join(OUT_DIR, "demo.png");

// GitHub Primer-dark palette — mirrors render.ts's ANSI roles.
const C = {
  bg: "#0d1117",
  chrome: "#161b22",
  border: "#30363d",
  text: "#e6edf3", // bold: session name / header
  dim: "#6e7681", // #id, cwd, age
  red: "#f85149", // needs-you
  amber: "#d29922", // running
  green: "#3fb950", // idle
  gray: "#8b949e", // dormant / model
  cyan: "#39c5cf", // branch
};

const FONT = "'SF Mono','DejaVu Sans Mono','Menlo','Consolas',monospace";
const FS = 20; // font size
const CW = FS * 0.6; // monospace advance width
const LH = 30; // line height
const PAD_X = 28;
const TOP = 92; // first baseline below the title bar
const SCALE = 2;

// Sessions in render.ts terms; `icon` picks the vector glyph, `color` the group.
const groups = [
  {
    title: "NEEDS YOU (1)",
    color: C.red,
    icon: "stop",
    rows: [
      {
        name: "deploy",
        id: "a3f1c9",
        cwd: "~/src/api",
        model: "anthropic/claude-sonnet-4",
        branch: "main",
        age: "8s",
        note: "Allow `rm -rf build`?",
      },
    ],
  },
  {
    title: "RUNNING (2)",
    color: C.amber,
    icon: "bolt",
    rows: [
      {
        name: "web-refactor",
        id: "7b2e04",
        cwd: "~/src/web",
        model: "anthropic/claude-opus-4",
        branch: "feat/router",
        age: "12s",
      },
      {
        name: "nt",
        id: "1c9d5a",
        cwd: "~/src/nt",
        model: "openai/gpt-5",
        branch: "main",
        age: "3s",
      },
    ],
  },
  {
    title: "IDLE (1)",
    color: C.green,
    icon: "check",
    rows: [
      {
        name: "docs",
        id: "e08b21",
        cwd: "~/src/pi-presence",
        model: "anthropic/claude-sonnet-4",
        branch: "docs/readme",
        age: "2m",
      },
    ],
  },
  {
    title: "DORMANT (1)",
    color: C.gray,
    icon: "moon",
    rows: [
      {
        name: "scratch",
        id: "44a0b7",
        cwd: "~/tmp",
        model: "anthropic/claude-haiku",
        branch: "main",
        age: "3d",
      },
    ],
  },
];

const HEADER = "pi-presence · 1 need you · 2 running · 1 idle · 1 dormant";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const yOf = (r) => (TOP + r * LH).toFixed(1);

let maxChars = 0; // widest plaintext line, drives the window width

/** One line of colored, monospaced segments ([{ t, fill, bold }]) at row `r`. */
function line(r, segs) {
  maxChars = Math.max(
    maxChars,
    segs.reduce((n, s) => n + s.t.length, 0),
  );
  const tspans = segs
    .map((s) => `<tspan${s.bold ? ' font-weight="700"' : ""} fill="${s.fill}">${esc(s.t)}</tspan>`)
    .join("");
  return `<text x="${PAD_X}" y="${yOf(r)}" xml:space="preserve" font-family="${FONT}" font-size="${FS}">${tspans}</text>`;
}

/** Vector state glyph, centered on the icon column (col 2) of text-row `r`. */
function glyph(kind, r, color) {
  const cx = PAD_X + 2.5 * CW;
  const cy = Number(yOf(r)) - FS * 0.32;
  const rad = FS * 0.44;
  const pt = (dx, dy) => `${(cx + dx).toFixed(1)},${(cy + dy).toFixed(1)}`;
  if (kind === "stop") {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 8) * (2 * i + 1);
      pts.push(pt(rad * Math.cos(a), rad * Math.sin(a)));
    }
    return `<polygon points="${pts.join(" ")}" fill="${color}"/>`;
  }
  if (kind === "bolt") {
    return `<polygon points="${pt(rad * 0.15, -rad)} ${pt(-rad * 0.7, rad * 0.15)} ${pt(-rad * 0.1, rad * 0.15)} ${pt(-rad * 0.15, rad)} ${pt(rad * 0.7, -rad * 0.15)} ${pt(rad * 0.1, -rad * 0.15)}" fill="${color}"/>`;
  }
  if (kind === "check") {
    return `<polyline points="${pt(-rad * 0.85, 0)} ${pt(-rad * 0.2, rad * 0.65)} ${pt(rad * 0.9, -rad * 0.75)}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // moon (dormant): a disc with an offset bg disc carving out a crescent.
  return (
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="${color}"/>` +
    `<circle cx="${(cx + rad * 0.5).toFixed(1)}" cy="${(cy - rad * 0.28).toFixed(1)}" r="${(rad * 0.82).toFixed(1)}" fill="${C.bg}"/>`
  );
}

// ---- Lay out the body -----------------------------------------------------
const IND = "    "; // 2-space indent + icon slot + trailing space (matches render.ts)
const els = [];
let r = 0;
els.push(line(r, [{ t: HEADER, fill: C.text, bold: true }]));
r += 2; // header + blank

for (const g of groups) {
  els.push(line(r, [{ t: g.title, fill: g.color, bold: true }]));
  r++;
  for (const s of g.rows) {
    els.push(glyph(g.icon, r, g.color));
    const segs = [
      { t: IND, fill: C.dim },
      { t: s.name, fill: C.text, bold: true },
      { t: ` #${s.id}`, fill: C.dim },
      { t: `  ${s.cwd}`, fill: C.dim },
      { t: "  [", fill: C.dim },
      { t: s.model, fill: C.gray },
      { t: " · ", fill: C.dim },
      { t: s.branch, fill: C.cyan },
      { t: " · ", fill: C.dim },
      { t: s.age, fill: C.dim },
      { t: "]", fill: C.dim },
    ];
    if (s.note) segs.push({ t: ` — ${s.note}`, fill: g.color });
    els.push(line(r, segs));
    r++;
  }
  r++; // blank line between groups
}

const W = Math.round(PAD_X * 2 + maxChars * CW);
const H = TOP + r * LH + 4;

const chrome = [
  `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="12" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5"/>`,
  `<path d="M0 12 A12 12 0 0 1 12 0 H${W - 12} A12 12 0 0 1 ${W} 12 V52 H0 Z" fill="${C.chrome}"/>`,
  `<line x1="0" y1="52" x2="${W}" y2="52" stroke="${C.border}" stroke-width="1"/>`,
  `<circle cx="24" cy="26" r="6" fill="#ff5f56"/>`,
  `<circle cx="46" cy="26" r="6" fill="#ffbd2e"/>`,
  `<circle cx="68" cy="26" r="6" fill="#27c93f"/>`,
  `<text x="${W / 2}" y="31" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${C.dim}">$ npx pi-presence-watch --once</text>`,
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${chrome.join("\n")}
${els.join("\n")}
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(SVG_PATH, svg);

// Rasterize with the first available tool. The SVG is the source of truth;
// `npm run assets:demo` degrades gracefully when no rasterizer is installed.
const rasterizers = [
  ["rsvg-convert", ["-w", String(W * SCALE), SVG_PATH, "-o", PNG_PATH]],
  ["resvg", [`--zoom=${SCALE}`, SVG_PATH, PNG_PATH]],
  ["magick", ["-density", String(96 * SCALE), "-background", "none", SVG_PATH, PNG_PATH]],
];

let via = null;
for (const [bin, args] of rasterizers) {
  try {
    execFileSync(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
    via = bin;
    break;
  } catch {
    /* try the next tool */
  }
}

if (!via) {
  console.log(
    `wrote ${SVG_PATH}\nno SVG rasterizer found (tried rsvg-convert, resvg, magick).\n` +
      `install one (e.g. \`brew install librsvg\`) to regenerate ${PNG_PATH}.`,
  );
} else {
  // Self-check: a valid PNG starts with the 8-byte signature.
  const sig = readFileSync(PNG_PATH).subarray(0, 8);
  if (!sig.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    rmSync(PNG_PATH, { force: true });
    throw new Error(`${via} produced a non-PNG file`);
  }
  console.log(`wrote ${SVG_PATH}\nwrote ${PNG_PATH} (via ${via}, ${W * SCALE}px wide)`);
}
