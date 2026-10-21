import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { distDir, godotSourceRoot, rootDir } from "./build-shared.ts";

const addonSourceDir = "packages/kirie/addon/addons/kirie";
const addonStageDir = `${distDir}/addons/kirie`;
const addonZipPath = `${distDir}/kirie-addon.zip`;
const androidAarOutputDir = "packages/kirie/native/android/plugin/build/outputs/aar";
const androidAddonLibraryDir = "packages/kirie/addon/addons/kirie/libraries/android";
const androidStagedDebugAar = `${addonStageDir}/libraries/android/Kirie-debug.aar`;
const androidStagedReleaseAar = `${addonStageDir}/libraries/android/Kirie-release.aar`;
const iosPluginDir = "packages/kirie/native/ios/Kirie";
const iosBuildDir = `${iosPluginDir}/.build`;
const iosGeneratedDir = `${iosPluginDir}/.generated`;
const iosProjectPath = `${iosGeneratedDir}/Kirie.xcodeproj`;
const iosOutputDir = "packages/kirie/addon/addons/kirie/ios";
const iosDebugOutputXcframework = `${iosOutputDir}/Kirie.debug.xcframework`;
const iosReleaseOutputXcframework = `${iosOutputDir}/Kirie.release.xcframework`;
const iosLegacyOutputXcframework = `${iosOutputDir}/Kirie.xcframework`;
const iosStagedDebugXcframework = `${addonStageDir}/ios/Kirie.debug.xcframework`;
const iosStagedReleaseXcframework = `${addonStageDir}/ios/Kirie.release.xcframework`;
const iosDerivedDataPath = `${iosBuildDir}/DerivedData`;

function assertPathExists(pathToCheck: string): void {
  if (!fs.existsSync(pathToCheck)) {
    throw new Error(`Required addon release path is missing: ${pathToCheck}`);
  }
}

function findSymlink(dirPath: string): string | undefined {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      return entryPath;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const found = findSymlink(entryPath);
    if (found) {
      return found;
    }
  }

  return undefined;
}

