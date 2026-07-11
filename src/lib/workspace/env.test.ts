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

  test("does not promise a port block the allocator never reserved", () => {
    const env = workspaceEnv(base);
    expect(env.BERTRAND_PORT_0).toBeUndefined();
    expect(env.BERTRAND_PORT_1).toBeUndefined();
    expect(env.BERTRAND_PORT_9).toBeUndefined();
  });
});

describe("localhostPreviewUrl", () => {
  test("is loopback with the port (Phase 1)", () => {
    expect(localhostPreviewUrl(4300)).toBe("http://localhost:4300");
  });
});
