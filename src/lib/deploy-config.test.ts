import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Guards the SPA fallback in vercel.json.
 *
 * The hosted dashboard (bertrand.sh) rewrites unmatched paths to /index.html so
 * client-side routes deep-link. That catch-all must **not** cover /sw.js.
 *
 * Why: builds before b38da01 shipped a vite-plugin-pwa service worker. A
 * registered worker outlives the plugin that installed it, and it intercepts
 * fetches — serving stale or empty assets, which renders as a mangled UI (the
 * embedded terminal worst of all, since xterm depends on its stylesheet to
 * position cells). Browsers retire such a worker on their own when its script
 * 404s. But a catch-all rewrite answers /sw.js with index.html — HTTP 200,
 * content-type text/html — and a worker script served as non-JavaScript is a
 * hard update failure, not a de-registration. The zombie then survives
 * indefinitely, and only that browser's owner can clear it by hand.
 *
 * So the 404 is load-bearing: it is the sole remote remedy for a client we
 * cannot otherwise reach. Broadening this pattern back to "/(.*)" silently
 * resurrects the bug, hence this test.
 *
 * vercel.json is strict JSON and cannot carry a comment, which is why the
 * reasoning lives here.
 */

interface Rewrite {
  source: string;
  destination: string;
}

const config = JSON.parse(
  readFileSync(join(import.meta.dir, "../../vercel.json"), "utf8"),
) as { rewrites?: Rewrite[] };

/**
 * Approximates how Vercel compiles a `source` pattern. Not path-to-regexp, but
 * faithful enough to catch a catch-all that swallows the paths below.
 */
function matches(source: string, path: string): boolean {
  return new RegExp(`^${source}$`).test(path);
}

describe("vercel.json SPA fallback", () => {
  const fallback = config.rewrites?.find((r) => r.destination === "/index.html");

  test("exists", () => {
    expect(fallback).toBeDefined();
  });

  // A rewrite here means the browser gets index.html (200, text/html) instead of
  // a 404, which keeps a stale service worker alive forever. See the note above.
  test.each(["/sw.js", "/manifest.webmanifest"])(
    "does not swallow %s, so a stale service worker 404s and self-retires",
    (path) => {
      expect(matches(fallback!.source, path)).toBe(false);
    },
  );

  test.each(["/", "/sessions/abc123", "/dev/terminal", "/settings/projects"])(
    "still serves the app at %s",
    (path) => {
      expect(matches(fallback!.source, path)).toBe(true);
    },
  );
});
