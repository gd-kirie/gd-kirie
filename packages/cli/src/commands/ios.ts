import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { loadKirieConfig, type ResolvedKirieConfig } from "./config.ts";
import { runExport } from "./export.ts";

export interface ExportIosAppOptions {
  appPath: string;
  build?: boolean;
  config?: ResolvedKirieConfig;
  cwd?: string;
  godotCommand?: string;
  preset?: string;
  release?: boolean;
  device?: string;
  target: "device" | "simulator";
  xcodeProjectPath?: string;
}

export async function exportIosApp(options: ExportIosAppOptions): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const appPath = path.resolve(config.cwd, options.appPath);
  const generatedXcodeProjectDir = options.xcodeProjectPath ?
    undefined :
      fs.mkdtempSync(path.join(os.tmpdir(), "kirie-ios-export-"));
  const xcodeProjectPath = path.resolve(
    config.cwd,
    options.xcodeProjectPath ??
    path.join(
      generatedXcodeProjectDir ?? os.tmpdir(),
      `${path.basename(config.godot.project)}.xcodeproj`,
    ),
  );
  const rawBuildDir = path.join(
    path.dirname(appPath),
    options.target === "device" ? "ios_device_raw_build" : "ios_raw_build",
  );

  validateIosAppOutputPath(appPath, options.target, config.godot.project);

  fs.rmSync(appPath, { force: true, recursive: true });

  try {
    await runExport({
      build: options.build,
      config,
      godotCommand: options.godotCommand,
      output: xcodeProjectPath,
      platform: "ios",
      preset: options.preset,
      release: options.release,
    });
    await buildExportedIosApp({
      appPath,
      cwd: config.cwd,
      device: options.device,
      projectDir: config.godot.project,
      rawBuildDir,
      release: options.release,
      target: options.target,
      xcodeProjectPath,
    });
  } finally {
    if (generatedXcodeProjectDir) {
      fs.rmSync(generatedXcodeProjectDir, { force: true, recursive: true });
    }
  }
}

async function buildExportedIosApp(options: {
  appPath: string;
  cwd: string;
  device?: string;
  projectDir: string;
  rawBuildDir: string;
  release?: boolean;
  target: ExportIosAppOptions["target"];
  xcodeProjectPath: string;
}): Promise<void> {
  const scheme = path.basename(options.projectDir);
  const rawAppPath = path.join(options.rawBuildDir, `${scheme}.app`);
  const simulator = options.target === "simulator";

  fs.mkdirSync(path.dirname(options.appPath), { recursive: true });
  fs.mkdirSync(path.dirname(options.xcodeProjectPath), { recursive: true });
  fs.rmSync(options.rawBuildDir, { force: true, recursive: true });
  fs.mkdirSync(options.rawBuildDir, { recursive: true });

  if (simulator) {
    const simulatorLibgodot = findSimulatorLibgodot(path.dirname(options.xcodeProjectPath));
    if (!simulatorLibgodot) {
      throw new Error(
        `Could not find exported simulator libgodot.a in ${path.dirname(options.xcodeProjectPath)}`,
      );
    }

    fs.copyFileSync(
      resolveIosArm64SimulatorLibgodot(options.cwd, options.release ?? false),
      simulatorLibgodot,
    );
  }

  await execa(
    "xcodebuild",
    [
      "-project",
      options.xcodeProjectPath,
      "-showBuildTimingSummary",
      "-scheme",
      scheme,
      "-sdk",
      simulator ? "iphonesimulator" : "iphoneos",
      "-destination",
      simulator ?
        "generic/platform=iOS Simulator" :
        options.device ?
          `id=${options.device}` :
          "generic/platform=iOS",
      "-configuration",
      options.release ? "Release" : "Debug",
      `CONFIGURATION_BUILD_DIR=${options.rawBuildDir}`,
      "ARCHS=arm64",
      ...(simulator ?
          [
            "CODE_SIGNING_ALLOWED=NO",
            "CODE_SIGNING_REQUIRED=NO",
            "CODE_SIGN_IDENTITY=",
            "EXCLUDED_ARCHS=x86_64",
          ] :
          ["-allowProvisioningUpdates"]),
      "ONLY_ACTIVE_ARCH=YES",
      "build",
    ],
    {
      cwd: options.cwd,
      stdio: "inherit",
    },
  );

  fs.renameSync(rawAppPath, options.appPath);
  fs.rmSync(options.rawBuildDir, { force: true, recursive: true });
}

function findSimulatorLibgodot(dirPath: string): string | undefined {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const found = findSimulatorLibgodot(entryPath);
      if (found) {
        return found;
      }

      continue;
    }

    if (entry.name === "libgodot.a" && entryPath.includes("simulator")) {
      return entryPath;
    }
  }

  return undefined;
}

function resolveIosArm64SimulatorLibgodot(cwd: string, release: boolean): string {
  const target = release ? "release" : "debug";
  const godotRoot = resolveRepositoryGodotRoot(cwd);
  const arm64Source = path.join(
    godotRoot,
    `bin/libgodot.ios.template_${target}.arm64.simulator.a`,
  );

  if (fs.existsSync(arm64Source)) {
    return arm64Source;
  }

  throw new Error(
    `Missing prebuilt Godot ARM64 iOS simulator library: ${arm64Source}. ` +
    "Install the matching Godot version and build configuration before exporting.",
  );
}

function resolveRepositoryGodotRoot(cwd: string): string {
  let directory = path.resolve(cwd);

  while (path.dirname(directory) !== directory) {
    if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
      return path.join(directory, "godot");
    }

    directory = path.dirname(directory);
  }

  throw new Error(`Could not locate the Kirie repository from ${cwd}`);
}

function validateIosAppOutputPath(
  appPath: string,
  target: ExportIosAppOptions["target"],
  projectDir: string,
): void {
  const resolvedAppPath = path.resolve(appPath);

  if (path.extname(resolvedAppPath) !== ".app") {
    throw new Error(`iOS ${target} app output path must end with .app: ${resolvedAppPath}`);
  }

  if (resolvedAppPath === path.resolve(projectDir)) {
    throw new Error(
      `iOS ${target} app output path must not be the Godot project root: ${resolvedAppPath}`,
    );
  }
}
