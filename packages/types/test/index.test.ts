import { describe, expect, it } from "vitest";

/**
 * Types export contract test.
 *
 * This verifies that @avs-auth/types is a valid ES module whose
 * public type surface can be imported without runtime errors.
 * The actual type correctness is enforced by `tsc --noEmit`
 * (the `typecheck` task); this suite exists so the package does
 * not need --passWithNoTests.
 */

describe("@avs-auth/types", () => {
  it("exports all protocol types as a valid ES module", async () => {
    const mod = await import("../src/index");

    // The types package is type-only at runtime (no runtime exports),
    // but the module itself must resolve without error.
    expect(mod).toBeDefined();
  });

  it("module has no unexpected runtime exports (types-only package)", async () => {
    const mod = await import("../src/index");

    // A types-only package should export zero runtime values.
    // All exports are `export type`, which TypeScript strips at emit.
    const runtimeKeys = Object.keys(mod);
    expect(runtimeKeys).toEqual([]);
  });
});
