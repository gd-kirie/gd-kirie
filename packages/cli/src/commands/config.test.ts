import { describe, expect, it } from "vitest";
import { resolveKirieConfig } from "./config.ts";

describe("kirie plugin configuration", () => {
  it("rejects duplicate plugin IDs", () => {
    expect(() => resolveKirieConfig(
      { plugins: [{ id: "example" }, { id: "example" }] },
      { cwd: "/project" },
    )).toThrow("Duplicate Kirie plugin ID: example");
  });
});
