import type { ExportMode } from "./godot.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { listExportPresets } from "./presets.ts";

export interface AndroidEmbedManifest {
  aarFile: string;
  addonAars: string[];
  mode: ExportMode;
  platform: "android";
  sources: string[];
}

export interface StageAndroidEmbedOptions {
  androidSourceZipPath: string;
  assembleAar?: boolean;
  csproj?: string;
  cwd: string;
  embedDir?: string;
  env?: NodeJS.ProcessEnv;
  godotArgs?: string[];
  godotCommand: string;
  mode: ExportMode;
  preset: string;
  projectDir: string;
  userArgs?: string[];
}

export interface StagedAndroidEmbed {
  aarPath: string;
  embedDir: string;
  manifest: AndroidEmbedManifest;
}

export interface BuildAndroidNativeHostAppOptions {
  apkOutputPath: string;
  cwd: string;
  embedDir: string;
  env?: NodeJS.ProcessEnv;
  mode: ExportMode;
  module?: string;
  projectPath: string;
}

export interface ExportAndroidEmbedArtifactOptions {
  embedDir: string;
  outputDir: string;
}

export function resolveDefaultAndroidEmbedDir(cwd: string, mode: ExportMode): string {
  return path.resolve(cwd, ".kirie", "embed", "android", mode);
}

export function resolveGradleWrapperPath(
  projectDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(projectDir, platform === "win32"
    ? "gradlew.bat"
    : "gradlew");
}

export function normalizeGradleModuleName(moduleName?: string): string {
  if (!moduleName || moduleName.trim() === "") {
    return ":app";
  }

  const trimmed = moduleName.trim();
  return trimmed.startsWith(":")
    ? trimmed
    : `:${trimmed}`;
}

