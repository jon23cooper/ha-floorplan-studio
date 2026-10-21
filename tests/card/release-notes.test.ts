import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { notesFor } from "../../scripts/release-notes.mjs";

// G17: the release notes HACS shows are the CHANGELOG entry of the version, not a commit list.
const LOG = `# Changelog

## Unreleased

- Not out yet.

## 0.33.3 - 2026-10-20

- First bullet.
- Second bullet, with \`code\`.

## 0.33.2 - 2026-10-19

- Older.
`;

describe("notesFor", () => {
  it("returns the bullets of the version's section, without its heading or the next section", () => {
    expect(notesFor(LOG, "0.33.3")).toBe("- First bullet.\n- Second bullet, with `code`.\n");
  });

  it("accepts a leading v, as the tag has it", () => {
    expect(notesFor(LOG, "v0.33.2")).toBe("- Older.\n");
  });

  it("is null when the version has no section, so the workflow can fall back", () => {
    expect(notesFor(LOG, "0.33.4")).toBeNull();
    expect(notesFor(LOG, "0.33")).toBeNull(); // a prefix is not the version
    expect(notesFor(LOG, "Unreleased")).toBeNull();
  });

  it("is null for an empty section", () => {
    expect(notesFor("## 1.0.0 - 2026-01-01\n\n## 0.9.0 - 2025-01-01\n- x\n", "1.0.0")).toBeNull();
  });

  it("finds the section of the repo's own CHANGELOG for the manifest version or says so", () => {
    const v = (JSON.parse(readFileSync("custom_components/floorplan_studio/manifest.json", "utf8")) as { version: string }).version;
    const notes = notesFor(readFileSync("CHANGELOG.md", "utf8"), v);
    expect(notes === null || notes.startsWith("- ")).toBe(true);
  });
});
