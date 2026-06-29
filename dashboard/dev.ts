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

// Hand the dashboard back to bertrand on the way out. Without this, stopping
// the dev server (Ctrl+C, or either child dying) leaves a live bertrand
// session with no server on :5200, since auto-start deferred to us on launch
// and never wrote a PID file. `ensure-server` re-owns the port — but only if a
// session still needs it, so quitting `bun dev` with nothing running stays a
// clean no-op.
let shuttingDown = false
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  api.kill()
  vite.kill()

  // Wait for the API child to release :5200 before handing off, so the
  // recovery probe sees a free port and actually spawns a replacement.
  await api.exited.catch(() => {})

  try {
    const heal = spawn(["bun", "run", "../src/index.ts", "ensure-server"], {
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    })
    await heal.exited
  } catch {
    // best-effort handoff — never block exit on it
  }

  process.exit(0)
}

process.on("SIGINT", () => void shutdown())

await Promise.race([api.exited, vite.exited])
await shutdown()
