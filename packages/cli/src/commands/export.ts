import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertViteWebOutput,
  buildAndroidNativeHostApp,
  copyViteWebOutput,
  exportAndroidEmbedArtifact,
  exportGodotPreset,
  exportIosEmbedArtifact,
  type ExportMode,
  listExportPresets,
  stageAndroidEmbed,
  stageIosEmbed,
} from "@gd-kirie/build";

import { runBuild } from "./build.ts";
import {
  assertConfiguredTarget,
  createGodotExportUserArgs,
  loadKirieConfig,
  type ResolvedKirieConfig,
} from "./config.ts";
import { tryExportDotnetWeb } from "./doctor/dotnet-web.ts";
import {
  detectGodotVersion,
  resolveGodotExportTemplatesDir,
  resolveGodotExportTemplatesRootDir,
} from "./doctor/index.ts";
import { exportIosApp, tryResolveIosArm64SimulatorLibgodot } from "./ios.ts";

export type ExportPlatform = "desktop" | "android" | "ios" | "web";

export interface ExportOptions {
  build?: boolean;
  config?: ResolvedKirieConfig;
  cwd?: string;
  godotCommand?: string;
  output?: string;
  platform?: ExportPlatform;
  preset?: string;
  release?: boolean;
  userArgs?: string[];
}

const DEFAULT_NON_DESKTOP_PRESETS: Record<Exclude<ExportPlatform, "desktop">, string> = {
  android: "Android",
  ios: "iOS",
  web: "Web",
};

const DESKTOP_GODOT_PLATFORMS = new Set([
  "macOS",
  "Windows Desktop",
  "Linux",
  "Linux/X11",
]);

export async function runExport(options: ExportOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));

  if (options.platform) {
    assertConfiguredTarget(config, options.platform, "kirie export");
  }

  const preset = resolveExportPreset({
    config,
    explicitPreset: options.preset,
    platform: options.platform,
  });
  if (!preset) {
    throw new Error("Missing export platform or preset.");
  }

  const mode: ExportMode = options.release ? "release" : "debug";
  const godotCommand = options.godotCommand ?? config.godot.command;
  const userArgs = options.platform
    ? createGodotExportUserArgs(config, options.platform, options.userArgs)
    : options.userArgs;

  if (options.platform === "ios" && config.targets.ios?.host === "native") {
    const iosTarget = config.targets.ios;
    if (iosTarget.project) {
      await exportIosApp({
        appPath: options.output ?? `dist/kirie/ios/${mode}.app`,
        build: options.build,
        config,
        godotCommand,
        preset,
        release: options.release,
        target: "simulator",
        userArgs: options.userArgs,
      });
      return;
    }

    if (options.build !== false) {
      await runBuild({ cwd: config.cwd, mode: config.mode });
    }

    const staged = await stageIosEmbed({
      cwd: config.cwd,
      godotArgs: config.godot.args,
      godotCommand,
      mode,
      preset,
      projectDir: config.godot.project,
      resolveSimulatorLibgodot: (projectCwd, releaseMode) =>
        tryResolveIosArm64SimulatorLibgodot({
          cwd: projectCwd,
          release: releaseMode,
        }),
      simulator: false,
      userArgs,
    });
    const outputDir = options.output
      ? path.resolve(config.cwd, options.output)
      : path.resolve(config.cwd, "dist", "kirie", "ios", mode);
    await exportIosEmbedArtifact({
      embedDir: staged.embedDir,
      outputDir,
    });
    return;
  }

  if (options.platform === "android" && config.targets.android?.host === "native") {
    const androidTarget = config.targets.android;
    if (options.build !== false) {
      await runBuild({ cwd: config.cwd, mode: config.mode });
    }

    const androidSourceZipPath = await resolveAndroidSourceTemplateZip({
      config,
      godotCommand,
    });
    const staged = await stageAndroidEmbed({
      androidSourceZipPath,
      csproj: config.godot.csproj,
      cwd: config.cwd,
      godotArgs: config.godot.args,
      godotCommand,
      mode,
      preset,
      projectDir: config.godot.project,
      userArgs,
    });

    if (androidTarget.project) {
      const apkOutputPath = resolveExportOutputPath({
        configCwd: config.cwd,
        mode,
        output: options.output,
        platform: "android",
        preset,
      });
      await buildAndroidNativeHostApp({
        apkOutputPath,
        cwd: config.cwd,
        embedDir: staged.embedDir,
        mode,
        module: androidTarget.module,
        projectPath: androidTarget.project,
      });
      return;
    }

    const outputDir = options.output
      ? path.resolve(config.cwd, options.output)
      : path.resolve(config.cwd, "dist", "kirie", "android", mode);
    await exportAndroidEmbedArtifact({
      embedDir: staged.embedDir,
      outputDir,
    });
    return;
  }

  const outputPath = resolveExportOutputPath({
    configCwd: config.cwd,
    mode,
    output: options.output,
    platform: options.platform,
    preset,
  });

  if (
    options.platform === "web" &&
    (await tryExportDotnetWeb({
      build: options.build !== false,
      config,
      godotCommand,
      outputPath,
      preset,
      release: options.release === true,
      userArgs,
    }))
  ) {
    return;
  }

  if (options.build !== false) {
    await runBuild({ cwd: config.cwd, mode: config.mode });
  }
  if (options.platform === "web" && config.web) {
    assertViteWebOutput(config.web.root);
  }

  await exportGodotPreset({
    godotArgs: config.godot.args,
    godotCommand,
    installAndroidBuildTemplate:
      options.platform === "android" || preset === DEFAULT_NON_DESKTOP_PRESETS.android,
    mode,
    outputPath,
    preset,
    projectDir: config.godot.project,
    userArgs,
  });

  if (options.platform === "web" && config.web) {
    copyViteWebOutput({
      outputDir: path.dirname(outputPath),
      webRoot: config.web.root,
    });
  }
}

