import { afterEach, describe, expect, it } from "vitest";

import { exportIosApp } from "./ios.ts";
import { createCliProjectTracker } from "./test-project.ts";

const projects = createCliProjectTracker("kirie-cli-ios-");

afterEach(async () => {
  await projects.cleanup();
});

describe("exportIosApp", () => {
  it("rejects project root app output paths before exporting", async () => {
    const project = await projects.copy();

    await expect(
      exportIosApp({
        appPath: ".",
        build: false,
        cwd: project,
        target: "simulator",
      }),
    ).rejects.toThrow("iOS simulator app output path must end with .app");
  });
  it("rejects non-app output paths before exporting", async () => {
    const project = await projects.copy();

    await expect(
      exportIosApp({
        appPath: "dist/device",
        build: false,
        cwd: project,
        target: "device",
      }),
    ).rejects.toThrow("iOS device app output path must end with .app");
  });
});
