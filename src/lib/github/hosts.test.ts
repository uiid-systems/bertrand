import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { _setRootDir, _getRootDir } from "@/lib/paths";
import { isDeclaredHost, readEnterpriseHosts, _setEnterpriseHosts } from "./hosts";

let tmpRoot: string;
const originalDir = _getRootDir();

/** `config.json` lives under the registry dir, so pointing it at a temp root
 * keeps these tests off the developer's real ~/.bertrand/config.json. */
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-gh-hosts-"));
  _setRootDir(tmpRoot);
  _setEnterpriseHosts(null);
});

afterEach(() => {
  _setRootDir(originalDir);
  _setEnterpriseHosts(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeConfigFile(config: unknown): void {
  writeFileSync(join(tmpRoot, "config.json"), JSON.stringify(config));
}

describe("readEnterpriseHosts", () => {
  test("declares nothing when there is no config file", () => {
    expect(readEnterpriseHosts()).toEqual([]);
  });

  test("declares nothing when the key is absent", () => {
    writeConfigFile({ bin: "/usr/local/bin/bertrand", version: 1 });

    expect(readEnterpriseHosts()).toEqual([]);
  });

  test("reads declared hosts", () => {
    writeConfigFile({ github: { enterpriseHosts: ["github.acme.com", "ghe.acme.io"] } });

    expect(readEnterpriseHosts()).toEqual(["github.acme.com", "ghe.acme.io"]);
  });

  // This file is hand-edited by definition — there is no command that writes
  // it — so a wrong shape has to be survivable rather than throw on a path
  // every project list goes through.
  test("survives a key that is not an array", () => {
    writeConfigFile({ github: { enterpriseHosts: "github.acme.com" } });

    expect(readEnterpriseHosts()).toEqual([]);
  });

  test("drops non-string entries and keeps the rest", () => {
    writeConfigFile({ github: { enterpriseHosts: ["github.acme.com", 42, null, {}] } });

    expect(readEnterpriseHosts()).toEqual(["github.acme.com"]);
  });

  test("survives unparseable json", () => {
    writeFileSync(join(tmpRoot, "config.json"), "{ not json");

    expect(readEnterpriseHosts()).toEqual([]);
  });
});

describe("isDeclaredHost", () => {
  test("an unbound-host identity is github.com, which needs no declaration", () => {
    expect(isDeclaredHost(undefined)).toBe(true);
  });

  test("an undeclared host is not trusted", () => {
    expect(isDeclaredHost("github.acme.com")).toBe(false);
  });

  test("a declared host is trusted", () => {
    writeConfigFile({ github: { enterpriseHosts: ["github.acme.com"] } });

    expect(isDeclaredHost("github.acme.com")).toBe(true);
  });

  test("no configuration can make a github.com lookalike trusted", () => {
    writeConfigFile({ github: { enterpriseHosts: ["github.com.evil.com"] } });

    expect(isDeclaredHost("github.com.evil.com")).toBe(false);
  });
});

describe("_setEnterpriseHosts", () => {
  test("overrides the config file, and null restores it", () => {
    writeConfigFile({ github: { enterpriseHosts: ["github.acme.com"] } });

    _setEnterpriseHosts(["github.other.com"]);
    expect(readEnterpriseHosts()).toEqual(["github.other.com"]);

    // An empty override still overrides — it is how a test declares nothing.
    _setEnterpriseHosts([]);
    expect(readEnterpriseHosts()).toEqual([]);

    _setEnterpriseHosts(null);
    expect(readEnterpriseHosts()).toEqual(["github.acme.com"]);
  });
});
