import { describe, expect, it } from "vitest";
import { isCallbackRoute } from "../src/index";

describe("@avs-auth/auth hosted helpers", () => {
  it("matches the configured callback route", () => {
    expect(isCallbackRoute("/auth/callback", "/auth/callback")).toBe(true);
    expect(isCallbackRoute("/auth/callback", "/")).toBe(false);
  });
});