export function resolveExportOutputPath(options: {
  configCwd: string;
  mode: ExportMode;
  output?: string;
  platform?: ExportPlatform;
  preset: string;
}): string {
  if (options.output) {
    return path.resolve(options.configCwd, options.output);
  }

  const platformName = options.platform ?? options.preset.toLowerCase().replaceAll(/\W+/g, "-");
  const extension = resolveExportExtension(platformName);
  const outputName = platformName === "web"
    ? "index"
    : options.mode;
  return path.resolve(
    options.configCwd,
    "dist",
    "kirie",
    platformName,
    `${outputName}.${extension}`,
  );
}

function resolveExportExtension(platformName: string): string {
  if (platformName === "android") {
    return "apk";
  }
  if (platformName === "web") {
    return "html";
  }
  if (platformName === "desktop") {
    if (process.platform === "darwin") {
      return "app";
    }
    if (process.platform === "win32") {
      return "exe";
    }
    return "x86_64";
  }
  return "xcodeproj";
}

function resolveExportPreset(options: {
  config: ResolvedKirieConfig;
  explicitPreset?: string;
  platform?: ExportPlatform;
}): string | undefined {
  if (options.explicitPreset) {
    return options.explicitPreset;
  }
  if (!options.platform) {
    return undefined;
  }

  const targetConfig = options.config.targets[options.platform];
  if (targetConfig?.preset) {
    return targetConfig.preset;
  }

  if (options.platform === "desktop") {
    return resolveDefaultDesktopPreset(options.config.godot.project);
  }

  return DEFAULT_NON_DESKTOP_PRESETS[options.platform];
}

function resolveDefaultDesktopPreset(projectDir: string): string {
  const hostPlatformName = process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows Desktop"
      : "Linux";

  const presets = listExportPresets(projectDir);
  const matchingHost = presets.find((preset) =>
    preset.platform === hostPlatformName ||
    (hostPlatformName === "Linux" && preset.platform === "Linux/X11"),
  );
  if (matchingHost) {
    return matchingHost.name;
  }

  const anyDesktop = presets.find((preset) => DESKTOP_GODOT_PLATFORMS.has(preset.platform));
  if (anyDesktop) {
    return anyDesktop.name;
  }

  return hostPlatformName;
}

async function resolveAndroidSourceTemplateZip(options: {
  config: ResolvedKirieConfig;
  godotCommand: string;
}): Promise<string> {
  const envOverride = process.env.KIRIE_ANDROID_SOURCE_ZIP;
  if (envOverride) {
    return path.resolve(options.config.cwd, envOverride);
  }

  let detectedVersion: string | undefined;
  try {
    detectedVersion = await detectGodotVersion({
      godotArgs: options.config.godot.args,
      godotCommand: options.godotCommand,
      projectDir: options.config.godot.project,
    });
  } catch {
    detectedVersion = undefined;
  }

  if (detectedVersion) {
    const versionedCandidate = path.join(
      resolveGodotExportTemplatesDir({
        homeDir: os.homedir(),
        platform: process.platform,
        version: detectedVersion,
      }),
      "android_source.zip",
    );
    if (fs.existsSync(versionedCandidate)) {
      return versionedCandidate;
    }
  }

  const rootDir = resolveGodotExportTemplatesRootDir();
  if (fs.existsSync(rootDir)) {
    const versionDirs = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const versionDir of versionDirs) {
      const candidate = path.join(rootDir, versionDir, "android_source.zip");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const expectedPath = detectedVersion
    ? path.join(
        resolveGodotExportTemplatesDir({
          homeDir: os.homedir(),
          platform: process.platform,
          version: detectedVersion,
        }),
        "android_source.zip",
      )
    : path.join(rootDir, "<version>", "android_source.zip");
  throw new Error(
    `Godot Android source template not found: ${expectedPath}. ` +
    "Install Godot export templates or set KIRIE_ANDROID_SOURCE_ZIP.",
  );
}
