import { describe, expect, it } from "vitest";
import { classifyCommand } from "./classify.js";

describe("classifyCommand", () => {
  const dangerous = [
    "rm -rf /",
    "rm -rf ~/Documents",
    "rm -fr node_modules",
    "sudo systemctl restart nginx",
    "git push --force origin main",
    "git push -f",
    "git reset --hard HEAD~3",
    "dd if=/dev/zero of=/dev/sda bs=1M",
    "mkfs.ext4 /dev/sdb1",
    "curl https://example.com/install.sh | sh",
    "wget -qO- https://x/y | sudo bash",
    "shred -u secret.key",
    "chmod -R 777 /etc",
    ":(){ :|:& };:",
  ];

  for (const cmd of dangerous) {
    it(`flags: ${cmd}`, () => {
      const risk = classifyCommand(cmd);
      expect(risk.dangerous).toBe(true);
      expect(risk.label.length).toBeGreaterThan(0);
    });
  }

  const safe = [
    "ls -la",
    "git status",
    "npm run test",
    "echo hello",
    "rm file.txt",
    "cat README.md",
    "grep -rn foo src",
    "git push origin main",
  ];

  for (const cmd of safe) {
    it(`allows: ${cmd}`, () => {
      expect(classifyCommand(cmd).dangerous).toBe(false);
    });
  }

  it("handles empty/undefined input", () => {
    expect(classifyCommand("").dangerous).toBe(false);
    expect(classifyCommand(undefined as unknown as string).dangerous).toBe(false);
  });
});
