import { describe, test, expect } from "bun:test";
import {
  formatIdentity,
  isTrustedHost,
  normalizeEnterpriseHost,
  parseGitHubRemote,
  type ProviderIdentity,
} from "./identity";

const github = (owner: string, repo: string, host?: string): ProviderIdentity =>
  host ? { provider: "github", owner, repo, host } : { provider: "github", owner, repo };

describe("parseGitHubRemote", () => {
  const parses: [label: string, remote: string, expected: ProviderIdentity][] = [
    ["https with .git", "https://github.com/o/r.git", github("o", "r")],
    ["https without .git", "https://github.com/o/r", github("o", "r")],
    ["scp-style ssh", "git@github.com:o/r.git", github("o", "r")],
    ["scp-style ssh without .git", "git@github.com:o/r", github("o", "r")],
    ["ssh:// url", "ssh://git@github.com/o/r.git", github("o", "r")],
    ["git+ssh:// url", "git+ssh://git@github.com/o/r.git", github("o", "r")],
    ["git:// url", "git://github.com/o/r.git", github("o", "r")],
    ["http url", "http://github.com/o/r.git", github("o", "r")],

    ["trailing slash", "https://github.com/o/r/", github("o", "r")],
    ["trailing slash after .git", "https://github.com/o/r.git/", github("o", "r")],
    ["surrounding whitespace", "  https://github.com/o/r.git\n", github("o", "r")],
    ["uppercase .GIT suffix", "https://github.com/o/r.GIT", github("o", "r")],
    ["mixed-case host", "https://GitHub.com/o/r.git", github("o", "r")],
    ["credentials in url", "https://user:token@github.com/o/r.git", github("o", "r")],
    ["www alias", "https://www.github.com/o/r.git", github("o", "r")],
    ["ssh-over-https alias", "ssh://git@ssh.github.com:443/o/r.git", github("o", "r")],
    ["dots in repo name", "https://github.com/o/my.repo.js.git", github("o", "my.repo.js")],
  ];

  for (const [label, remote, expected] of parses) {
    test(`parses ${label}: ${remote}`, () => {
      expect(parseGitHubRemote(remote)).toEqual(expected);
    });
  }

  // The remotes the migration actually has to bind.
  const realRemotes: [remote: string, expected: ProviderIdentity][] = [
    ["https://github.com/uiid-systems/bertrand.git", github("uiid-systems", "bertrand")],
    ["https://github.com/uiid-systems/design-system.git", github("uiid-systems", "design-system")],
    // No .git suffix on disk — the case that would break a naive slice(-4).
    ["https://github.com/adamfratino/shuff-app", github("adamfratino", "shuff-app")],
  ];

  for (const [remote, expected] of realRemotes) {
    test(`parses remote in use today: ${remote}`, () => {
      expect(parseGitHubRemote(remote)).toEqual(expected);
    });
  }

  const rejects: [label: string, remote: string][] = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["not a url", "not-a-remote"],
    ["unsupported protocol", "file:///Users/me/repo.git"],
    ["windows path", "C:/Users/me/repo"],

    // Non-GitHub forges must not yield a bogus GitHub identity.
    ["gitlab.com", "https://gitlab.com/o/r.git"],
    ["gitlab scp", "git@gitlab.com:o/r.git"],
    ["bitbucket.org", "https://bitbucket.org/o/r.git"],
    ["self-hosted gitlab", "https://git.acme.com/o/r.git"],
    ["azure devops", "git@ssh.dev.azure.com:v3/o/p/r"],

    // github.com hostnames that never serve a clonable repo remote.
    ["gist", "https://gist.github.com/o/r.git"],
    ["api", "https://api.github.com/repos/o/r"],

    // Hosts that read as GitHub but are not. Every one of these parsed under
    // the old label heuristic; with nothing declared, only github.com does.
    ["github.com as a prefix", "https://github.com.evil.com/o/r.git"],
    ["github as a subdomain", "https://github.evil.com/o/r.git"],
    ["ghe as a subdomain", "https://ghe.evil.com/o/r.git"],
    ["undeclared enterprise host", "https://github.acme.com/o/r.git"],
    ["undeclared enterprise host over scp", "git@github.acme.com:o/r.git"],

    ["owner only", "https://github.com/o"],
    ["deeper than owner/repo", "https://github.com/o/r/tree/main"],
    ["root path", "https://github.com/"],
    ["empty owner", "https://github.com//r.git"],
    ["empty repo", "https://github.com/o/.git"],
  ];

  for (const [label, remote] of rejects) {
    test(`returns null for ${label}: ${JSON.stringify(remote)}`, () => {
      expect(parseGitHubRemote(remote)).toBeNull();
    });
  }

  test("omits host for github.com so the registry stays compact", () => {
    const identity = parseGitHubRemote("https://github.com/o/r.git");
    expect(identity).not.toBeNull();
    expect(identity!.host).toBeUndefined();
  });

  test("every remote form for one repo yields the same identity", () => {
    const forms = [
      "https://github.com/uiid-systems/bertrand.git",
      "https://github.com/uiid-systems/bertrand",
      "git@github.com:uiid-systems/bertrand.git",
      "ssh://git@github.com/uiid-systems/bertrand.git",
    ];
    for (const form of forms) {
      expect(parseGitHubRemote(form)).toEqual(github("uiid-systems", "bertrand"));
    }
  });
});

