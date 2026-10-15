import type { KirieGodotAddonDependency } from "../../plugin/index.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { type ResolvedKirieConfig, resolveKirieConfig } from "../config.ts";
import { parseDoctorTarget } from "../index.ts";
import { createCliProjectTracker } from "../test-project.ts";
import {
  checkAndroidSdk,
  checkGodotCommand,
  checkGodotExportTemplates,
  runDoctor,
} from "./index.ts";

const projects = createCliProjectTracker("kirie-cli-doctor-");
const tempDirs: string[] = [];
const bundledUrl = pathToFileURL(os.tmpdir()).href;
const requiredAddon: KirieGodotAddonDependency = {
  id: "required-addon",
  path: "addons/required-addon",
  source: { type: "bundled", url: bundledUrl },
};
const optionalAddon: KirieGodotAddonDependency = {
  id: "optional-addon",
  optional: true,
  path: "addons/optional-addon",
  source: { type: "bundled", url: bundledUrl },
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    projects.cleanup(),
    ...tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  ]);
});

describe("doctor command", () => {
  it("checks only the selected plugin without environment diagnostics", async () => {
    const project = await projects.copy();
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runDoctor({
      config: createPluginConfig(project),
      target: "plugin:example",
    })).rejects.toThrow("kirie doctor found 1 problem(s)");

    expect(loggedOutput(output)).toContain("fail example / required-addon: not installed");
    expect(loggedOutput(output)).toContain("warn example / optional-addon: not installed");
    expect(loggedOutput(output)).not.toContain("Godot command");
  });

  it("parses only one plugin target", () => {
    expect(parseDoctorTarget("web", ["web"])).toBe("web");
    expect(parseDoctorTarget("plugin:example", ["plugin:example"])).toBe("plugin:example");
    expect(() => parseDoctorTarget("unknown", ["unknown"])).toThrow("Unknown doctor target: unknown");
    expect(() => parseDoctorTarget("plugin:example", ["plugin:example", "extra"]))
      .toThrow("Unexpected doctor argument: extra");
  });

  it("rejects plugin targets that are not configured", async () => {
    const project = await projects.copy();

    await expect(runDoctor({
      config: createPluginConfig(project),
      target: "plugin:missing",
    })).rejects.toThrow("Kirie plugin is not configured: missing");
  });

  it("repairs only the selected plugin", async () => {
    const project = await projects.copy();
    await Promise.all([
      writeAddonFixture(project, requiredAddon),
      writeAddonFixture(project, optionalAddon),
    ]);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await runDoctor({
      config: createPluginConfig(project),
      fix: true,
      target: "plugin:example",
    });

    expect(loggedOutput(output)).toContain("required-addon is already installed");
    expect(loggedOutput(output)).toContain("optional-addon is already installed");
    expect(loggedOutput(output)).toContain("ok example / required-addon:");
    expect(loggedOutput(output)).not.toContain("Godot command");
  });
});

describe("checkAndroidSdk", () => {
  it("passes when ANDROID_HOME points at an existing SDK directory", async () => {
    const sdk = await createTempDir("kirie-android-sdk-");

    const check = await checkAndroidSdk({ ANDROID_HOME: sdk });

    expect(check).toMatchObject({
      message: `ANDROID_HOME=${sdk}`,
      name: "Android SDK",
      status: "ok",
    });
  });

  it("fails when no Android SDK environment variable is configured", async () => {
    const check = await checkAndroidSdk({});

    expect(check).toMatchObject({
      name: "Android SDK",
      status: "fail",
    });
  });
});

describe("checkGodotCommand", () => {
  it("passes with the normalized Godot version", async () => {
    const result = await checkGodotCommand({
      godotArgs: [],
      godotCommand: "godot",
      projectDir: os.tmpdir(),
      runGodotVersion: async () => "4.5.stable.official.876b29033",
    });

    expect(result).toMatchObject({
      check: {
        message: "4.5.stable",
        name: "Godot command",
        status: "ok",
      },
      version: "4.5.stable",
    });
  });

  it("fails when the Godot command cannot report a version", async () => {
    const result = await checkGodotCommand({
      godotArgs: [],
      godotCommand: "missing-godot",
      projectDir: os.tmpdir(),
      runGodotVersion: async () => {
        throw new Error("not found");
      },
    });

    expect(result).toMatchObject({
      check: {
        message: "could not run missing-godot --version: not found",
        name: "Godot command",
        status: "fail",
      },
    });
  });
});

describe("checkGodotExportTemplates", () => {
  it("passes when templates for the active Godot version are installed", async () => {
    const homeDir = await createTempDir("kirie-godot-home-");
    const templateDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      "4.5.stable",
    );
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, "android_debug.apk"), "");

    const check = await checkGodotExportTemplates({
      homeDir,
      platform: "darwin",
      version: "4.5.stable",
    });

    expect(check).toMatchObject({
      message: templateDir,
      name: "Godot export templates",
      status: "ok",
    });
  });

  it("fails when templates for the active Godot version are missing", async () => {
    const homeDir = await createTempDir("kirie-godot-home-");

    const check = await checkGodotExportTemplates({
      homeDir,
      platform: "darwin",
      version: "4.5.stable",
    });

    expect(check).toMatchObject({
      name: "Godot export templates",
      status: "fail",
    });
  });

  it("uses the full Godot version config for .NET export templates", async () => {
    const homeDir = await createTempDir("kirie-godot-home-");
    const templateDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      "4.5.stable.mono",
    );
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, "ios.zip"), "");

    const check = await checkGodotExportTemplates({
      homeDir,
      platform: "darwin",
      version: "4.5.stable.mono",
    });

    expect(check).toMatchObject({
      message: templateDir,
      name: "Godot export templates",
      status: "ok",
    });
  });
});

function createPluginConfig(project: string): ResolvedKirieConfig {
  return resolveKirieConfig(
    {
      plugins: [{
        dotnetPackages: [{ id: "Example.Package", version: "1.0.0" }],
        godotAddons: [requiredAddon, optionalAddon],
        id: "example",
      }],
    },
    { cwd: project },
  );
}

function loggedOutput(output: { mock: { calls: unknown[][] } }): string {
  return output.mock.calls.flat().join("\n");
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeAddonFixture(
  project: string,
  addon: KirieGodotAddonDependency,
): Promise<void> {
  const directory = path.join(project, addon.path);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "plugin.cfg"), "[plugin]\n");
}
