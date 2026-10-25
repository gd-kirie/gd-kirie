import path from "node:path";
import {
  assertViteWebOutput,
  copyViteWebOutput,
  exportGodotPreset,
  type ExportMode,
} from "@gd-kirie/build";
import { runBuild } from "./build.ts";
import { loadKirieConfig, type ResolvedKirieConfig } from "./config.ts";
import { tryExportDotnetWeb } from "./doctor/dotnet-web.ts";

export type ExportPlatform = "android" | "ios" | "web";

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

const DEFAULT_PLATFORM_PRESETS: Record<ExportPlatform, string> = {
  android: "Android",
  ios: "iOS",
  web: "Web",
};

export async function runExport(options: ExportOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const preset = options.preset ?? (options.platform && DEFAULT_PLATFORM_PRESETS[options.platform]);
  if (!preset) {
    throw new Error("Missing export platform or preset.");
  }
  const mode = options.release ? "release" : "debug";
  const outputPath = resolveExportOutputPath({
    configCwd: config.cwd,
    mode,
    output: options.output,
    platform: options.platform,
    preset,
  });

  if (options.platform === "web" && await tryExportDotnetWeb({
    build: options.build !== false,
    config,
    godotCommand: options.godotCommand ?? config.godot.command,
    outputPath,
    preset,
    release: options.release === true,
    userArgs: options.userArgs,
  })) {
    return;
  }

  if (options.build !== false) {
    await runBuild({ cwd: config.cwd, mode: config.mode });
  }
  if (options.platform === "web") {
    assertViteWebOutput(config.web.root);
  }

  await exportGodotPreset({
    godotArgs: config.godot.args,
    godotCommand: options.godotCommand ?? config.godot.command,
    installAndroidBuildTemplate: preset === DEFAULT_PLATFORM_PRESETS.android,
    mode,
    outputPath,
    preset,
    projectDir: config.godot.project,
    userArgs: options.userArgs,
  });
  if (options.platform === "web") {
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
  const extension = platformName === "android"
    ? "apk"
    : platformName === "web"
      ? "html"
      : "xcodeproj";
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
