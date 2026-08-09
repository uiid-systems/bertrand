import { readConfig } from "@/lib/config";
import { isTrustedHost } from "./identity";

let override: string[] | null = null;

/**
 * Hosts this machine trusts to serve GitHub Enterprise Server, read from
 * `github.enterpriseHosts` in ~/.bertrand/config.json.
 *
 * Machine-local on purpose. Which internal host is really GHES is a fact about
 * where bertrand is running, not about a project, so it does not belong in the
 * registry that `bertrand sync` carries between machines — a synced allowlist
 * would let one machine's config decide what another machine dials.
 *
 * Entries are returned as written. {@link import("./identity").parseGitHubRemote}
 * owns what a host string means, including which entries are unusable, so this
 * stays plumbing.
 */
export function readEnterpriseHosts(): string[] {
  if (override) {
    return override;
  }

  const configured = readConfig()?.github?.enterpriseHosts;

  return Array.isArray(configured)
    ? configured.filter((host): host is string => typeof host === "string")
    : [];
}

/**
 * Whether a stored identity's host is one this machine declares — the form
 * every display surface wants.
 *
 * A false here does not mean the binding is fake; it means bertrand can no
 * longer vouch for the host, which is worth a mark next to a repo name that
 * may have been chosen to be misread.
 */
export function isDeclaredHost(host: string | undefined): boolean {
  return isTrustedHost(host, readEnterpriseHosts());
}

/** Swap the configured hosts, so parsing is testable without a config file. */
export function _setEnterpriseHosts(hosts: string[] | null): void {
  override = hosts;
}
