import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveKirieConfig } from "./config.ts";
import { runExport } from "./export.ts";
import { exportIosApp } from "./ios.ts";
import { createCliProjectTracker } from "./test-project.ts";

vi.mock("./export.ts", () => ({ runExport: vi.fn() }));
vi.mock("execa", () => ({
  execa: vi.fn(async (_command: string, args: string[]) => {
    const buildDir = args.find((arg) => arg.startsWith("CONFIGURATION_BUILD_DIR="))!
      .slice("CONFIGURATION_BUILD_DIR=".length);
    const scheme = args[args.indexOf("-scheme") + 1]!;
    await fs.mkdir(path.join(buildDir, `${scheme}.app`));
  }),
}));

const projects = createCliProjectTracker("kirie-cli-ios-");

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("reports the missing simulator library before building the app", async () => {
    const project = await projects.copy();
    const exportedLibrary = path.join(project, "export", "simulator", "libgodot.a");
    const requiredLibrary = path.join(
      project,
      "godot",
      "bin",
      "libgodot.ios.template_debug.arm64.simulator.a",
    );
    await fs.writeFile(path.join(project, "pnpm-workspace.yaml"), "packages: []\n");
    await fs.mkdir(path.dirname(exportedLibrary), { recursive: true });
    await fs.writeFile(exportedLibrary, "export template library");

    await expect(exportIosApp({
      appPath: "dist/simulator.app",
      build: false,
      config: resolveKirieConfig(undefined, { cwd: project }),
      target: "simulator",
      xcodeProjectPath: "export/project.xcodeproj",
    })).rejects.toThrow(`Missing prebuilt Godot ARM64 iOS simulator library: ${requiredLibrary}`);

    expect(execa).not.toHaveBeenCalled();
    await expect(fs.readFile(exportedLibrary, "utf8")).resolves.toBe("export template library");
  });

  it.each([false, true])("builds a simulator app with the prepared library (release=%s)", async (release) => {
    const project = await projects.copy();
    const exportedLibrary = path.join(project, "export", "simulator", "libgodot.a");
    const libraryDir = path.join(project, "godot", "bin");
    await fs.writeFile(path.join(project, "pnpm-workspace.yaml"), "packages: []\n");
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(path.join(libraryDir, "libgodot.ios.template_debug.arm64.simulator.a"), "debug library");
    await fs.writeFile(path.join(libraryDir, "libgodot.ios.template_release.arm64.simulator.a"), "release library");
    vi.mocked(runExport).mockImplementationOnce(async () => {
      await fs.mkdir(path.dirname(exportedLibrary), { recursive: true });
      await fs.writeFile(exportedLibrary, "export template library");
    });

    await exportIosApp({
      appPath: "dist/simulator.app",
      build: false,
      config: resolveKirieConfig(undefined, { cwd: project }),
      release,
      target: "simulator",
      xcodeProjectPath: "export/project.xcodeproj",
    });

    await expect(fs.readFile(exportedLibrary, "utf8")).resolves.toBe(
      release ? "release library" : "debug library",
    );
    expect((await fs.stat(path.join(project, "dist", "simulator.app"))).isDirectory()).toBe(true);
    expect(execa).toHaveBeenCalledOnce();
    expect(vi.mocked(execa).mock.calls[0]?.[0]).toBe("xcodebuild");
  });
});
