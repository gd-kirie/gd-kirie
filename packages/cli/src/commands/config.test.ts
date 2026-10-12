import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveKirieConfig } from "./config.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kirie plugin configuration", () => {
  it("rejects duplicate plugin IDs", () => {
    expect(() => resolveKirieConfig(
      { plugins: [{ id: "example" }, { id: "example" }] },
      { cwd: "/project" },
    )).toThrow("Duplicate Kirie plugin ID: example");
  });

  it("uses GODOT unless the project config selects another command", () => {
    vi.stubEnv("GODOT", "C:\\Godot\\Godot.exe");

    expect(resolveKirieConfig(undefined, { cwd: "/project" }).godot.command)
      .toBe("C:\\Godot\\Godot.exe");
    expect(resolveKirieConfig(
      { godot: { command: "project-godot" } },
      { cwd: "/project" },
    ).godot.command).toBe("project-godot");
  });
});
