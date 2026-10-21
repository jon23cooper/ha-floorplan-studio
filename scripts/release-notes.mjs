// The GitHub release notes for a version: its section of CHANGELOG.md, so HACS's update dialog shows the curated entry and
// not a commit list. Used by .github/workflows/release.yml:
//   node scripts/release-notes.mjs v1.2.3 > notes.md   (exit 1, nothing written, when the version has no section)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The body of the `## <version> - <date>` section, or null when there is none or it is empty. */
export function notesFor(changelog, version) {
  const want = version.replace(/^v/, "");
  if (!/^\d/.test(want)) return null; // "Unreleased" is a heading, not a release
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => /^## /.test(l) && l.slice(3).trim().split(/\s+/)[0] === want);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body ? `${body}\n` : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const notes = version ? notesFor(readFileSync("CHANGELOG.md", "utf8"), version) : null;
  if (notes === null) {
    console.error(`No section for ${version ?? "(no version given)"} in CHANGELOG.md; the release falls back to generated notes.`);
    process.exit(1);
  }
  process.stdout.write(notes);
}
