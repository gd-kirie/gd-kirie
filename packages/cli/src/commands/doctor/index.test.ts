import type { KirieGodotAddonDependency } from "../../plugin/index.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import webview from "../../plugin/webview.ts";
import { type ResolvedKirieConfig, resolveKirieConfig } from "../config.ts";
import { parseDoctorTarget } from "../index.ts";
import { createCliProjectTracker, installProjectFixture } from "../test-project.ts";
import {
  checkAndroidSdk,
  checkGodotCommand,
  checkGodotExportTemplates,
  runDoctor,
  runDoctorChecks,
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

  it("parses platform and plugin targets", () => {
    expect(parseDoctorTarget("desktop", ["desktop"])).toBe("desktop");
    expect(parseDoctorTarget("ios", ["ios"])).toBe("ios");
    expect(parseDoctorTarget("android", ["android"])).toBe("android");
    expect(parseDoctorTarget("web", ["web"])).toBe("web");
    expect(parseDoctorTarget("plugin:example", ["plugin:example"])).toBe("plugin:example");
    expect(() => parseDoctorTarget("unknown", ["unknown"])).toThrow("Unknown doctor target: unknown");
    expect(() => parseDoctorTarget("plugin:example", ["plugin:example", "extra"]))
      .toThrow("Unexpected doctor argument: extra");
  });

  it("rejects plugin and platform targets that are not configured", async () => {
    const project = await projects.copy();

    await expect(runDoctor({
      config: createPluginConfig(project),
      target: "plugin:missing",
    })).rejects.toThrow("Kirie plugin is not configured: missing");

    await expect(runDoctor({
      config: createPluginConfig(project),
      target: "android",
    })).rejects.toThrow("kirie doctor cannot target \"android\"");
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

  it("scopes checks strictly to declared targets and skips desktop-only addons on mobile-only configs", async () => {
    const project = await projects.copy();
    await installProjectFixture(project, "fake-godot.js");
    const homeDir = await createTempDir("kirie-doctor-scope-home-");
    const templateDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      "4.5.stable",
    );
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, "ios.zip"), "");

    const iosOnlyWebviewConfig = resolveKirieConfig(
      {
        godot: {
          args: ["fake-godot.js"],
          command: process.execPath,
        },
        plugins: [
          webview({ root: "./src-web" }),
        ],
        targets: {
          ios: { host: "godot" },
        },
      },
      { cwd: project },
    );

    const checks = await runDoctorChecks({
      config: iosOnlyWebviewConfig,
      env: {},
      homeDir,
      platform: "darwin",
    });

    const checkNames = checks.map((item) => item.name);
    expect(checkNames).not.toContain("Android SDK");
    expect(checkNames).not.toContain("webview / godot-cef");
    expect(checkNames).toContain("webview / kirie");
  });

  it("validates host: native project paths and gradlew without touching user host files on --fix", async () => {
    const project = await projects.copy();
    await installProjectFixture(project, "fake-godot.js");
    const homeDir = await createTempDir("kirie-doctor-native-home-");
    const sdk = await createTempDir("kirie-doctor-native-sdk-");
    const templateDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      "4.5.stable",
    );
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, "android_source.zip"), "");

    const androidHostDir = path.join(project, "android-host");
    await fs.mkdir(androidHostDir, { recursive: true });
    await fs.writeFile(path.join(androidHostDir, "settings.gradle.kts"), "rootProject.name = \"host\"\n");

    const nativeConfig = resolveKirieConfig(
      {
        godot: {
          args: ["fake-godot.js"],
          command: process.execPath,
        },
        targets: {
          android: {
            host: "native",
            project: "./android-host",
          },
        },
      },
      { cwd: project },
    );

    const checksMissingGradlew = await runDoctorChecks({
      config: nativeConfig,
      env: { ANDROID_HOME: sdk },
      homeDir,
      platform: "darwin",
    });
    expect(checksMissingGradlew).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("Gradle wrapper not found"),
        name: "Android native host project",
        status: "fail",
      }),
    );

    await fs.writeFile(path.join(androidHostDir, "gradlew"), "#!/bin/sh\n");
    const checksWithGradlew = await runDoctorChecks({
      config: nativeConfig,
      env: { ANDROID_HOME: sdk },
      homeDir,
      platform: "darwin",
    });
    expect(checksWithGradlew).toContainEqual(
      expect.objectContaining({
        name: "Android native host project",
        status: "ok",
      }),
    );

    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDoctor({
      config: nativeConfig,
      env: { ANDROID_HOME: sdk },
      fix: true,
      homeDir,
      platform: "darwin",
    });
    expect(loggedOutput(output)).toContain("ok Android native host project:");
    await expect(fs.readFile(path.join(androidHostDir, "settings.gradle.kts"), "utf8")).resolves.toBe(
      "rootProject.name = \"host\"\n",
    );
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
      plugins: [
        {
          dotnetPackages: [
            { id: "Example.Package", version: "1.0.0" },
          ],
          godotAddons: [requiredAddon, optionalAddon],
          id: "example",
        },
      ],
      targets: {
        desktop: { host: "godot" },
      },
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
