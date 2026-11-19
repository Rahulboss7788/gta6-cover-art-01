// Vice Cover Studio — hand-in program for the gta6-cover-art-01 bounty.
// Node 22, standard library only. It gathers the finished entry — the
// static app in app/ and the screenshots in screenshots/ — into the output
// directory, then writes the dossier the judge reads, using the vendored
// make.fun library in vendor/makefun-app.ts (unchanged from the kit).
//
// Local check (the grader uses /output instead):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Run it twice: both runs must produce byte-identical output.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-app.ts";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

function countTree(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files += countTree(full);
    else if (entry.isFile()) files += 1;
  }
  return files;
}

function totalBytes(dir) {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) bytes += totalBytes(full);
    else if (entry.isFile()) bytes += statSync(full).size;
  }
  return bytes;
}

const appDir = join(repoRoot, "app");
const shotsDir = join(repoRoot, "screenshots");
if (!existsSync(join(appDir, "index.html"))) {
  throw new Error("app/index.html is missing — nothing to hand in");
}

mkdirSync(outputDir, { recursive: true });
cpSync(appDir, join(outputDir, "app"), { recursive: true });
mkdirSync(join(outputDir, "screenshots"), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outputDir, "screenshots"), { recursive: true });
}

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, "dossier.json"), dossier);

const appFiles = countTree(join(outputDir, "app"));
const appSize = totalBytes(join(outputDir, "app"));
const shotFiles = existsSync(join(outputDir, "screenshots"))
  ? readdirSync(join(outputDir, "screenshots")).length
  : 0;
console.log(`handed in: app/ ${appFiles} files, ${appSize} bytes; screenshots/ ${shotFiles} files`);
console.log(`dossier.json: ${dossier.length} bytes -> ${join(outputDir, "dossier.json")}`);
