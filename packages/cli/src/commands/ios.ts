import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildIosNativeHostApp,
  resolveTargetXcodeScheme,
  stageIosEmbed,
} from "@gd-kirie/build";
import { execa } from "execa";

import { runBuild } from "./build.ts";
import {
  assertConfiguredTarget,
  createGodotExportUserArgs,
  loadKirieConfig,
  type ResolvedKirieConfig,
} from "./config.ts";
import { resolveGodotExportTemplatesRootDir } from "./doctor/index.ts";
import { runExport } from "./export.ts";

export interface ExportIosAppOptions {
  appPath: string;
  build?: boolean;
  config?: ResolvedKirieConfig;
  cwd?: string;
  derivedDataPath?: string;
  device?: string;
  godotCommand?: string;
  preset?: string;
  release?: boolean;
  target: "device" | "simulator";
  userArgs?: string[];
  xcodeProjectPath?: string;
}

export async function exportIosApp(options: ExportIosAppOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? options.config?.cwd ?? process.cwd());
  const projectDir = options.config?.godot.project ?? cwd;
  validateIosAppOutputPath(path.resolve(cwd, options.appPath), options.target, projectDir);

  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const iosTarget = assertConfiguredTarget(config, "ios", "kirie export ios");
  const appPath = path.resolve(config.cwd, options.appPath);

  validateIosAppOutputPath(appPath, options.target, config.godot.project);
  fs.rmSync(appPath, { force: true, recursive: true });

  if (iosTarget.host === "native") {
    if (!iosTarget.project) {
      throw new Error(
        "kirie export ios app bundle requires targets.ios.project when host is \"native\".",
      );
    }

    if (options.build !== false) {
      await runBuild({ cwd: config.cwd, mode: config.mode });
    }

    const resolvedXcodeProject = path.resolve(config.cwd, iosTarget.project);
    const scheme = fs.existsSync(resolvedXcodeProject)
      ? await resolveTargetXcodeScheme({
          cwd: config.cwd,
          projectPath: resolvedXcodeProject,
          scheme: iosTarget.scheme,
        })
      : iosTarget.scheme;

    const mode = options.release ? "release" : "debug";
    const staged = await stageIosEmbed({
      cwd: config.cwd,
      executableName: scheme,
      godotArgs: config.godot.args,
      godotCommand: options.godotCommand ?? config.godot.command,
      mode,
      preset: options.preset ?? iosTarget.preset ?? "iOS",
      projectDir: config.godot.project,
      resolveSimulatorLibgodot: (projectCwd, releaseMode) =>
        tryResolveIosArm64SimulatorLibgodot({
          cwd: projectCwd,
          release: releaseMode,
        }),
      simulator: options.target === "simulator",
      userArgs: createGodotExportUserArgs(config, "ios", options.userArgs),
    });

    await buildIosNativeHostApp({
      appPath,
      cwd: config.cwd,
      derivedDataPath: options.derivedDataPath,
      device: options.device,
      embedDir: staged.embedDir,
      projectPath: iosTarget.project,
      release: options.release,
      scheme: scheme ?? iosTarget.scheme,
      simulator: options.target === "simulator",
    });
    return;
  }

  const generatedXcodeProjectDir = options.xcodeProjectPath
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), "kirie-ios-export-"));
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
    options.target === "device"
      ? "ios_device_raw_build"
      : "ios_raw_build",
  );

  try {
    await runExport({
      build: options.build,
      config,
      godotCommand: options.godotCommand,
      output: xcodeProjectPath,
      platform: "ios",
      preset: options.preset ?? iosTarget.preset,
      release: options.release,
      userArgs: options.userArgs,
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

    const replacement = resolveIosArm64SimulatorLibgodot({
      cwd: options.cwd,
      existingSimulatorLib: simulatorLibgodot,
      release: options.release ?? false,
    });
    if (path.resolve(replacement) !== path.resolve(simulatorLibgodot)) {
      fs.copyFileSync(replacement, simulatorLibgodot);
    }
  }

  await execa(
    "xcodebuild",
    [
      "-project",
      options.xcodeProjectPath,
      "-scheme",
      scheme,
      "-sdk",
      simulator ? "iphonesimulator" : "iphoneos",
      "-destination",
      simulator
        ? "generic/platform=iOS Simulator"
        : options.device
          ? `id=${options.device}`
          : "generic/platform=iOS",
      "-configuration",
      options.release ? "Release" : "Debug",
      `CONFIGURATION_BUILD_DIR=${options.rawBuildDir}`,
      "ARCHS=arm64",
      ...(simulator
        ? [
            "CODE_SIGNING_ALLOWED=NO",
            "CODE_SIGNING_REQUIRED=NO",
            "CODE_SIGN_IDENTITY=",
            "EXCLUDED_ARCHS=x86_64",
          ]
        : ["-allowProvisioningUpdates"]),
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

export interface ResolveIosSimulatorLibgodotOptions {
  cwd: string;
  existingSimulatorLib?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  release: boolean;
  templatesDir?: string;
}

export function tryResolveIosArm64SimulatorLibgodot(
  options: ResolveIosSimulatorLibgodotOptions,
): string | undefined {
  const target = options.release ? "release" : "debug";
  const fileName = `libgodot.ios.template_${target}.arm64.simulator.a`;

  const envOverride = process.env.KIRIE_IOS_SIMULATOR_LIBGODOT;
  if (envOverride && fs.existsSync(envOverride)) {
    return path.resolve(envOverride);
  }

  if (options.templatesDir) {
    const candidate = path.join(options.templatesDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const templatesRoot = resolveGodotExportTemplatesRootDir({
    homeDir: options.homeDir,
    platform: options.platform,
  });
  if (fs.existsSync(templatesRoot)) {
    const versionDirs = fs
      .readdirSync(templatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const versionDir of versionDirs) {
      const candidate = path.join(templatesRoot, versionDir, fileName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const monorepoGodotRoot = findRepositoryGodotRoot(options.cwd);
  if (monorepoGodotRoot) {
    const monorepoCandidate = path.join(monorepoGodotRoot, "bin", fileName);
    if (fs.existsSync(monorepoCandidate)) {
      return monorepoCandidate;
    }
  }

  if (options.existingSimulatorLib && archiveContainsArm64Slice(options.existingSimulatorLib)) {
    return options.existingSimulatorLib;
  }

  return undefined;
}

export function resolveIosArm64SimulatorLibgodot(
  options: ResolveIosSimulatorLibgodotOptions,
): string {
  const found = tryResolveIosArm64SimulatorLibgodot(options);
  if (found) {
    return found;
  }

  const target = options.release ? "release" : "debug";
  const fileName = `libgodot.ios.template_${target}.arm64.simulator.a`;
  const monorepoGodotRoot = findRepositoryGodotRoot(options.cwd);
  const expectedPath = monorepoGodotRoot
    ? path.join(monorepoGodotRoot, "bin", fileName)
    : path.join(
        options.templatesDir ??
        resolveGodotExportTemplatesRootDir({
          homeDir: options.homeDir,
          platform: options.platform,
        }),
        fileName,
      );

  throw new Error(
    `Missing prebuilt Godot ARM64 iOS simulator library: ${expectedPath}. ` +
    "Install the matching Godot version and build configuration before exporting.",
  );
}

function findRepositoryGodotRoot(cwd: string): string | undefined {
  let directory = path.resolve(cwd);

  while (path.dirname(directory) !== directory) {
    if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
      return path.join(directory, "godot");
    }

    directory = path.dirname(directory);
  }

  return undefined;
}

function archiveContainsArm64Slice(archivePath: string): boolean {
  const stat = fs.statSync(archivePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size < 16) {
    return false;
  }

  const fd = fs.openSync(archivePath, "r");
  try {
    const sampleSize = Math.min(stat.size, 64 * 1024);
    const buffer = Buffer.alloc(sampleSize);
    fs.readSync(fd, buffer, 0, sampleSize, 0);

    // Fat binary magic 0xCAFEBABE (big-endian) with CPU_TYPE_ARM64 (0x0100000C)
    if (buffer.readUInt32BE(0) === 0xCAFEBABE) {
      const nfatArch = buffer.readUInt32BE(4);
      for (let i = 0; i < nfatArch && 8 + (i + 1) * 20 <= buffer.length; i++) {
        if (buffer.readUInt32BE(8 + i * 20) === 0x0100000C) {
          return true;
        }
      }
      return false;
    }

    // Standard `!<arch>\n` static archive containing 64-bit Mach-O members (0xCFFAEDFE + 0x0100000C LE)
    const arm64MachoHeader = Buffer.from([
      0xCF,
      0xFA,
      0xED,
      0xFE,
      0x0C,
      0x00,
      0x00,
      0x01,
    ]);
    return buffer.includes(arm64MachoHeader);
  } finally {
    fs.closeSync(fd);
  }
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
