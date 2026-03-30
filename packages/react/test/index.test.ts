import { describe, expect, it, vi } from "vitest";

// We can't fully render React hooks outside of React,
// but we can test the exported API surface and createAvsConvexAuth.

describe("@avs-auth/react", () => {
  it("exports useAvsAuth hook", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.useAvsAuth).toBe("function");
  });

  it("exports createAvsConvexAuth helper", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createAvsConvexAuth).toBe("function");
  });

  it("re-exports createAvsAuth from @avs-auth/auth", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createAvsAuth).toBe("function");
  });

  it("re-exports decodeIdentityClaims from @avs-auth/auth", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.decodeIdentityClaims).toBe("function");
  });

  it("createAvsConvexAuth returns useAuth, signIn, and signOut", async () => {
    // Mock browser globals for createAvsAuth
    const storage: Record<string, string> = {};
    vi.stubGlobal("window", { location: { href: "http://localhost", origin: "http://localhost", pathname: "/" } });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((k: string) => storage[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { storage[k] = v; }),
      removeItem: vi.fn((k: string) => { delete storage[k]; })
    });
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    });

    const mod = await import("../src/index");
    const convexAuth = mod.createAvsConvexAuth({});

    expect(typeof convexAuth.useAuth).toBe("function");
    expect(typeof convexAuth.signIn).toBe("function");
    expect(typeof convexAuth.signOut).toBe("function");
  });
});
