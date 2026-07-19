#!/usr/bin/env node
// Assert the extension's pinned schema copy is byte-identical to the canonical
// one in the shared package. The extension ships its own copy so its published
// tarball does not depend on the private workspace package; this guards drift.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = join(root, "packages/shared/src/schema.ts");
const copy = join(root, "packages/pi-presence/src/schema.ts");

const a = readFileSync(canonical);
const b = readFileSync(copy);

if (!a.equals(b)) {
  console.error("✗ schema.ts drift detected between:");
  console.error(`    ${canonical}`);
  console.error(`    ${copy}`);
  console.error("  Copy the canonical file over the extension's copy:");
  console.error("    cp packages/shared/src/schema.ts packages/pi-presence/src/schema.ts");
  process.exit(1);
}

console.log("✓ schema-sync: extension schema.ts matches the canonical shared copy");
