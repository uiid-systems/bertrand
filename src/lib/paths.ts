import { homedir } from "os";
import { join } from "path";

const BERTRAND_DIR = ".bertrand";

export const paths = {
  root: join(homedir(), BERTRAND_DIR),
  db: join(homedir(), BERTRAND_DIR, "bertrand.db"),
  hooks: join(homedir(), BERTRAND_DIR, "hooks"),
  sessions: join(homedir(), BERTRAND_DIR, "sessions"),
} as const;
