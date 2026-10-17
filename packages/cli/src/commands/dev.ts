import path from "node:path";
import { buildDotnet, exportGodotPreset, readExportPresetValue } from "@gd-kirie/build";
import { execa } from "execa";

import { loadKirieConfig, type ResolvedKirieConfig } from "./config.ts";
import { checkGodotAddon } from "./doctor/addons.ts";
import { tryExportDotnetWeb } from "./doctor/dotnet-web.ts";
import { resolveExportOutputPath, runExport } from "./export.ts";
import { exportIosApp } from "./ios.ts";
import { createKirieDevLaunchOptions, isIosSimulatorDevice, runAndroid, runIos } from "./run.ts";
import { startViteDevServer, type StartViteDevServerOptions } from "./vite.ts";

export type DevTarget = "desktop" | "android" | "ios" | "web";

export interface DevOptions extends StartViteDevServerOptions {
  appPath?: string;
  clearData?: boolean;
  clearLogcat?: boolean;
  cwd?: string;
  device?: string;
  forceStop?: boolean;
  godotArgs?: string[];
  godotCommand?: string;
  mode?: string;
  target?: DevTarget;
  terminateExisting?: boolean;
  waitForWebExit?: (url: string) => Promise<void>;
}

export async function runDev(options: DevOptions = {}): Promise<void> {
  const target = options.target ?? "desktop";
  const config = await loadKirieConfig({
    command: "serve",
    cwd: options.cwd,
    mode: options.mode,
  });

  if (target === "android") {
    assertAndroidDevInternetPermission(config);
  }
  if (target === "ios") {
    assertIosDevExportProjectOnly(config);
  }
  if (target === "desktop") {
    for (const plugin of config.plugins) {
      for (const addon of plugin.godotAddons ?? []) {
        if (addon.optional) {
          continue;
        }

        const result = await checkGodotAddon(config.godot.project, addon);
        if (!result.valid) {
          throw new Error(
            `Godot addon ${addon.id} is required. ${result.message}. Run: pnpm kirie doctor --fix plugin:${plugin.id}`,
          );
        }
      }
    }

    const core = config.plugins.find((plugin) => plugin.id === "core");
    const godotCef = core?.godotAddons?.find((addon) => addon.id === "godot-cef");
    if (!godotCef) {
      throw new Error("kirie dev desktop requires the core plugin in kirie.config.ts.");
    }

    const result = await checkGodotAddon(config.godot.project, godotCef);
    if (!result.installed || !result.valid) {
      throw new Error(
        `Godot CEF is required. ${result.message}. Run: pnpm kirie doctor --fix plugin:core`,
      );
    }
  }

  const webOutput = target === "web" ? await exportWebDevHost(config, options) : "";

  const vite = await startViteDevServer(config, {
    clearScreen: options.clearScreen,
    crossOriginIsolation: target === "web",
    godotWebOutput: webOutput || undefined,
    force: options.force,
    logLevel: options.logLevel,
    port: options.port,
    host: options.host,
    strictPort: options.strictPort,
  });

  try {
    if (target !== "web") {
      console.log(`Kirie dev server: ${vite.url}`);
    }

    switch (target) {
      case "desktop":
        await runDesktopDev(config, vite.url, options);
        return;
      case "android":
        await runAndroidDev(config, vite.url, options);
        return;
      case "ios":
        await runIosDev(config, vite.url, options);
        return;
      case "web":
        await runWebDev(vite.url, webOutput, options);
    }
  } finally {
    await vite.server.close();
  }
}

async function exportWebDevHost(
  config: ResolvedKirieConfig,
  options: DevOptions,
): Promise<string> {
  const outputPath = resolveExportOutputPath({
    configCwd: config.cwd,
    mode: "debug",
    platform: "web",
    preset: "Web",
  });
  const godotCommand = options.godotCommand ?? config.godot.command;

  if (await tryExportDotnetWeb({
    build: false,
    config,
    godotCommand,
    includeWebContent: false,
    outputPath,
    preset: "Web",
    release: false,
  })) {
    return outputPath;
  }

  await exportGodotPreset({
    godotArgs: config.godot.args,
    godotCommand,
    mode: "debug",
    outputPath,
    preset: "Web",
    projectDir: config.godot.project,
  });
  return outputPath;
}

