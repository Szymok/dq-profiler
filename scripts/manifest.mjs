// Writes dist/VERSION: the release tag/version, the source commit and a SHA-256 for every built file.
// A site that hosts a copy of dist/ can then prove which build it serves and detect any later alteration.
// Run via `npm run release` (build + manifest). Uses only Node's standard library.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const OUTPUT = join(DIST, "VERSION");

const git = (args) => {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

function files(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const commit = git("rev-parse HEAD");
const dirty = git("status --porcelain").length > 0;
const tag = git("describe --tags --exact-match HEAD");

const lines = files(DIST)
  .filter((f) => f !== OUTPUT)
  .map((f) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}  ${relative(DIST, f).split("\\").join("/")}`);

const header = [
  `name: ${pkg.name}`,
  `version: ${pkg.version}`,
  `tag: ${tag || "(none)"}`,
  `commit: ${commit || "(unknown)"}`,
  `working-tree: ${dirty ? "DIRTY (uncommitted changes, do not publish)" : "clean"}`,
  "sha256:",
];

writeFileSync(OUTPUT, `${header.join("\n")}\n${lines.join("\n")}\n`);
console.log(`Wrote ${OUTPUT} (${lines.length} files, ${dirty ? "DIRTY working tree" : "clean working tree"})`);
if (dirty) console.warn("Warning: the working tree has uncommitted changes. Commit before publishing this build.");
