import { describe, expect, it } from "vitest";
import {
  MAX_TITLE_LENGTH,
  STATE_ICON,
  buildTitleEscape,
  formatTitle,
  sanitizeTitle,
} from "./osc-title.js";

const ESC = "\x1b";
const BEL = "\x07";

describe("sanitizeTitle", () => {
  it("strips CSI color sequences", () => {
    expect(sanitizeTitle(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });

  it("strips OSC sequences (title injection attempt)", () => {
    // The whole OSC sequence is removed; adjacent plain text joins.
    expect(sanitizeTitle(`safe${ESC}]0;evil${BEL}text`)).toBe("safetext");
    expect(sanitizeTitle(`safe${ESC}]0;evil${BEL}text`)).not.toContain("evil");
  });

  it("collapses control chars and whitespace", () => {
    expect(sanitizeTitle("a\t\n b\r\nc")).toBe("a b c");
  });

  it("truncates overly long titles with an ellipsis", () => {
    const long = "x".repeat(MAX_TITLE_LENGTH + 50);
    const out = sanitizeTitle(long);
    expect(out.length).toBe(MAX_TITLE_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("formatTitle", () => {
  it("replaces placeholders and sanitizes", () => {
    const out = formatTitle("{icon} {name} · {state} [{branch}]", {
      name: "nt",
      state: "working",
      icon: STATE_ICON.working,
      cwd: "/home/u/nt",
      branch: "main",
    });
    expect(out).toBe(`${STATE_ICON.working} nt · working [main]`);
  });

  it("renders an empty branch cleanly", () => {
    const out = formatTitle("{name} [{branch}]", {
      name: "nt",
      state: "idle",
      icon: STATE_ICON.idle,
      cwd: "/x",
      branch: null,
    });
    expect(out).toBe("nt []");
  });

  it("neutralizes escape sequences injected via the session name", () => {
    const out = formatTitle("{name}", {
      name: `evil${ESC}]0;pwned${BEL}`,
      state: "idle",
      icon: "",
      cwd: "/x",
      branch: null,
    });
    expect(out).toBe("evil");
  });
});

describe("buildTitleEscape", () => {
  it("emits OSC 0 and OSC 2", () => {
    const esc = buildTitleEscape("hello");
    expect(esc).toBe(`${ESC}]0;hello${BEL}${ESC}]2;hello${BEL}`);
  });
});
