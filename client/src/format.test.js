import { describe, expect, it } from "vitest";
import { initials, roleLabel, timeAgo, validateUpload } from "./format.js";

describe("validateUpload", () => {
  it("accepts supported types case-insensitively", () => {
    expect(validateUpload({ name: "Notes.MD", size: 10 })).toBeNull();
    expect(validateUpload({ name: "a.docx", size: 10 })).toBeNull();
    expect(validateUpload({ name: "a.txt", size: 10 })).toBeNull();
  });

  it("rejects unsupported, oversized and empty files with a helpful message", () => {
    expect(validateUpload({ name: "a.pdf", size: 10 })).toMatch(/Unsupported file type ".pdf"/);
    expect(validateUpload({ name: "noext", size: 10 })).toMatch(/Unsupported/);
    expect(validateUpload({ name: "a.txt", size: 6 * 1024 * 1024 })).toMatch(/too large/);
    expect(validateUpload({ name: "a.txt", size: 0 })).toMatch(/empty/);
  });
});

describe("timeAgo", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  it("formats recent times compactly", () => {
    expect(timeAgo(now - 5_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });
  it("never goes negative when clocks drift", () => {
    expect(timeAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("labels", () => {
  it("maps roles and initials", () => {
    expect(roleLabel("viewer")).toBe("Can view");
    expect(roleLabel("owner")).toBe("Owner");
    expect(initials("Alice Anderson")).toBe("AA");
    expect(initials("")).toBe("");
  });
});
