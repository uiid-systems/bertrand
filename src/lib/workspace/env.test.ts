import { describe, test, expect } from "bun:test";
import { workspaceEnv, localhostPreviewUrl } from "@/lib/workspace/env";

describe("workspaceEnv", () => {
  const base = {
    port: 4300,
    slug: "my-feature",
    root: "/repo",
    previewUrl: "http://localhost:4300",
  };

  test("sets the documented contract vars", () => {
    const env = workspaceEnv(base);
    expect(env.BERTRAND_PORT).toBe("4300");
    expect(env.BERTRAND_WORKSPACE).toBe("my-feature");
    expect(env.BERTRAND_ROOT).toBe("/repo");
    expect(env.BERTRAND_PREVIEW_URL).toBe("http://localhost:4300");
    // best-effort zero-config for servers that honor PORT
    expect(env.PORT).toBe("4300");
  });

  test("emits a base..base+9 reserved block by default", () => {
    const env = workspaceEnv(base);
    expect(env.BERTRAND_PORT_0).toBe("4300");
    expect(env.BERTRAND_PORT_9).toBe("4309");
    expect(env.BERTRAND_PORT_10).toBeUndefined();
  });

  test("honors a custom block size", () => {
    const env = workspaceEnv({ ...base, portBlockSize: 2 });
    expect(env.BERTRAND_PORT_0).toBe("4300");
    expect(env.BERTRAND_PORT_1).toBe("4301");
    expect(env.BERTRAND_PORT_2).toBeUndefined();
  });
});

describe("localhostPreviewUrl", () => {
  test("is loopback with the port (Phase 1)", () => {
    expect(localhostPreviewUrl(4300)).toBe("http://localhost:4300");
  });
});