describe("parseGitHubRemote with declared enterprise hosts", () => {
  const ACME = { enterpriseHosts: ["github.acme.com"] };

  // The host is what tells `gh` where to talk, so a declared one is captured.
  const parses: [label: string, remote: string, expected: ProviderIdentity][] = [
    ["https", "https://github.acme.com/o/r.git", github("o", "r", "github.acme.com")],
    ["scp", "git@github.acme.com:o/r.git", github("o", "r", "github.acme.com")],
    ["mixed case", "https://GitHub.Acme.com/o/r.git", github("o", "r", "github.acme.com")],
    ["trailing dot", "https://github.acme.com./o/r.git", github("o", "r", "github.acme.com")],
    // An ssh port is transport-only, so it never reaches the declared host.
    ["ssh port", "ssh://git@github.acme.com:2222/o/r.git", github("o", "r", "github.acme.com")],
  ];

  for (const [label, remote, expected] of parses) {
    test(`parses ${label}: ${remote}`, () => {
      expect(parseGitHubRemote(remote, ACME)).toEqual(expected);
    });
  }

  test("a bare label is a legitimate intranet host", () => {
    expect(parseGitHubRemote("git@ghe:o/r.git", { enterpriseHosts: ["ghe"] })).toEqual(
      github("o", "r", "ghe"),
    );
  });

  test("any hostname can be declared, not just github-flavored ones", () => {
    expect(parseGitHubRemote("https://git.acme.com/o/r.git", { enterpriseHosts: ["git.acme.com"] })).toEqual(
      github("o", "r", "git.acme.com"),
    );
  });

  test("declaring one host does not trust its neighbors", () => {
    expect(parseGitHubRemote("https://github.acme.co/o/r.git", ACME)).toBeNull();
    expect(parseGitHubRemote("https://evil.github.acme.com/o/r.git", ACME)).toBeNull();
    expect(parseGitHubRemote("https://github.acme.com.evil.com/o/r.git", ACME)).toBeNull();
  });

  // A port addresses a different service on the same machine, and the whole
  // point of the allowlist is that what we dial was named on purpose.
  test("an http port must be declared with the host", () => {
    expect(parseGitHubRemote("https://github.acme.com:8443/o/r.git", ACME)).toBeNull();
    expect(
      parseGitHubRemote("https://github.acme.com:8443/o/r.git", {
        enterpriseHosts: ["github.acme.com:8443"],
      }),
    ).toEqual(github("o", "r", "github.acme.com:8443"));
  });

  // The probe from ELKY-158, which is the reason any of this exists.
  const lookalikes = [
    "https://github.com.evil.com/acme/web.git",
    "https://github.evil.com/acme/web.git",
    "https://ghe.evil.com/acme/web.git",
  ];

  for (const remote of lookalikes) {
    test(`rejects lookalike even when declared: ${remote}`, () => {
      // `github.evil.com` is only reachable by declaring it, which is a choice
      // a user can make; `github.com.evil.com` is refused outright.
      expect(parseGitHubRemote(remote)).toBeNull();
      expect(parseGitHubRemote(remote, { enterpriseHosts: ["github.com.evil.com"] })).toBeNull();
    });
  }

  test("github.com itself never needs declaring and never changes meaning", () => {
    expect(parseGitHubRemote("https://github.com/o/r.git", ACME)).toEqual(github("o", "r"));
    expect(
      parseGitHubRemote("https://github.com/o/r.git", { enterpriseHosts: ["github.com"] }),
    ).toEqual(github("o", "r"));
    // Declaring a github.com subdomain does not make it a repo remote.
    expect(
      parseGitHubRemote("https://gist.github.com/o/r.git", {
        enterpriseHosts: ["gist.github.com"],
      }),
    ).toBeNull();
  });

  test("unusable entries are ignored rather than trusted", () => {
    const junk = { enterpriseHosts: ["", "   ", "not a host", "github.acme.com:notaport"] };
    expect(parseGitHubRemote("https://github.acme.com/o/r.git", junk)).toBeNull();
    expect(parseGitHubRemote("https://github.com/o/r.git", junk)).toEqual(github("o", "r"));
  });
});

