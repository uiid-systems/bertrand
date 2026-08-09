import { describe, test, expect } from "bun:test";
import { formatIdentity, parseGitHubRemote, type ProviderIdentity } from "./identity";

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

    // Enterprise: the host is what tells `gh` where to talk, so it is captured.
    ["enterprise host", "https://github.acme.com/o/r.git", github("o", "r", "github.acme.com")],
    ["enterprise scp", "git@github.acme.com:o/r.git", github("o", "r", "github.acme.com")],
    ["enterprise ghe label", "https://ghe.acme.io/o/r.git", github("o", "r", "ghe.acme.io")],
    [
      "enterprise http port is part of identity",
      "https://github.acme.com:8443/o/r.git",
      github("o", "r", "github.acme.com:8443"),
    ],
    [
      "enterprise ssh port is transport-only",
      "ssh://git@github.acme.com:2222/o/r.git",
      github("o", "r", "github.acme.com"),
    ],
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

describe("formatIdentity", () => {
  test("owner/repo on github.com", () => {
    expect(formatIdentity(github("uiid-systems", "bertrand"))).toBe("uiid-systems/bertrand");
  });

  test("host-prefixed on enterprise", () => {
    expect(formatIdentity(github("o", "r", "github.acme.com"))).toBe("github.acme.com/o/r");
  });
});