async function generateIosProject(): Promise<void> {
  fs.mkdirSync(iosGeneratedDir, { recursive: true });

  await execa(
    "xcodegen",
    [
      "generate",
      "--spec",
      `${iosPluginDir}/project.yml`,
      "--project-root",
      iosPluginDir,
      "--project",
      iosGeneratedDir,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
}

async function archiveIosFramework(
  configuration: string,
  destination: string,
  archivePath: string,
  architectures?: string,
): Promise<void> {
  await execa(
    "xcodebuild",
    [
      "archive",
      "-project",
      iosProjectPath,
      "-scheme",
      "Kirie",
      "-configuration",
      configuration,
      "-derivedDataPath",
      iosDerivedDataPath,
      `GODOT_SOURCE_ROOT=${godotSourceRoot}`,
      "SKIP_INSTALL=NO",
      "BUILD_LIBRARY_FOR_DISTRIBUTION=YES",
      "CODE_SIGNING_ALLOWED=NO",
      "-destination",
      destination,
      "-archivePath",
      archivePath,
      ...(architectures ? [`ARCHS=${architectures}`] : []),
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
}

async function createIosXcframework(
  configuration: string,
  name: string,
  outputPath: string,
  simulatorOnly = false,
): Promise<void> {
  const deviceArchivePath = `${iosBuildDir}/Kirie-${name}-iOS.xcarchive`;
  const simulatorArchivePath = `${iosBuildDir}/Kirie-${name}-Simulator.xcarchive`;

  fs.rmSync(deviceArchivePath, { force: true, recursive: true });
  fs.rmSync(simulatorArchivePath, { force: true, recursive: true });
  fs.rmSync(outputPath, { force: true, recursive: true });

  if (!simulatorOnly) {
    await archiveIosFramework(configuration, "generic/platform=iOS", deviceArchivePath);
  }

  await archiveIosFramework(
    configuration,
    "generic/platform=iOS Simulator",
    simulatorArchivePath,
    simulatorOnly ? "arm64" : undefined,
  );

  await execa(
    "xcodebuild",
    [
      "-create-xcframework",
      ...(!simulatorOnly ?
          [
            "-framework",
            `${deviceArchivePath}/Products/Library/Frameworks/Kirie.framework`,
          ] :
          []),
      "-framework",
      `${simulatorArchivePath}/Products/Library/Frameworks/Kirie.framework`,
      "-output",
      outputPath,
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
}

function prepareIosBuildDirs(): void {
  fs.mkdirSync(iosBuildDir, { recursive: true });
  fs.mkdirSync(iosGeneratedDir, { recursive: true });
  fs.mkdirSync(iosOutputDir, { recursive: true });
}

// mise task entrypoint.
export function checkAddonPack(): void {
  assertPathExists(addonStageDir);
  assertPathExists(`${addonStageDir}/plugin.gd`);
  assertPathExists(`${addonStageDir}/gd_kirie.gd`);
  assertPathExists(androidStagedReleaseAar);
  assertPathExists(iosStagedDebugXcframework);
  assertPathExists(`${iosStagedDebugXcframework}/Info.plist`);
  assertPathExists(iosStagedReleaseXcframework);
  assertPathExists(`${iosStagedReleaseXcframework}/Info.plist`);

  if (fs.existsSync(androidStagedDebugAar)) {
    throw new Error(`Development-only debug AAR must not be included: ${androidStagedDebugAar}`);
  }

  const symlink = findSymlink(addonStageDir);
  if (symlink) {
    throw new Error(`Release addon staging must not contain symlinks: ${symlink}`);
  }
}

// mise task entrypoint.
export async function buildAndroidAar(): Promise<void> {
  await execa(
    "mise",
    [
      "x",
      "--",
      "packages/kirie/native/android/gradlew",
      "--project-dir",
      "packages/kirie/native/android",
      ":plugin:assembleDebug",
      ":plugin:assembleRelease",
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  fs.mkdirSync(androidAddonLibraryDir, { recursive: true });

  const debugAar = `${androidAddonLibraryDir}/Kirie-debug.aar`;
  fs.rmSync(debugAar, { force: true });
  fs.copyFileSync(`${androidAarOutputDir}/Kirie-debug.aar`, debugAar);

  const releaseAar = `${androidAddonLibraryDir}/Kirie-release.aar`;
  fs.rmSync(releaseAar, { force: true });
  fs.copyFileSync(`${androidAarOutputDir}/Kirie-release.aar`, releaseAar);
}

// mise task entrypoint.
export async function buildIosXcframework(): Promise<void> {
  prepareIosBuildDirs();
  await generateIosProject();

  fs.rmSync(iosLegacyOutputXcframework, { force: true, recursive: true });
  await createIosXcframework("ReleaseDebug", "debug", iosDebugOutputXcframework);
  await createIosXcframework("Release", "release", iosReleaseOutputXcframework);
}

// mise task entrypoint.
export async function buildIosSimulatorXcframework(): Promise<void> {
  prepareIosBuildDirs();
  await generateIosProject();

  await createIosXcframework(
    "ReleaseDebug",
    "debug",
    iosDebugOutputXcframework,
    true,
  );
}

// mise task entrypoint.
export async function testSwift(): Promise<void> {
  if (!fs.existsSync(`${iosPluginDir}/project.yml`)) {
    throw new Error("This task must be run from the repository root.");
  }

  await generateIosProject();

  await execa(
    "xcodebuild",
    [
      "test",
      "-project",
      iosProjectPath,
      "-scheme",
      "KirieTests",
      "-destination",
      `platform=macOS,arch=${process.arch === "arm64" ? "arm64" : "x86_64"}`,
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
    ],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
}

// mise task entrypoint.
export async function packAddon(): Promise<void> {
  await execa("pnpm", ["-C", "packages/kirie", "run", "generate:godot"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  fs.rmSync(addonStageDir, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(addonStageDir), { recursive: true });
  fs.cpSync(addonSourceDir, addonStageDir, {
    recursive: true,
    filter: (src) =>
      path.resolve(src) !== path.resolve(`${addonSourceDir}/libraries/android/Kirie-debug.aar`),
  });
  fs.rmSync(androidStagedDebugAar, { force: true });

  checkAddonPack();

  fs.rmSync(addonZipPath, { force: true });
  await execa("zip", ["-r", path.basename(addonZipPath), "addons/kirie"], {
    cwd: path.join(rootDir, distDir),
    stdio: "inherit",
  });
}