describe("normalizeEnterpriseHost", () => {
  const normalizes: [raw: string, expected: string][] = [
    ["github.acme.com", "github.acme.com"],
    ["  GitHub.Acme.com  ", "github.acme.com"],
    ["github.acme.com.", "github.acme.com"],
    ["https://github.acme.com", "github.acme.com"],
    ["https://github.acme.com/", "github.acme.com"],
    ["https://github.acme.com/o/r.git", "github.acme.com"],
    ["ssh://git@github.acme.com", "github.acme.com"],
    ["github.acme.com:8443", "github.acme.com:8443"],
    ["https://github.acme.com:8443/", "github.acme.com:8443"],
    ["ghe", "ghe"],
    ["10.0.0.5:8443", "10.0.0.5:8443"],
  ];

  for (const [raw, expected] of normalizes) {
    test(`normalizes ${JSON.stringify(raw)} to ${expected}`, () => {
      expect(normalizeEnterpriseHost(raw)).toBe(expected);
    });
  }

  const rejects: [label: string, raw: string][] = [
    ["empty", ""],
    ["whitespace", "   "],
    ["spaces in host", "not a host"],
    ["non-numeric port", "github.acme.com:notaport"],
    ["empty port", "github.acme.com:"],
    ["underscore", "git_hub.acme.com"],
    // github.com is built in; declaring it is redundant at best.
    ["github.com", "github.com"],
    ["github.com subdomain", "gist.github.com"],
    // The shape no configuration may trust.
    ["github.com as a prefix", "github.com.evil.com"],
    ["github.com prefix with port", "github.com.evil.com:8443"],
  ];

  for (const [label, raw] of rejects) {
    test(`rejects ${label}: ${JSON.stringify(raw)}`, () => {
      expect(normalizeEnterpriseHost(raw)).toBeNull();
    });
  }
});

describe("isTrustedHost", () => {
  test("an absent host is github.com, which is always trusted", () => {
    expect(isTrustedHost(undefined)).toBe(true);
    expect(isTrustedHost(undefined, [])).toBe(true);
  });

  test("a declared host is trusted, in whatever case it was stored", () => {
    expect(isTrustedHost("github.acme.com", ["github.acme.com"])).toBe(true);
    expect(isTrustedHost("GitHub.Acme.com", ["github.acme.com"])).toBe(true);
    expect(isTrustedHost("github.acme.com:8443", ["github.acme.com:8443"])).toBe(true);
  });

  // The case this predicate exists for: a binding written under the old rules.
  test("a stored host nobody declared is not trusted", () => {
    expect(isTrustedHost("github.acme.com")).toBe(false);
    expect(isTrustedHost("github.acme.com", ["github.other.com"])).toBe(false);
    expect(isTrustedHost("github.acme.com:8443", ["github.acme.com"])).toBe(false);
    expect(isTrustedHost("github.com.evil.com", ["github.com.evil.com"])).toBe(false);
  });
});

describe("formatIdentity", () => {
  test("owner/repo on github.com", () => {
    expect(formatIdentity(github("uiid-systems", "bertrand"))).toBe("uiid-systems/bertrand");
  });

  test("host-prefixed on enterprise", () => {
    expect(formatIdentity(github("o", "r", "github.acme.com"))).toBe("github.acme.com/o/r");
  });
});
