import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import core from "../plugin/core.ts";
import webview from "../plugin/webview.ts";
import {
  createGodotExportUserArgs,
  defineKirieConfig,
  getActiveAddonsForTargets,
  getConfiguredTargets,
  loadKirieConfig,
  resolveKirieConfig,
  resolveSingleOrExplicitTarget,
} from "./config.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-config-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("resolveKirieConfig", () => {
  it("rejects duplicate plugin IDs", () => {
    expect(() =>
      resolveKirieConfig(
        {
          plugins: [
            { id: "example" },
            { id: "example" },
          ],
          targets: {
            desktop: { host: "godot" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Duplicate Kirie plugin ID: example");
  });

  it("rejects unknown top-level keys and gives a migration hint for web", () => {
    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            desktop: { host: "godot" },
          },
          web: { root: "./src-web" },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Configure webview({ root: \"./src-web\" }) from \"kirie/plugin/webview\"");

    expect(() =>
      resolveKirieConfig(
        {
          extra: true,
          targets: {
            desktop: { host: "godot" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Unknown top-level key \"extra\"");
  });

  it("requires non-empty targets and explicit valid host values", () => {
    expect(() => resolveKirieConfig({}, { cwd: "/project" })).toThrow("targets");
    expect(() => resolveKirieConfig({ targets: {} }, { cwd: "/project" })).toThrow(
      "must declare at least one target",
    );
    expect(() =>
      resolveKirieConfig({
        targets: { desktop: {} },
      }, { cwd: "/project" }),
    ).toThrow("targets.desktop.host is required");
    expect(() =>
      resolveKirieConfig({
        targets: {
          desktop: { host: "native" },
        },
      }, { cwd: "/project" }),
    ).toThrow("targets.desktop.host must be \"godot\"");
    expect(() =>
      resolveKirieConfig({
        targets: {
          web: { host: "native" },
        },
      }, { cwd: "/project" }),
    ).toThrow("targets.web.host must be \"godot\"");
  });

  it("validates native vs godot host options on ios and android", () => {
    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            ios: { host: "godot", project: "./ios-app/App.xcodeproj" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("cannot set project or scheme");

    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            ios: { host: "native", scheme: "App" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("targets.ios.scheme requires targets.ios.project");

    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            android: { host: "godot", module: ":app" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("cannot set project or module");

    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            android: { host: "native", module: ":app" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("targets.android.module requires targets.android.project");

    expect(() =>
      resolveKirieConfig(
        {
          targets: {
            ios: { host: "godot", plugins: [] },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Per-target \"plugins\" is not supported");

    const nativeConfig = resolveKirieConfig(
      {
        plugins: [core],
        targets: {
          android: { host: "native" },
          ios: { host: "native", project: "./ios-host/Host.xcodeproj", scheme: "Host" },
        },
      },
      { cwd: "/project" },
    );

    expect(nativeConfig.web).toBeUndefined();
    expect(nativeConfig.targets.desktop).toBeUndefined();
    expect(nativeConfig.targets.android).toEqual({
      host: "native",
      module: undefined,
      preset: undefined,
      project: undefined,
    });
    expect(nativeConfig.targets.ios).toEqual({
      host: "native",
      preset: undefined,
      project: "./ios-host/Host.xcodeproj",
      scheme: "Host",
    });
  });

  it("narrows core to dotnetPackages and scopes webview + target-restricted plugins cleanly", () => {
    expect(core.godotAddons).toBeUndefined();
    expect(core.dotnetPackages?.map((pkg) => pkg.id)).toEqual([
      "GdKirie.EventaAdapter",
      "GdKirie.Platform",
    ]);

    const desktopOnlyPlugin = {
      godotAddons: [
        {
          id: "tray-addon",
          path: "addons/tray",
          source: { type: "bundled" as const, url: "file:///tmp/tray" },
          targets: ["desktop"] as const,
        },
      ],
      id: "tray",
      supportedTargets: ["desktop"] as const,
    };

    expect(() =>
      resolveKirieConfig(
        {
          plugins: [desktopOnlyPlugin],
          targets: {
            ios: { host: "godot" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Plugin \"tray\" supports targets [desktop], which does not match any configured target [ios].");

    const config = resolveKirieConfig(
      {
        plugins: [
          core,
          webview({ root: "./ui" }),
          desktopOnlyPlugin,
        ],
        targets: {
          desktop: { host: "godot" },
          ios: { host: "godot" },
        },
      },
      { cwd: "/project" },
    );

    expect(config.web?.root).toBe(path.resolve("/project", "ui"));
    expect(getConfiguredTargets(config)).toEqual(["desktop", "ios"]);
    expect(createGodotExportUserArgs(config, "desktop")).toEqual([
      "--kirie-plugins=core,webview,tray",
      `--kirie-web-dist=${path.resolve("/project", "ui", "dist")}`,
    ]);
    expect(createGodotExportUserArgs(config, "ios")).toEqual([
      "--kirie-plugins=core,webview",
      `--kirie-web-dist=${path.resolve("/project", "ui", "dist")}`,
    ]);

    const webviewPlugin = config.plugins.find((plugin) => plugin.id === "webview")!;
    expect(getActiveAddonsForTargets(webviewPlugin, ["ios"]).map((a) => a.id)).toEqual(["kirie"]);
    expect(getActiveAddonsForTargets(webviewPlugin, ["desktop"]).map((a) => a.id)).toEqual([
      "kirie",
      "godot-cef",
    ]);
  });

  it("rejects multiple plugins declaring web configuration", () => {
    expect(() =>
      resolveKirieConfig(
        {
          plugins: [
            webview({ root: "./src-web" }),
            {
              id: "second-web",
              web: { root: "./other-web" },
            },
          ],
          targets: {
            desktop: { host: "godot" },
          },
        },
        { cwd: "/project" },
      ),
    ).toThrow("Multiple Kirie plugins declare web assets");
  });

  it("enforces single-target auto-selection vs multi-target explicit target error", () => {
    const multi = resolveKirieConfig(
      {
        targets: {
          desktop: { host: "godot" },
          ios: { host: "godot" },
        },
      },
      { cwd: "/project" },
    );

    expect(() => resolveSingleOrExplicitTarget(multi, undefined, "dev")).toThrow(
      "Multiple targets configured (desktop, ios); specify a target: kirie dev <target>",
    );
    expect(() => resolveSingleOrExplicitTarget(multi, undefined, "run")).toThrow(
      "Multiple targets configured (desktop, ios); specify a target: kirie run <target>",
    );
    expect(resolveSingleOrExplicitTarget(multi, "ios", "dev")).toBe("ios");

    const singleIos = resolveKirieConfig(
      {
        targets: {
          ios: { host: "godot" },
        },
      },
      { cwd: "/project" },
    );
    expect(resolveSingleOrExplicitTarget(singleIos, undefined, "dev")).toBe("ios");
    expect(resolveSingleOrExplicitTarget(singleIos, undefined, "run")).toBe("ios");
  });
});

describe("loadKirieConfig (Node 24 native TypeScript loader)", () => {
  it("fails clearly when kirie.config.ts is missing", async () => {
    const dir = await createTempProject();
    await expect(loadKirieConfig({ cwd: dir })).rejects.toThrow(
      `Missing required Kirie config file: ${path.join(dir, "kirie.config.ts")}`,
    );
  });

  it("loads object, Promise, and factory exports via native TypeScript import", async () => {
    const dir = await createTempProject();
    const configPath = path.join(dir, "kirie.config.ts");

    await fs.writeFile(
      configPath,
      `import type { KirieConfig } from ${JSON.stringify(path.resolve(import.meta.dirname, "./config.ts"))};
const config: KirieConfig = {
  targets: { desktop: { host: "godot" } },
};
export default config;
`,
    );
    const loadedObject = await loadKirieConfig({ cwd: dir });
    expect(getConfiguredTargets(loadedObject)).toEqual(["desktop"]);

    await fs.writeFile(
      configPath,
      `export default Promise.resolve({
  targets: { ios: { host: "native" as const } },
});
`,
    );
    const loadedPromise = await loadKirieConfig({ cwd: dir });
    expect(getConfiguredTargets(loadedPromise)).toEqual(["ios"]);

    await fs.writeFile(
      configPath,
      `export default ({ command, mode }: { command: string; mode: string }) => ({
  godot: { args: [command, mode] },
  targets: { android: { host: "godot" as const } },
});
`,
    );
    const loadedFactory = await loadKirieConfig({ command: "build", cwd: dir, mode: "staging" });
    expect(loadedFactory.godot.args).toEqual(["build", "staging"]);
    expect(defineKirieConfig({
      targets: {
        desktop: { host: "godot" },
      },
    })).toEqual({
      targets: {
        desktop: { host: "godot" },
      },
    });
  });
});