export async function stageAndroidEmbed(
  options: StageAndroidEmbedOptions,
): Promise<StagedAndroidEmbed> {
  if (!fs.existsSync(options.androidSourceZipPath)) {
    throw new Error(
      `Godot Android source template not found: ${options.androidSourceZipPath}`,
    );
  }

  const embedDir = path.resolve(
    options.cwd,
    options.embedDir ?? resolveDefaultAndroidEmbedDir(options.cwd, options.mode),
  );
  const godotBuildDir = path.join(embedDir, "godot-build");
  const sourcesDir = path.join(embedDir, "Sources");
  const addonLibsDir = path.join(embedDir, "libs");
  const aarFileName = `godot-embed-${options.mode}.aar`;
  const aarPath = path.join(embedDir, aarFileName);

  fs.rmSync(embedDir, { force: true, recursive: true });
  fs.mkdirSync(godotBuildDir, { recursive: true });
  fs.mkdirSync(sourcesDir, { recursive: true });
  fs.mkdirSync(addonLibsDir, { recursive: true });

  await extractArchive(options.androidSourceZipPath, godotBuildDir);

  const packZipDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirie-android-pack-"));
  const packZipPath = path.join(packZipDir, "assets.zip");
  try {
    const exportArgs = [
      ...(options.godotArgs ?? []),
      "--headless",
      "--path",
      options.projectDir,
      "--export-pack",
      options.preset,
      packZipPath,
    ];
    if (options.userArgs?.length) {
      exportArgs.push("--", ...options.userArgs);
    }

    await execa(options.godotCommand, exportArgs, {
      cwd: options.projectDir,
      env: options.env,
      stdio: "inherit",
    });

    const assetsDir = path.join(godotBuildDir, "src", "main", "assets");
    fs.rmSync(assetsDir, { force: true, recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    await extractArchive(packZipPath, assetsDir);
  } finally {
    fs.rmSync(packZipDir, { force: true, recursive: true });
  }

  const godotLibAar = path.join(
    godotBuildDir,
    "libs",
    options.mode,
    `godot-lib.template_${options.mode}.aar`,
  );
  if (!fs.existsSync(godotLibAar)) {
    throw new Error(`Missing Godot Android library AAR in template: ${godotLibAar}`);
  }

  const extractedGodotLibDir = path.join(godotBuildDir, "godot-lib-unpacked");
  fs.mkdirSync(extractedGodotLibDir, { recursive: true });
  await extractArchive(godotLibAar, extractedGodotLibDir);

  const jniSource = path.join(extractedGodotLibDir, "jni");
  const jniTarget = path.join(godotBuildDir, "src", "main", "jniLibs");
  if (fs.existsSync(jniSource)) {
    fs.rmSync(jniTarget, { force: true, recursive: true });
    fs.cpSync(jniSource, jniTarget, { recursive: true });
  }

  await stageDotnetAndroidNativeArtifacts({
    csproj: options.csproj,
    env: options.env,
    godotBuildDir,
    mode: options.mode,
    preset: options.preset,
    projectDir: options.projectDir,
  });

  const addonAars = collectProjectAddonAars(options.projectDir, options.mode);
  const copiedAddonAars: string[] = [];
  for (const addonAar of addonAars) {
    const fileName = path.basename(addonAar);
    fs.copyFileSync(addonAar, path.join(addonLibsDir, fileName));
    copiedAddonAars.push(`libs/${fileName}`);
  }

  configureStagedAndroidLibraryProject({
    godotBuildDir,
    sourcesDir,
  });

  if (options.assembleAar !== false) {
    const gradlew = resolveGradleWrapperPath(godotBuildDir);
    if (process.platform !== "win32" && fs.existsSync(gradlew)) {
      fs.chmodSync(gradlew, 0o755);
    }
    const assembleTask = options.mode === "release"
      ? "assembleRelease"
      : "assembleDebug";
    await execa(gradlew, [assembleTask], {
      cwd: godotBuildDir,
      env: resolveAndroidBuildEnv(options.env),
      stdio: "inherit",
    });

    const builtAarDir = path.join(godotBuildDir, "build", "outputs", "aar");
    const builtAar = findFirstAar(builtAarDir);
    if (!builtAar) {
      throw new Error(`Gradle build did not produce an embed AAR in ${builtAarDir}.`);
    }

    fs.copyFileSync(builtAar, aarPath);
  }

  const manifest: AndroidEmbedManifest = {
    aarFile: aarFileName,
    addonAars: copiedAddonAars,
    mode: options.mode,
    platform: "android",
    sources: ["Sources/KirieGodotFragment.kt"],
  };
  fs.writeFileSync(
    path.join(embedDir, "embed-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return {
    aarPath,
    embedDir,
    manifest,
  };
}

export interface ConfigureStagedAndroidLibraryOptions {
  godotBuildDir: string;
  sourcesDir: string;
}

export function configureStagedAndroidLibraryProject(
  options: ConfigureStagedAndroidLibraryOptions,
): void {
  fs.rmSync(path.join(options.godotBuildDir, "src", "instrumented"), {
    force: true,
    recursive: true,
  });
  fs.rmSync(
    path.join(options.godotBuildDir, "src", "main", "java", "com", "godot", "game", "GodotApp.java"),
    { force: true },
  );

  stageGodotAndroidJars(options.godotBuildDir);
  mergeGodotAndroidResources(options.godotBuildDir);

  const hostPackageDir = path.join(
    options.godotBuildDir,
    "src",
    "main",
    "java",
    "ai",
    "moeru",
    "kirie",
    "host",
  );
  fs.mkdirSync(hostPackageDir, { recursive: true });

  const pluginSource = renderKirieHostPluginKotlin();
  const fragmentSource = renderKirieGodotFragmentKotlin();

  fs.writeFileSync(path.join(hostPackageDir, "KirieHostPlugin.kt"), pluginSource);
  fs.writeFileSync(path.join(hostPackageDir, "KirieGodotFragment.kt"), fragmentSource);
  fs.mkdirSync(options.sourcesDir, { recursive: true });
  fs.writeFileSync(path.join(options.sourcesDir, "KirieGodotFragment.kt"), fragmentSource);

  const godotLibraryVersion = readGodotLibraryVersionFromUnpackedManifest(options.godotBuildDir);
  fs.writeFileSync(
    path.join(options.godotBuildDir, "src", "main", "AndroidManifest.xml"),
    renderAndroidEmbedLibraryManifest(godotLibraryVersion),
  );
  fs.writeFileSync(
    path.join(options.godotBuildDir, "settings.gradle"),
    renderAndroidEmbedSettingsGradle(),
  );
  fs.writeFileSync(
    path.join(options.godotBuildDir, "build.gradle"),
    renderAndroidEmbedBuildGradle(),
  );
}

export async function exportAndroidEmbedArtifact(
  options: ExportAndroidEmbedArtifactOptions,
): Promise<string> {
  const sourceDir = path.resolve(options.embedDir);
  const outputDir = path.resolve(options.outputDir);
  const manifestPath = path.join(sourceDir, "embed-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Android embed manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AndroidEmbedManifest;
  fs.rmSync(outputDir, { force: true, recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const aarSource = path.join(sourceDir, manifest.aarFile);
  if (fs.existsSync(aarSource)) {
    fs.copyFileSync(aarSource, path.join(outputDir, manifest.aarFile));
  }

  for (const relativeSource of manifest.sources) {
    const from = path.join(sourceDir, relativeSource);
    const to = path.join(outputDir, relativeSource);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  for (const relativeAar of manifest.addonAars) {
    const from = path.join(sourceDir, relativeAar);
    const to = path.join(outputDir, relativeAar);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  fs.copyFileSync(manifestPath, path.join(outputDir, "embed-manifest.json"));
  return outputDir;
}

export async function buildAndroidNativeHostApp(
  options: BuildAndroidNativeHostAppOptions,
): Promise<void> {
  const resolvedProject = path.resolve(options.cwd, options.projectPath);
  const gradlew = resolveGradleWrapperPath(resolvedProject);
  if (!fs.existsSync(gradlew)) {
    throw new Error(`Android Gradle wrapper not found: ${gradlew}`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(gradlew, 0o755);
  }

  const moduleName = normalizeGradleModuleName(options.module);
  const taskSuffix = options.mode === "release"
    ? "AssembleRelease"
    : "AssembleDebug";
  const assembleTask = `${moduleName}:assemble${taskSuffix.slice("Assemble".length)}`;
  const embedDir = path.resolve(options.embedDir);
  const embedAar = path.join(embedDir, `godot-embed-${options.mode}.aar`);

  await execa(
    gradlew,
    [
      assembleTask,
      `-PkirieEmbedDir=${embedDir}`,
      `-PkirieEmbedAar=${embedAar}`,
    ],
    {
      cwd: resolvedProject,
      env: resolveAndroidBuildEnv(options.env),
      stdio: "inherit",
    },
  );

  const moduleRelPath = moduleName.slice(1).split(":").join(path.sep);
  const moduleApkRoot = path.join(
    resolvedProject,
    moduleRelPath,
    "build",
    "outputs",
    "apk",
    options.mode,
  );
  const builtApk = findFirstApk(moduleApkRoot) ?? findFirstApk(path.join(resolvedProject, moduleRelPath, "build", "outputs", "apk"));
  if (!builtApk) {
    throw new Error(`Gradle task ${assembleTask} did not produce an APK under ${moduleApkRoot}.`);
  }

  const outputApk = path.resolve(options.cwd, options.apkOutputPath);
  fs.mkdirSync(path.dirname(outputApk), { recursive: true });
  fs.copyFileSync(builtApk, outputApk);
}

function resolveAndroidBuildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.ANDROID_HOME || env.ANDROID_SDK_ROOT) {
    return env;
  }

  const homeDir = os.homedir();
  const candidates =
    process.platform === "darwin"
      ? [
          path.join(homeDir, "Library", "Android", "sdk"),
        ]
      : process.platform === "win32"
        ? [
            path.join(env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local"), "Android", "Sdk"),
          ]
        : [
            path.join(homeDir, "Android", "Sdk"),
          ];

  const found = candidates.find((dir) => fs.existsSync(dir));
  if (!found) {
    return env;
  }

  return {
    ...env,
    ANDROID_HOME: found,
  };
}

function collectProjectAddonAars(projectDir: string, mode: ExportMode): string[] {
  const addonsDir = path.join(projectDir, "addons");
  if (!fs.existsSync(addonsDir)) {
    return [];
  }

  const results: string[] = [];
  const visit = (dirPath: string): void => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".aar")) {
        continue;
      }

      const oppositeMode = mode === "debug"
        ? "release"
        : "debug";
      const normalized = fullPath.toLowerCase();
      if (normalized.includes(`-${oppositeMode}.aar`) || normalized.includes(`/${oppositeMode}/`)) {
        continue;
      }
      results.push(fullPath);
    }
  };

  visit(addonsDir);
  return results.sort();
}

function findFirstAar(dirPath: string): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const aar = entries.find((entry) => entry.isFile() && entry.name.endsWith(".aar"));
  return aar
    ? path.join(dirPath, aar.name)
    : undefined;
}

function findFirstApk(dirPath: string): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findFirstApk(fullPath);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".apk")) {
      return fullPath;
    }
  }

  return undefined;
}

