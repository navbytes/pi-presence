#!/usr/bin/env node
// Manual smoke test: proves the pi-presence extension actually loads and
// writes a live state file against a REAL pi binary + a real local LLM
// (ollama). Needs a running ollama daemon, so this is NOT wired into CI —
// run it on demand:
//
//   npm run smoke
//
// See handoffs/live-wave1.md and handoffs/qa-journey-wave1.md for the failure
// this guards against (D1: the extension crashed every session on real pi
// 0.79.2 even though the mocked test suite stayed green).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 240_000;
const POLL_MS = 250;
const OLLAMA_URL = "http://localhost:11434";
const MODEL = "llama3:latest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(root, "packages/pi-presence/extensions/index.ts");

function skip(reason) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

/** Resolve the `pi` binary: PATH first, then the well-known homebrew path. */
function resolvePi() {
  if (spawnSync("pi", ["--version"], { stdio: "ignore" }).status === 0) return "pi";
  const fallback = "/opt/homebrew/bin/pi";
  if (
    existsSync(fallback) &&
    spawnSync(fallback, ["--version"], { stdio: "ignore" }).status === 0
  ) {
    return fallback;
  }
  return null;
}

async function ollamaHasModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return false;
    const body = await res.json();
    return (
      Array.isArray(body.models) && body.models.some((m) => m.name === MODEL || m.model === MODEL)
    );
  } catch {
    return false;
  }
}

const piBin = resolvePi();
if (!piBin) skip("`pi` binary not found on PATH or at /opt/homebrew/bin/pi");
if (!existsSync(extensionPath)) fail(`extension not found at ${extensionPath}`);
if (!(await ollamaHasModel())) {
  skip(
    `ollama not reachable at ${OLLAMA_URL} or "${MODEL}" not pulled (try: ollama pull ${MODEL})`,
  );
}

// Fresh, isolated agent dir per run so this never touches a real ~/.pi/agent.
const agentDir = mkdtempSync(join(tmpdir(), "pi-presence-smoke-agent-"));
const projectDir = mkdtempSync(join(tmpdir(), "pi-presence-smoke-proj-"));
const liveDir = join(agentDir, "live");

// pi 0.79.2 has no built-in "ollama" provider; register it the same way the
// live-test wave's sandbox did (handoffs/live-wave1.md "Setup deviations").
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      ollama: {
        baseUrl: `${OLLAMA_URL}/v1`,
        api: "openai-completions",
        apiKey: "ollama",
        models: [{ id: MODEL }],
      },
    },
  }),
);

console.log(`pi:          ${piBin}`);
console.log(`agent dir:   ${agentDir}`);
console.log(`project dir: ${projectDir}`);
console.log(`extension:   ${extensionPath}`);

const child = spawn(
  piBin,
  [
    "--provider",
    "ollama",
    "--model",
    MODEL,
    "-e",
    extensionPath,
    "--no-extensions",
    "-nc",
    "--no-skills",
    // llama3:latest 400s on ANY request that carries tool definitions
    // ("does not support tools"); irrelevant to presence mechanics, which
    // never depend on tool use. See handoffs/live-wave1.md §Setup deviations.
    "-nt",
    "-p",
    "Reply ok",
  ],
  {
    cwd: projectDir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => {
  stdout += d;
});
child.stderr.on("data", (d) => {
  stderr += d;
});

let sawWorking = false;
let extensionLoadError = false;

function pollLiveDir() {
  if (!existsSync(liveDir)) return;
  for (const name of readdirSync(liveDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = JSON.parse(readFileSync(join(liveDir, name), "utf8"));
      if (file.schema === 1 && file.state === "working") sawWorking = true;
    } catch {
      // torn/mid-write file (atomic rename lost the race with our read); the
      // next poll tick will see the settled version.
    }
  }
}

function pollStderr() {
  if (stderr.includes("Failed to load extension")) extensionLoadError = true;
}

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  clearInterval(poll);
  clearTimeout(killTimer);
  if (!child.killed && child.exitCode === null) child.kill("SIGKILL");
  pollLiveDir();
  pollStderr();

  if (extensionLoadError) {
    console.error("--- stderr ---");
    console.error(stderr);
    fail('extension load error detected ("Failed to load extension" in stderr) — D1 regressed');
  }
  if (!sawWorking) {
    console.error("--- stdout ---");
    console.error(stdout);
    console.error("--- stderr ---");
    console.error(stderr);
    fail(`never observed a schema-1 state file with state:"working" in ${liveDir}`);
  }

  console.log(
    'OK: observed a schema-1 state file with state:"working" — extension loaded and ran on real pi 0.79.2.',
  );
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  process.exit(0);
}

const poll = setInterval(() => {
  pollLiveDir();
  pollStderr();
  if (extensionLoadError) finish();
}, POLL_MS);

const killTimer = setTimeout(() => {
  finish();
}, TIMEOUT_MS);

child.on("exit", () => finish());
child.on("error", (err) => {
  console.error(String(err));
  fail(`failed to spawn ${piBin}`);
});
