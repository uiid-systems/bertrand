/**
 * Build script for bertrand npm package.
 *
 * Produces:
 *   dist/bertrand.js     — main CLI bundle (shebang, chmod +x; npm `bin` target)
 *   dist/run-screen.js   — TUI subprocess entry (spawned by app.tsx)
 *   dist/migrations/     — Drizzle SQL migrations, copied (loaded at runtime
 *                          via `import.meta.dir + "/migrations"`)
 */
import { rmSync, mkdirSync, cpSync, chmodSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir;
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

async function build(label: string, opts: Parameters<typeof Bun.build>[0]) {
  const result = await Bun.build(opts);
  if (!result.success) {
    console.error(`${label} build failed:`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

console.log("Building main CLI…");
await build("main", {
  entrypoints: [join(SRC, "index.ts")],
  outdir: DIST,
  naming: "bertrand.js",
  target: "bun",
  banner: "#!/usr/bin/env bun",
});
chmodSync(join(DIST, "bertrand.js"), 0o755);

console.log("Building TUI subprocess…");
await build("tui", {
  entrypoints: [join(SRC, "tui/run-screen.tsx")],
  outdir: DIST,
  naming: "run-screen.js",
  target: "bun",
});

console.log("Copying migrations…");
cpSync(join(SRC, "db/migrations"), join(DIST, "migrations"), {
  recursive: true,
});

console.log(`\nBuilt to ${DIST}`);