async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  if (process.platform === "win32") {
    await execa("tar", ["-xf", archivePath, "-C", targetDir]);
    return;
  }

  await execa("unzip", [
    "-q",
    "-o",
    archivePath,
    "-d",
    targetDir,
  ]);
}

interface AndroidMonoArchSpec {
  abi: string;
  rids: readonly [string, string];
}

const ANDROID_MONO_ARCH_MAP: Record<string, AndroidMonoArchSpec> = {
  "arm32": {
    abi: "armeabi-v7a",
    rids: ["android-arm", "linux-bionic-arm"],
  },
  "arm64": {
    abi: "arm64-v8a",
    rids: ["android-arm64", "linux-bionic-arm64"],
  },
  "arm64-v8a": {
    abi: "arm64-v8a",
    rids: ["android-arm64", "linux-bionic-arm64"],
  },
  "armeabi-v7a": {
    abi: "armeabi-v7a",
    rids: ["android-arm", "linux-bionic-arm"],
  },
  "x86": {
    abi: "x86",
    rids: ["android-x86", "linux-bionic-x86"],
  },
  "x86_64": {
    abi: "x86_64",
    rids: ["android-x64", "linux-bionic-x64"],
  },
};

const DOTNET_CRYPTO_JAR_NAME = "libSystem.Security.Cryptography.Native.Android.jar";

