#!/usr/bin/env node
// Print the CHANGELOG section for a given version, used to build GitHub Release
// notes in the release workflow. Reads the published package's changelog.
// Usage: node scripts/changelog-section.mjs <version>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("usage: changelog-section <version>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(root, "packages", "pi-presence", "CHANGELOG.md");

let text = "";
try {
  text = readFileSync(changelogPath, "utf8");
} catch {
  text = "";
}

const lines = text.split("\n");
const body = [];
let capturing = false;
for (const line of lines) {
  const heading = /^##\s+/.test(line);
  if (heading) {
    if (capturing) break; // reached the next version section
    const m = line.replace(/[[\]]/g, "").match(/^##\s+v?([^\s]+)/);
    if (m && m[1] === version) {
      capturing = true;
    }
  } else if (capturing) {
    body.push(line);
  }
}

const notes = body.join("\n").trim();
process.stdout.write(notes.length > 0 ? `${notes}\n` : `Release ${version}\n`);
