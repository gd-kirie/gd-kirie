import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveKirieConfig } from "./config.ts";
import { exportIosApp, resolveIosArm64SimulatorLibgodot } from "./ios.ts";
import { createCliProjectTracker } from "./test-project.ts";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));

vi.mock("./export.ts", () => ({
  runExport: vi.fn(),
}));
vi.mock("execa", () => ({ execa: mockExeca }));

const projects = createCliProjectTracker("kirie-cli-ios-");
const externalDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all([
    projects.cleanup(),
    ...externalDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  ]);
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
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-ios-empty-home-"));
    externalDirs.push(emptyHome);
    vi.stubEnv("HOME", emptyHome);
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
      config: resolveKirieConfig(
        {
          targets: {
            ios: { host: "godot" },
          },
        },
        { cwd: project },
      ),
      target: "simulator",
      xcodeProjectPath: "export/project.xcodeproj",
    })).rejects.toThrow(`Missing prebuilt Godot ARM64 iOS simulator library: ${requiredLibrary}`);

    expect(mockExeca).not.toHaveBeenCalled();
  });

  it.each([false, true])("builds a simulator app with the prepared library (release=%s)", async (release) => {
    const project = await projects.copy();
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-ios-empty-home-"));
    externalDirs.push(emptyHome);
    vi.stubEnv("HOME", emptyHome);
    const exportedLibrary = path.join(project, "export", "simulator", "libgodot.a");
    const libraryDir = path.join(project, "godot", "bin");
    await fs.writeFile(path.join(project, "pnpm-workspace.yaml"), "packages: []\n");
    await fs.mkdir(libraryDir, { recursive: true });
    await fs.writeFile(path.join(libraryDir, "libgodot.ios.template_debug.arm64.simulator.a"), "debug library");
    await fs.writeFile(path.join(libraryDir, "libgodot.ios.template_release.arm64.simulator.a"), "release library");
    await fs.mkdir(path.dirname(exportedLibrary), { recursive: true });
    await fs.writeFile(exportedLibrary, "export template library");
    mockExeca.mockImplementationOnce(async () => {
      await fs.mkdir(path.join(project, "dist", "ios_raw_build", `${path.basename(project)}.app`));
    });

    await exportIosApp({
      appPath: "dist/simulator.app",
      build: false,
      config: resolveKirieConfig(
        {
          targets: {
            ios: { host: "godot" },
          },
        },
        { cwd: project },
      ),
      release,
      target: "simulator",
      xcodeProjectPath: "export/project.xcodeproj",
    });

    await expect(fs.readFile(exportedLibrary, "utf8")).resolves.toBe(
      release ? "release library" : "debug library",
    );
  });

  it("resolves simulator libgodot from installed export templates outside any monorepo", async () => {
    const externalProject = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-ios-external-proj-"));
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-ios-external-home-"));
    externalDirs.push(externalProject, homeDir);

    const templateDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      "4.7.2.stable.mono",
    );
    const installedLib = path.join(
      templateDir,
      "libgodot.ios.template_debug.arm64.simulator.a",
    );
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(installedLib, "external simulator lib");

    expect(
      resolveIosArm64SimulatorLibgodot({
        cwd: externalProject,
        homeDir,
        platform: "darwin",
        release: false,
      }),
    ).toBe(installedLib);
  });
});