async function stageDotnetAndroidNativeArtifacts(options: {
  csproj?: string;
  env?: NodeJS.ProcessEnv;
  godotBuildDir: string;
  mode: ExportMode;
  preset: string;
  projectDir: string;
}): Promise<void> {
  const monoPublishRoot = path.join(
    options.godotBuildDir,
    "src",
    "main",
    "assets",
    ".godot",
    "mono",
    "publish",
  );
  if (!fs.existsSync(monoPublishRoot)) {
    return;
  }

  const archDirs = fs
    .readdirSync(monoPublishRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (archDirs.length === 0) {
    return;
  }

  const jniLibsRoot = path.join(options.godotBuildDir, "src", "main", "jniLibs");
  const embedLibsDir = path.join(options.godotBuildDir, "embed-libs");
  fs.mkdirSync(embedLibsDir, { recursive: true });

  const exportedSpecs = new Map<string, { archDir: string; spec: AndroidMonoArchSpec }>();
  for (const archDir of archDirs) {
    const spec = ANDROID_MONO_ARCH_MAP[archDir];
    if (spec && !exportedSpecs.has(spec.abi)) {
      exportedSpecs.set(spec.abi, { archDir, spec });
    }
  }

  if (exportedSpecs.size > 0 && fs.existsSync(jniLibsRoot)) {
    for (const entry of fs.readdirSync(jniLibsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !exportedSpecs.has(entry.name)) {
        fs.rmSync(path.join(jniLibsRoot, entry.name), { force: true, recursive: true });
      }
    }
  }

  const preferredConfigs = options.mode === "debug"
    ? ["ExportDebug", "ExportRelease"]
    : ["ExportRelease", "ExportDebug"];

  for (const { archDir, spec } of exportedSpecs.values()) {
    const abiTargetDir = path.join(jniLibsRoot, spec.abi);
    fs.mkdirSync(abiTargetDir, { recursive: true });

    const existingRuntimeDir = findExistingDotnetAndroidRuntimeDir({
      archDir,
      monoPublishRoot,
      preferredConfigs,
      projectDir: options.projectDir,
      rids: spec.rids,
    });
    if (existingRuntimeDir) {
      copyDotnetRuntimeArtifacts(existingRuntimeDir, abiTargetDir, embedLibsDir);
      continue;
    }

    const csprojPath = resolveProjectCsprojPath(options.projectDir, options.csproj);
    if (!csprojPath) {
      continue;
    }

    const useLinuxBionic = readOptionalLinuxBionicPresetOption(options.projectDir, options.preset);
    const tempDotnetDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirie-android-dotnet-"));
    try {
      const rid = useLinuxBionic ? spec.rids[1] : spec.rids[0];
      const dotnetConfig = options.mode === "release"
        ? "ExportRelease"
        : "ExportDebug";
      const publishDir = path.join(tempDotnetDir, "publish");
      await execa(
        "dotnet",
        [
          "publish",
          csprojPath,
          "-c",
          dotnetConfig,
          "-r",
          rid,
          "--self-contained",
          "true",
          "-p:GodotTargetPlatform=android",
          `-p:BaseIntermediateOutputPath=${path.join(tempDotnetDir, "obj")}${path.sep}`,
          `-p:BaseOutputPath=${path.join(tempDotnetDir, "bin")}${path.sep}`,
          "-o",
          publishDir,
        ],
        {
          cwd: tempDotnetDir,
          env: options.env,
          stdio: "inherit",
        },
      );
      copyDotnetRuntimeArtifacts(publishDir, abiTargetDir, embedLibsDir);
    } finally {
      fs.rmSync(tempDotnetDir, { force: true, recursive: true });
    }
  }
}

function readOptionalLinuxBionicPresetOption(projectDir: string, presetName: string): boolean {
  const preset = listExportPresets(projectDir).find((item) => item.name === presetName);
  return preset?.options["dotnet/android_use_linux_bionic"] === true;
}

function findExistingDotnetAndroidRuntimeDir(options: {
  archDir: string;
  monoPublishRoot: string;
  preferredConfigs: string[];
  projectDir: string;
  rids: readonly string[];
}): string | undefined {
  const candidates: string[] = [
    path.join(options.monoPublishRoot, options.archDir),
  ];
  const tempBinRoot = path.join(options.projectDir, ".godot", "mono", "temp", "bin");
  for (const configName of options.preferredConfigs) {
    for (const rid of options.rids) {
      candidates.push(path.join(tempBinRoot, configName, rid, "publish"));
      candidates.push(path.join(tempBinRoot, configName, rid));
    }
  }

  return candidates.find((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith(".so"));
  });
}

