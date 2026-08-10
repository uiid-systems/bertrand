/**
 * Pure data shapes for the GitHub layer.
 *
 * A leaf on purpose: this module imports nothing, so anything that needs only
 * the *shape* of a repo identity can reach it without dragging in the parser
 * (`identity.ts`) or anything below it. `src/types.ts` — the barrel the
 * dashboard's TypeScript program reads — depends on this file transitively,
 * and its build must never end up resolving `fs`/`os`/`path` to typecheck a
 * type it erases. Keep this module import-free.
 */

/**
 * Portable identity of a GitHub repository. Portable is the point: bertrand
 * syncs projects across machines, where `owner/repo` travels and a checkout
 * path does not.
 */
export interface ProviderIdentity {
  /** Discriminant; other forges would be additive. */
  provider: "github";
  owner: string;
  repo: string;
  /** Undefined means github.com. Set only for GitHub Enterprise Server. */
  host?: string;
}
