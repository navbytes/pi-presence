import { describe, expect, it } from "vitest";
import {
  applyPatch,
  compare,
  deepEqual,
  escapePointerToken,
  unescapePointerToken,
} from "./json-patch.js";

describe("pointer escaping", () => {
  it("escapes and unescapes ~ and /", () => {
    expect(escapePointerToken("a/b~c")).toBe("a~1b~0c");
    expect(unescapePointerToken("a~1b~0c")).toBe("a/b~c");
  });
});

describe("deepEqual", () => {
  it("compares nested structures", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});

describe("compare + applyPatch round-trips", () => {
  const cases: Array<[string, unknown, unknown]> = [
    ["primitive change", 1, 2],
    ["object add key", { a: 1 }, { a: 1, b: 2 }],
    ["object remove key", { a: 1, b: 2 }, { a: 1 }],
    ["object replace key", { a: 1 }, { a: 5 }],
    ["nested object", { a: { b: { c: 1 } } }, { a: { b: { c: 2, d: 3 } } }],
    ["array element replace", [1, 2, 3], [1, 9, 3]],
    ["array grow", [1, 2], [1, 2, 3, 4]],
    ["array shrink", [1, 2, 3, 4], [1, 2]],
    [
      "array of objects",
      [{ id: "a", v: 1 }],
      [
        { id: "a", v: 2 },
        { id: "b", v: 3 },
      ],
    ],
    ["array shrink of objects", [{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "a" }]],
    ["type change", { a: [1] }, { a: { x: 1 } }],
    ["key with slash", { "a/b": 1 }, { "a/b": 2 }],
    ["whole doc replace", { a: 1 }, [1, 2, 3]],
    ["no change", { a: 1 }, { a: 1 }],
    [
      "view-model-like",
      { counts: { running: 1 }, sessions: [{ id: "a", state: "working" }] },
      {
        counts: { running: 0, idle: 1 },
        sessions: [
          { id: "a", state: "idle" },
          { id: "b", state: "blocked" },
        ],
      },
    ],
  ];

  for (const [name, prev, next] of cases) {
    it(name, () => {
      const ops = compare(prev, next);
      const result = applyPatch(prev, ops);
      expect(result).toEqual(next);
      if (deepEqual(prev, next)) expect(ops).toHaveLength(0);
    });
  }

  it("does not mutate the source document when applying", () => {
    const prev = { a: { b: 1 }, list: [1, 2] };
    const ops = compare(prev, { a: { b: 2 }, list: [1] });
    const before = JSON.stringify(prev);
    applyPatch(prev, ops);
    expect(JSON.stringify(prev)).toBe(before);
  });

  it("emits only add/remove/replace ops", () => {
    const ops = compare({ a: 1, b: 2, arr: [1, 2, 3] }, { a: 9, arr: [1, 2, 3, 4] });
    for (const op of ops) {
      expect(["add", "remove", "replace"]).toContain(op.op);
    }
  });
});
