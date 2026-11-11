import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildDotnet,
  buildViteWeb,
  exportGodotPreset,
  readExportPresetValue,
} from "@gd-kirie/build";
import { execa } from "execa";

import {
  createGodotExportUserArgs,
  getActiveAddonsForTargets,
  getActivePluginsForTarget,
  loadKirieConfig,
  type ResolvedKirieConfig,
  resolveSingleOrExplicitTarget,
} from "./config.ts";
import { checkGodotAddon } from "./doctor/addons.ts";
import { tryExportDotnetWeb } from "./doctor/dotnet-web.ts";
import { resolveExportOutputPath, runExport } from "./export.ts";
import { exportIosApp } from "./ios.ts";
import {
  createKirieDevLaunchOptions,
  isIosSimulatorDevice,
  runAndroid,
  runIos,
} from "./run.ts";
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
  const config = await loadKirieConfig({
    command: "serve",
    cwd: options.cwd,
    mode: options.mode,
  });
  const target = resolveSingleOrExplicitTarget(config, options.target, "dev", [
    "desktop",
    "ios",
    "android",
    "web",
  ]);

  if (target === "ios" && config.targets.ios?.host === "native" && !config.targets.ios.project) {
    throw new Error(
      "kirie dev ios requires targets.ios.project when host is \"native\", " +
      "or run kirie export ios to build the embed artifact.",
    );
  }
  if (
    target === "android" &&
    config.targets.android?.host === "native" &&
    !config.targets.android.project
  ) {
    throw new Error(
      "kirie dev android requires targets.android.project when host is \"native\", " +
      "or run kirie export android to build the embed artifact.",
    );
  }

  if (target === "android" && config.targets.android?.host === "godot" && config.web) {
    assertAndroidDevInternetPermission(
      config,
      config.targets.android.preset ?? "Android",
    );
  }
  if (target === "ios" && config.targets.ios?.host === "godot") {
    assertIosDevExportProjectOnly(
      config,
      config.targets.ios.preset ?? "iOS",
    );
  }
  if (target === "desktop") {
    for (const plugin of getActivePluginsForTarget(config, "desktop")) {
      for (const addon of getActiveAddonsForTargets(plugin, ["desktop"])) {
        if (addon.optional) {
          continue;
        }

        const result = await checkGodotAddon(config.godot.project, addon);
        if (!result.installed || !result.valid) {
          if (addon.id === "godot-cef") {
            throw new Error(
              `Godot CEF is required. ${result.message}. Run: pnpm kirie doctor --fix plugin:${plugin.id}`,
            );
          }
          throw new Error(
            `Godot addon ${addon.id} is required. ${result.message}. Run: pnpm kirie doctor --fix plugin:${plugin.id}`,
          );
        }
      }
    }
  }
  if (target === "web" && !config.web) {
    throw new Error(
      "kirie dev web requires webview(...) from \"kirie/plugin/webview\" in kirie.config.ts.",
    );
  }

  const physicalIosDevice =
    target === "ios" &&
    Boolean(options.device) &&
    !(await isIosSimulatorDevice(options.device!, config.cwd));

  if (!config.web) {
    switch (target) {
      case "desktop":
        await runDesktopDev(config, undefined, options);
        return;
      case "android":
        await runAndroidDev(config, undefined, options);
        return;
      case "ios":
        await runIosDev(config, undefined, physicalIosDevice, options);
        return;
      case "web":
        throw new Error(
          "kirie dev web requires webview(...) from \"kirie/plugin/webview\" in kirie.config.ts.",
        );
    }
  }

  const webOutput = target === "web"
    ? await exportWebDevHost(config, options)
    : "";

  const vite = await startViteDevServer(config, {
    clearScreen: options.clearScreen,
    crossOriginIsolation: target === "web",
    force: options.force,
    host: options.host ?? (physicalIosDevice ? "0.0.0.0" : undefined),
    logLevel: options.logLevel,
    port: options.port,
    preferNetworkUrl: options.preferNetworkUrl ?? physicalIosDevice,
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
        await runIosDev(config, vite.url, physicalIosDevice, options);
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
  const preset = config.targets.web?.preset ?? "Web";
  const outputPath = resolveExportOutputPath({
    configCwd: config.cwd,
    mode: "debug",
    platform: "web",
    preset,
  });
  const godotCommand = options.godotCommand ?? config.godot.command;
  const userArgs = createGodotExportUserArgs(config, "web", options.godotArgs);

  if (await tryExportDotnetWeb({
    build: false,
    config,
    godotCommand,
    includeWebContent: false,
    outputPath,
    preset,
    release: false,
    userArgs,
  })) {
    return outputPath;
  }

  await exportGodotPreset({
    godotArgs: config.godot.args,
    godotCommand,
    mode: "debug",
    outputPath,
    preset,
    projectDir: config.godot.project,
    userArgs,
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
  const filePath = path.resolve(outputPath).replaceAll("\\", "/").replace(/^\/+/, "");
  const url = new URL(`/@fs/${filePath}`, webUrl);
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
  webUrl: string | undefined,
  options: DevOptions,
): Promise<void> {
  const godotCommand = options.godotCommand ?? config.godot.command;

  await execa(
    godotCommand,
    [
      ...config.godot.args,
      "--headless",
      "--path",
      config.godot.project,
      "--import",
    ],
    {
      cwd: config.godot.project,
      stdio: "inherit",
    },
  );

  const userArgs = [
    ...(webUrl
      ? Object.entries(createKirieDevLaunchOptions(webUrl)).map(
          ([key, value]) => `--${key}=${value}`,
        )
      : []),
    ...(options.godotArgs ?? []),
  ];

  await execa(
    godotCommand,
    [
      ...config.godot.args,
      "--path",
      config.godot.project,
      ...(userArgs.length > 0
        ? ["--", ...userArgs]
        : []),
    ],
    {
      cwd: config.godot.project,
      stdio: "inherit",
    },
  );
}

async function ensureBuiltWebDistForMobileExport(config: ResolvedKirieConfig): Promise<void> {
  if (!config.web) {
    return;
  }

  const distIndexPath = path.join(config.web.root, "dist", "index.html");
  if (existsSync(distIndexPath)) {
    return;
  }

  await buildViteWeb({
    mode: config.mode,
    viteConfig: config.web.vite,
    webRoot: config.web.root,
  });
}

async function runAndroidDev(
  config: ResolvedKirieConfig,
  webUrl: string | undefined,
  options: DevOptions,
): Promise<void> {
  await ensureBuiltWebDistForMobileExport(config);
  await buildDotnet({
    csproj: config.godot.csproj,
    projectDir: config.godot.project,
    skipMissingProject: true,
  });
  await runExport({
    build: false,
    config,
    godotCommand: options.godotCommand,
    platform: "android",
    userArgs: options.godotArgs,
  });

  if (webUrl) {
    const reverseWeb = resolveAndroidReverseWebUrl(webUrl);
    await execa(
      "adb",
      [
        ...(options.device
          ? ["-s", options.device]
          : []),
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
    return;
  }

  await runAndroid({
    clearData: options.clearData,
    clearLogcat: options.clearLogcat,
    config,
    device: options.device,
    forceStop: options.forceStop ?? true,
  });
}

async function runIosDev(
  config: ResolvedKirieConfig,
  webUrl: string | undefined,
  physicalDevice: boolean,
  options: DevOptions,
): Promise<void> {
  const appPath =
    options.appPath ??
    (physicalDevice ? "dist/kirie/ios/device_debug.app" : "dist/kirie/ios/debug.app");

  await ensureBuiltWebDistForMobileExport(config);
  await buildDotnet({
    csproj: config.godot.csproj,
    projectDir: config.godot.project,
    skipMissingProject: true,
  });
  await exportIosApp({
    appPath,
    build: false,
    config,
    derivedDataPath: config.targets.ios?.host === "native"
      ? path.join(
          config.cwd,
          ".kirie",
          "derived-data",
          "ios",
          physicalDevice ? "device" : "simulator",
        )
      : undefined,
    device: options.device,
    godotCommand: options.godotCommand,
    target: physicalDevice ? "device" : "simulator",
    userArgs: options.godotArgs,
  });
  await runIos({
    appPath,
    config,
    device: options.device,
    launchOptions: webUrl
      ? createKirieDevLaunchOptions(webUrl)
      : undefined,
    terminateExisting: options.terminateExisting ?? true,
  });
}

export function resolveAndroidReverseWebUrl(webUrl: string): { port: number; url: string } {
  const url = new URL(webUrl);
  const port = Number(url.port || (url.protocol === "https:"
    ? 443
    : 80));

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Vite dev server URL does not include a valid TCP port: ${webUrl}`);
  }

  url.hostname = "127.0.0.1";

  return {
    port,
    url: url.toString(),
  };
}

function assertAndroidDevInternetPermission(
  config: ResolvedKirieConfig,
  presetName = "Android",
): void {
  const internetPermission = readExportPresetValue({
    optionName: "permissions/internet",
    presetName,
    projectDir: config.godot.project,
  });

  if (internetPermission === true) {
    return;
  }

  throw new Error(
    "kirie dev android requires the Android export preset option permissions/internet=true.",
  );
}

function assertIosDevExportProjectOnly(
  config: ResolvedKirieConfig,
  presetName = "iOS",
): void {
  const exportProjectOnly = readExportPresetValue({
    optionName: "application/export_project_only",
    presetName,
    projectDir: config.godot.project,
  });

  if (exportProjectOnly === true) {
    return;
  }

  throw new Error(
    "kirie dev ios requires the iOS export preset option application/export_project_only=true.",
  );
}
