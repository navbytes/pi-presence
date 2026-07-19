// ---------------------------------------------------------------------------
// Minimal RFC 6902 JSON Patch generator + applier.
//
// The Vee plugin (and any diffing reader) keeps the last-rendered view model and
// emits `compare(prev, next)` so the menubar re-renders only deltas. We emit
// add/remove/replace only — `move`/`copy`/`test` are optimizations, not required
// for a valid, transform-correct patch. Array diffs are element-wise by index
// (correct, though not minimal under reordering). `applyPatch` exists mainly to
// round-trip-test the generator but is a usable applier for the ops we emit.
// ---------------------------------------------------------------------------

export type JsonPointer = string;

export type PatchOp =
  | { op: "add"; path: JsonPointer; value: unknown }
  | { op: "remove"; path: JsonPointer }
  | { op: "replace"; path: JsonPointer; value: unknown };

/** Escape a single JSON Pointer reference token (RFC 6901). */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Unescape a single JSON Pointer reference token (RFC 6901). */
export function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural deep equality for JSON-shaped values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!Object.hasOwn(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/** Produce a valid RFC 6902 patch transforming `prev` into `next`. */
export function compare(prev: unknown, next: unknown, base: JsonPointer = ""): PatchOp[] {
  const ops: PatchOp[] = [];
  diffInto(ops, prev, next, base);
  return ops;
}

function diffInto(ops: PatchOp[], prev: unknown, next: unknown, path: JsonPointer): void {
  if (deepEqual(prev, next)) return;

  const bothArrays = Array.isArray(prev) && Array.isArray(next);
  const bothObjects = isPlainObject(prev) && isPlainObject(next);

  if (!bothArrays && !bothObjects) {
    ops.push({ op: "replace", path: path === "" ? "" : path, value: next });
    return;
  }

  if (bothArrays) {
    const a = prev as unknown[];
    const b = next as unknown[];
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) {
      diffInto(ops, a[i], b[i], `${path}/${i}`);
    }
    if (b.length > a.length) {
      for (let i = a.length; i < b.length; i++) {
        ops.push({ op: "add", path: `${path}/-`, value: b[i] });
      }
    } else if (a.length > b.length) {
      // Remove from the tail downward so indices stay valid on sequential apply.
      for (let i = a.length - 1; i >= b.length; i--) {
        ops.push({ op: "remove", path: `${path}/${i}` });
      }
    }
    return;
  }

  // both plain objects
  const ao = prev as Record<string, unknown>;
  const bo = next as Record<string, unknown>;
  for (const key of Object.keys(ao)) {
    if (!Object.hasOwn(bo, key)) {
      ops.push({ op: "remove", path: `${path}/${escapePointerToken(key)}` });
    }
  }
  for (const key of Object.keys(bo)) {
    const childPath = `${path}/${escapePointerToken(key)}`;
    if (!Object.hasOwn(ao, key)) {
      ops.push({ op: "add", path: childPath, value: bo[key] });
    } else {
      diffInto(ops, ao[key], bo[key], childPath);
    }
  }
}

function parsePointer(path: JsonPointer): string[] {
  if (path === "") return [];
  if (path[0] !== "/") throw new Error(`invalid JSON pointer: ${path}`);
  return path.slice(1).split("/").map(unescapePointerToken);
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Apply a patch to a document, returning a new document. Supports the
 * add/remove/replace ops this module emits (including the `-` array append).
 */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  let root: unknown = clone(doc);
  for (const op of ops) {
    root = applyOne(root, op);
  }
  return root as T;
}

function applyOne(root: unknown, op: PatchOp): unknown {
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    // Whole-document replace/add.
    if (op.op === "remove") throw new Error("cannot remove document root");
    return (op as { value: unknown }).value;
  }

  const parentTokens = tokens.slice(0, -1);
  const last = tokens[tokens.length - 1] as string;
  let parent: unknown = root;
  for (const t of parentTokens) {
    if (Array.isArray(parent)) parent = parent[Number(t)];
    else if (isPlainObject(parent)) parent = parent[t];
    else throw new Error(`path not found: ${op.path}`);
  }

  if (Array.isArray(parent)) {
    const arr = parent;
    if (op.op === "add") {
      const idx = last === "-" ? arr.length : Number(last);
      arr.splice(idx, 0, (op as { value: unknown }).value);
    } else if (op.op === "remove") {
      arr.splice(Number(last), 1);
    } else {
      arr[Number(last)] = (op as { value: unknown }).value;
    }
  } else if (isPlainObject(parent)) {
    const obj = parent;
    if (op.op === "remove") delete obj[last];
    else obj[last] = (op as { value: unknown }).value;
  } else {
    throw new Error(`path not found: ${op.path}`);
  }
  return root;
}
