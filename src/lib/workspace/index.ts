/**
 * Workspace preview layer (docs/workspaces.md, Phase 1). This barrel exposes
 * the resolution + env-contract surface; 1B's dev-server process manager and
 * 1C's reverse proxy build on top of it.
 */
export type {
  PackageManager,
  RepoWorkspaceConfig,
  WorkspaceRunConfig,
  WorkspaceScripts,
} from "./types";
export {
  detectPackageManager,
  installCommand,
  readPackageJson,
  runScriptCommand,
} from "./detect";
export { readRepoWorkspaceConfig } from "./config";
export { resolveWorkspace } from "./resolve";
export {
  localhostPreviewUrl,
  workspaceEnv,
  type WorkspaceEnvInput,
} from "./env";
export { allocatePort, getPort, releasePort, prunePorts } from "./port";
export {
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServer,
  type WorkspaceServerStatus,
  type StartWorkspaceInput,
} from "./server";
