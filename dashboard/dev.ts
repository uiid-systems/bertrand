import { spawn } from "bun"
import { readFileSync, unlinkSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const PID_FILE = join(homedir(), ".bertrand", "server.pid")

// Auto-start (src/lib/server-lifecycle.ts) may have spawned a `bertrand serve`
// before we got here. Its PID lives in ~/.bertrand/server.pid — that file is
// the "we spawned this" contract, so it's safe to terminate. A manually-run
// server has no PID file and will surface as EADDRINUSE, which is what we want.
async function stopAutoStartedServer(): Promise<void> {
  let pid: number
  try {
    pid = Number(readFileSync(PID_FILE, "utf-8").trim())
  } catch {
    return
  }
  if (!Number.isFinite(pid) || pid <= 0) {
    try { unlinkSync(PID_FILE) } catch {}
    return
  }

  try {
    process.kill(pid, "SIGTERM")
  } catch {
    try { unlinkSync(PID_FILE) } catch {}
    return
  }

  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  try { unlinkSync(PID_FILE) } catch {}
}

await stopAutoStartedServer()

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