async function runWebDev(
  webUrl: string,
  outputPath: string,
  options: DevOptions,
): Promise<void> {
  const hostUrl = createWebDevHostUrl(webUrl, outputPath);
  console.log(`Kirie Godot Web host: ${hostUrl}`);

  if (options.waitForWebExit) {
    await options.waitForWebExit(hostUrl);
  } else {
    await waitForWebExit();
  }
}

export function createWebDevHostUrl(webUrl: string, outputPath: string): string {
  const url = new URL(`/@kirie/${encodeURIComponent(path.basename(outputPath))}`, webUrl);
  url.searchParams.set("kirie-dev", "1");
  url.searchParams.set("kirie-web-url", webUrl);
  return url.toString();
}

function waitForWebExit(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

async function runDesktopDev(
  config: ResolvedKirieConfig,
  webUrl: string,
  options: DevOptions,
): Promise<void> {
  const godotCommand = options.godotCommand ?? config.godot.command;

  await execa(
    godotCommand,
    [...config.godot.args, "--headless", "--path", config.godot.project, "--import"],
    {
      cwd: config.godot.project,
      stdio: "inherit",
    },
  );
  await execa(
    godotCommand,
    [
      ...config.godot.args,
      "--path",
      config.godot.project,
      "--",
      ...Object.entries(createKirieDevLaunchOptions(webUrl)).map(
        ([key, value]) => `--${key}=${value}`,
      ),
      ...(options.godotArgs ?? []),
    ],
    {
      cwd: config.godot.project,
      stdio: "inherit",
    },
  );
}

async function runAndroidDev(
  config: ResolvedKirieConfig,
  webUrl: string,
  options: DevOptions,
): Promise<void> {
  const reverseWeb = resolveAndroidReverseWebUrl(webUrl);

  await buildDotnet({
    projectDir: config.godot.project,
    skipMissingProject: true,
  });
  await runExport({
    build: false,
    config,
    godotCommand: options.godotCommand,
    platform: "android",
    userArgs: ["--kirie-android-aar=debug"],
  });
  await execa(
    "adb",
    [
      ...(options.device ? ["-s", options.device] : []),
      "reverse",
      `tcp:${reverseWeb.port}`,
      `tcp:${reverseWeb.port}`,
    ],
    {
      cwd: config.cwd,
      stdio: "inherit",
    },
  );
  await runAndroid({
    clearData: options.clearData,
    clearLogcat: options.clearLogcat,
    config,
    device: options.device,
    forceStop: options.forceStop ?? true,
    launchOptions: createKirieDevLaunchOptions(reverseWeb.url),
  });
}

async function runIosDev(
  config: ResolvedKirieConfig,
  webUrl: string,
  options: DevOptions,
): Promise<void> {
  const physicalDevice =
    options.device && !(await isIosSimulatorDevice(options.device, config.cwd));
  const appPath =
    options.appPath ??
    (physicalDevice ? "dist/kirie/ios/device_debug.app" : "dist/kirie/ios/debug.app");

  await buildDotnet({
    projectDir: config.godot.project,
    skipMissingProject: true,
  });
  await exportIosApp({
    appPath,
    build: false,
    config,
    device: options.device,
    godotCommand: options.godotCommand,
    target: physicalDevice ? "device" : "simulator",
  });
  await runIos({
    appPath,
    config,
    device: options.device,
    launchOptions: createKirieDevLaunchOptions(webUrl),
    terminateExisting: options.terminateExisting ?? true,
  });
}

export function resolveAndroidReverseWebUrl(webUrl: string): { port: number; url: string } {
  const url = new URL(webUrl);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Vite dev server URL does not include a valid TCP port: ${webUrl}`);
  }

  url.hostname = "127.0.0.1";

  return {
    port,
    url: url.toString(),
  };
}

function assertAndroidDevInternetPermission(config: ResolvedKirieConfig): void {
  const internetPermission = readExportPresetValue({
    optionName: "permissions/internet",
    presetName: "Android",
    projectDir: config.godot.project,
  });

  if (internetPermission === true) {
    return;
  }

  throw new Error(
    "kirie dev android requires the Android export preset option permissions/internet=true.",
  );
}

function assertIosDevExportProjectOnly(config: ResolvedKirieConfig): void {
  const exportProjectOnly = readExportPresetValue({
    optionName: "application/export_project_only",
    presetName: "iOS",
    projectDir: config.godot.project,
  });

  if (exportProjectOnly === true) {
    return;
  }

  throw new Error(
    "kirie dev ios requires the iOS export preset option application/export_project_only=true.",
  );
}