function copyDotnetRuntimeArtifacts(
  sourceDir: string,
  abiTargetDir: string,
  embedLibsDir: string,
): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".so")) {
      fs.copyFileSync(
        path.join(sourceDir, entry.name),
        path.join(abiTargetDir, entry.name),
      );
      continue;
    }
    if (entry.name === DOTNET_CRYPTO_JAR_NAME) {
      const targetJar = path.join(embedLibsDir, DOTNET_CRYPTO_JAR_NAME);
      if (!fs.existsSync(targetJar)) {
        fs.copyFileSync(path.join(sourceDir, entry.name), targetJar);
      }
    }
  }
}

function resolveProjectCsprojPath(projectDir: string, explicitCsproj?: string): string | undefined {
  if (explicitCsproj) {
    const resolved = path.resolve(projectDir, explicitCsproj);
    return fs.existsSync(resolved)
      ? resolved
      : undefined;
  }

  if (!fs.existsSync(projectDir)) {
    return undefined;
  }

  const csprojEntry = fs
    .readdirSync(projectDir, { withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(".csproj"));
  return csprojEntry
    ? path.join(projectDir, csprojEntry.name)
    : undefined;
}

function stageGodotAndroidJars(godotBuildDir: string): void {
  const embedLibsDir = path.join(godotBuildDir, "embed-libs");
  fs.mkdirSync(embedLibsDir, { recursive: true });

  const unpackedClassesJar = path.join(godotBuildDir, "godot-lib-unpacked", "classes.jar");
  if (fs.existsSync(unpackedClassesJar)) {
    fs.copyFileSync(unpackedClassesJar, path.join(embedLibsDir, "godot-lib.jar"));
  }

  const targetCryptoJar = path.join(embedLibsDir, DOTNET_CRYPTO_JAR_NAME);
  if (!fs.existsSync(targetCryptoJar)) {
    const monoPublishDir = path.join(
      godotBuildDir,
      "src",
      "main",
      "assets",
      ".godot",
      "mono",
      "publish",
    );
    const foundCryptoJar = findFirstNamedFile(monoPublishDir, DOTNET_CRYPTO_JAR_NAME);
    if (foundCryptoJar) {
      fs.copyFileSync(foundCryptoJar, targetCryptoJar);
    }
  }
}

function findFirstNamedFile(dirPath: string, fileName: string): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findFirstNamedFile(fullPath, fileName);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }

  return undefined;
}

