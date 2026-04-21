import { spawn } from "bun"

const api = spawn(["bun", "run", "../src/index.ts", "serve"], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
})

const vite = spawn(["bunx", "vite"], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
})

process.on("SIGINT", () => {
  api.kill()
  vite.kill()
  process.exit(0)
})

await Promise.race([api.exited, vite.exited])
api.kill()
vite.kill()
