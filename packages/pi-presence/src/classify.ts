// ---------------------------------------------------------------------------
// Heuristic classifier for "dangerous" shell commands, used by the optional
// permission-gate to decide when to raise a blocked (needs-you) prompt.
//
// This is a convenience net, NOT a security boundary — pi's own approval flow
// remains the authority. Patterns are intentionally conservative to limit false
// positives while catching the classic footguns.
// ---------------------------------------------------------------------------

export interface CommandRisk {
  dangerous: boolean;
  /** Short human label describing why (empty when not dangerous). */
  label: string;
}

interface Rule {
  re: RegExp;
  label: string;
}

const RULES: Rule[] = [
  {
    re: /\brm\s+(?:-[a-z]*\s+)*-[a-z]*r[a-z]*f|\brm\s+(?:-[a-z]*\s+)*-[a-z]*f[a-z]*r/i,
    label: "Recursive force delete",
  },
  { re: /\brm\s+-r\b.*\s(?:\/|~|\$HOME)\b/i, label: "Recursive delete of a broad path" },
  { re: /\bsudo\b/i, label: "Run with elevated privileges" },
  { re: /\bgit\s+push\b.*(?:--force\b|--force-with-lease\b|\s-f\b)/i, label: "Force push" },
  { re: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/i, label: "Discard git changes" },
  { re: /\bdd\b.*\bof=/i, label: "Raw disk write (dd)" },
  { re: /\bmkfs\b|\bmke2fs\b/i, label: "Format a filesystem" },
  { re: /\b(?:shred|wipe)\b/i, label: "Securely erase data" },
  {
    re: /\b(?:chmod|chown)\s+-[a-z]*R[a-z]*\s+.*\s(?:\/|~)\b/i,
    label: "Recursive permission change on a broad path",
  },
  {
    re: /(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
    label: "Pipe a download into a shell",
  },
  { re: />\s*\/dev\/(?:sd|nvme|disk)/i, label: "Write to a raw device" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, label: "Fork bomb" },
  { re: /\bkill\s+-9\s+-1\b|\bkillall\b/i, label: "Kill many processes" },
];

/** Classify a shell command's risk. */
export function classifyCommand(command: string): CommandRisk {
  const cmd = command ?? "";
  for (const rule of RULES) {
    if (rule.re.test(cmd)) return { dangerous: true, label: rule.label };
  }
  return { dangerous: false, label: "" };
}