function mergeGodotAndroidResources(godotBuildDir: string): void {
  const mainResDir = path.join(godotBuildDir, "src", "main", "res");
  fs.mkdirSync(mainResDir, { recursive: true });

  const unpackedResDir = path.join(godotBuildDir, "godot-lib-unpacked", "res");
  if (fs.existsSync(unpackedResDir)) {
    fs.cpSync(unpackedResDir, mainResDir, { recursive: true });
  }

  const valuesXmlPath = path.join(mainResDir, "values", "values.xml");
  const valuesXmlHasProjectName =
    fs.existsSync(valuesXmlPath) &&
    fs.readFileSync(valuesXmlPath, "utf8").includes("name=\"godot_project_name_string\"");

  const templateResDir = path.join(godotBuildDir, "res");
  if (fs.existsSync(templateResDir)) {
    for (const dirEntry of fs.readdirSync(templateResDir, { withFileTypes: true })) {
      if (!dirEntry.isDirectory()) {
        continue;
      }
      const sourceSubDir = path.join(templateResDir, dirEntry.name);
      const targetSubDir = path.join(mainResDir, dirEntry.name);
      fs.mkdirSync(targetSubDir, { recursive: true });

      for (const fileEntry of fs.readdirSync(sourceSubDir, { withFileTypes: true })) {
        if (!fileEntry.isFile()) {
          continue;
        }
        if (
          dirEntry.name === "values" &&
          fileEntry.name === "godot_project_name_string.xml" &&
          valuesXmlHasProjectName
        ) {
          continue;
        }
        fs.copyFileSync(
          path.join(sourceSubDir, fileEntry.name),
          path.join(targetSubDir, fileEntry.name),
        );
      }
    }
  }

  const projectNameXmlPath = path.join(mainResDir, "values", "godot_project_name_string.xml");
  if (!valuesXmlHasProjectName && !fs.existsSync(projectNameXmlPath)) {
    fs.mkdirSync(path.dirname(projectNameXmlPath), { recursive: true });
    fs.writeFileSync(
      projectNameXmlPath,
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="godot_project_name_string">godot-project-name</string>
</resources>
`,
    );
  }

  const providerPathsXml = path.join(mainResDir, "xml", "godot_provider_paths.xml");
  if (!fs.existsSync(providerPathsXml)) {
    fs.mkdirSync(path.dirname(providerPathsXml), { recursive: true });
    fs.writeFileSync(
      providerPathsXml,
      `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <files-path name="filesRoot" path="/" />
    <external-path name="public" path="." />
    <external-files-path name="app" path="." />
</paths>
`,
    );
  }
}

function readGodotLibraryVersionFromUnpackedManifest(godotBuildDir: string): string {
  const unpackedManifestPath = path.join(
    godotBuildDir,
    "godot-lib-unpacked",
    "AndroidManifest.xml",
  );
  if (!fs.existsSync(unpackedManifestPath)) {
    return "4.7.2.stable";
  }

  const xml = fs.readFileSync(unpackedManifestPath, "utf8");
  const match = xml.match(
    /android:name="org\.godotengine\.library\.version"\s+android:value="([^"]+)"/,
  );
  return match?.[1] ?? "4.7.2.stable";
}

function renderAndroidEmbedSettingsGradle(): string {
  return `pluginManagement {
    apply from: 'config.gradle'

    plugins {
        id 'com.android.library' version versions.androidGradlePlugin
        id 'org.jetbrains.kotlin.android' version versions.kotlinVersion
    }
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = 'kirie-godot-embed'
`;
}

function renderAndroidEmbedBuildGradle(): string {
  return `plugins {
    id 'com.android.library'
    id 'org.jetbrains.kotlin.android'
}

apply from: 'config.gradle'

repositories {
    google()
    mavenCentral()
}

android {
    namespace = 'org.godotengine.godot'
    compileSdkVersion versions.compileSdk
    buildToolsVersion versions.buildTools

    defaultConfig {
        minSdkVersion versions.minSdk
        aaptOptions {
            ignoreAssetsPattern "!.svn:!.git:!.gitignore:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
    }

    compileOptions {
        sourceCompatibility versions.javaVersion
        targetCompatibility versions.javaVersion
    }

    kotlinOptions {
        jvmTarget = versions.javaVersion.toString()
    }

    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
    }
}

dependencies {
    api fileTree(dir: 'embed-libs', include: ['*.jar'])
    api "androidx.fragment:fragment:$versions.fragmentVersion"
    implementation "androidx.documentfile:documentfile:$versions.documentfileVersion"
    implementation "androidx.core:core-splashscreen:$versions.splashscreenVersion"
}
`;
}

function renderAndroidEmbedLibraryManifest(godotLibraryVersion: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature
        android:glEsVersion="0x00030000"
        android:required="true" />

    <application>
        <meta-data
            android:name="org.godotengine.library.version"
            android:value="${godotLibraryVersion}" />
        <meta-data
            android:name="org.godotengine.plugin.v2.KirieHost"
            android:value="ai.moeru.kirie.host.KirieHostPlugin" />

        <activity
            android:name="org.godotengine.godot.utils.ProcessPhoenix"
            android:exported="false"
            android:process=":phoenix"
            android:theme="@android:style/Theme.Translucent.NoTitleBar" />

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/godot_provider_paths" />
        </provider>
    </application>
</manifest>
`;
}

function renderKirieHostPluginKotlin(): string {
  return `package ai.moeru.kirie.host

import android.os.Handler
import android.os.Looper
import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin
import org.godotengine.godot.plugin.SignalInfo
import org.godotengine.godot.plugin.UsedByGodot
import java.lang.ref.WeakReference

object KirieHostChannel {
    @Volatile
    var messageHandler: ((String) -> Unit)? = null

    @Volatile
    internal var activePlugin: WeakReference<KirieHostPlugin>? = null

    fun sendMessage(message: String) {
        activePlugin?.get()?.emitHostMessage(message)
    }
}

class KirieHostPlugin(godot: Godot) : GodotPlugin(godot) {
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        KirieHostChannel.activePlugin = WeakReference(this)
    }

    override fun getPluginName(): String = PLUGIN_NAME

    override fun getPluginSignals(): MutableSet<SignalInfo> =
        mutableSetOf(SignalInfo(HOST_MESSAGE_SIGNAL, String::class.java))

    @UsedByGodot
    fun send_to_host(message: String) {
        val handler = KirieHostChannel.messageHandler ?: return
        if (Looper.myLooper() == Looper.getMainLooper()) {
            handler(message)
        } else {
            mainHandler.post { handler(message) }
        }
    }

    override fun onMainDestroy() {
        if (KirieHostChannel.activePlugin?.get() === this) {
            KirieHostChannel.activePlugin = null
        }
        super.onMainDestroy()
    }

    internal fun emitHostMessage(message: String) {
        emitSignal(HOST_MESSAGE_SIGNAL, message)
    }

    companion object {
        const val PLUGIN_NAME = "KirieHost"
        const val HOST_MESSAGE_SIGNAL = "host_message_received"
    }
}
`;
}

function renderKirieGodotFragmentKotlin(): string {
  return `package ai.moeru.kirie.host

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import androidx.annotation.IdRes
import androidx.fragment.app.FragmentManager
import org.godotengine.godot.GodotFragment

/**
 * Helper for attaching Godot's embedded fragment inside an Android host Activity or Compose AndroidView.
 *
 * When rendering inside Android Studio Layout / Compose Previews (\`View.isInEditMode == true\`),
 * call [createPreviewSafeContainer] or check \`view.isInEditMode\` / \`LocalInspectionMode.current\`
 * before attaching [GodotFragment] so preview tooling never loads \`libgodot_android.so\`.
 */
object KirieGodotHost {
    const val DEFAULT_FRAGMENT_TAG = "kirie-godot-fragment"

    var onMessage: ((String) -> Unit)?
        get() = KirieHostChannel.messageHandler
        set(value) {
            KirieHostChannel.messageHandler = value
        }

    fun send(message: String) {
        KirieHostChannel.sendMessage(message)
    }

    fun attachFragment(
        fragmentManager: FragmentManager,
        @IdRes containerViewId: Int,
        isPreview: Boolean = false,
        tag: String = DEFAULT_FRAGMENT_TAG,
    ): GodotFragment? {
        if (isPreview) {
            return null
        }

        val existing = fragmentManager.findFragmentByTag(tag)
        if (existing is GodotFragment) {
            return existing
        }

        val created = GodotFragment()
        fragmentManager
            .beginTransaction()
            .replace(containerViewId, created, tag)
            .commitNowAllowingStateLoss()
        return created
    }

    fun createPreviewSafeContainer(
        context: Context,
        @IdRes containerViewId: Int,
    ): FrameLayout {
        val container = FrameLayout(context).apply { id = containerViewId }
        if (container.isInEditMode) {
            val label = TextView(context).apply {
                gravity = Gravity.CENTER
                text = "KirieGodotHost (Preview)"
            }
            container.addView(
                label,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
        }
        return container
    }
}
`;
}
