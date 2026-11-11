import { existsSync, readdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listExportPresets,
  readExportPresetValue,
  resolveGradleWrapperPath,
  resolveXcodeSchemes,
} from "@gd-kirie/build";
import { execa } from "execa";

import {
  isAddonActiveForTarget,
  isPluginActiveForTarget,
  type KirieGodotAddonDependency,
  type KiriePlugin,
  type KirieTargetName,
} from "../../plugin/index.ts";
import {
  assertConfiguredTarget,
  getConfiguredTargets,
  loadKirieConfig,
  type ResolvedKirieConfig,
} from "../config.ts";
import { checkGodotAddon, installGodotAddon } from "./addons.ts";
import { checkDotnetWebToolchain, installDotnetWebToolchain } from "./dotnet-web.ts";
import { getDotnetDependencyReference, hasDotnetProject, installDotnetPackage } from "./dotnet.ts";

export const DoctorCheckStatus = {
  Fail: "fail",
  Ok: "ok",
  Warn: "warn",
} as const;
export type DoctorCheckStatus = (typeof DoctorCheckStatus)[keyof typeof DoctorCheckStatus];

export type DoctorTarget = KirieTargetName | `plugin:${string}`;

export interface DoctorCheckResult {
  error?: Error;
  message: string;
  name: string;
  status: DoctorCheckStatus;
}

export interface DoctorOptions {
  arch?: NodeJS.Architecture;
  config?: ResolvedKirieConfig;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fix?: boolean;
  homeDir?: string;
  platform?: NodeJS.Platform;
  target?: DoctorTarget;
}

export interface CheckGodotCommandOptions {
  godotArgs: string[];
  godotCommand: string;
  projectDir: string;
  runGodotVersion?: (options: RunGodotVersionOptions) => Promise<string>;
}

export interface CheckGodotExportTemplatesOptions {
  homeDir?: string;
  platform?: NodeJS.Platform;
  version: string;
}

export interface GodotCommandCheckResult {
  check: DoctorCheckResult;
  version?: string;
}

interface RunGodotVersionOptions {
  godotArgs: string[];
  godotCommand: string;
  projectDir: string;
}

export interface TemplatePathOptions {
  homeDir: string;
  platform: NodeJS.Platform;
  version: string;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));

  const isPluginTarget = Boolean(options.target?.startsWith("plugin:"));
  if (isPluginTarget) {
    const selectedPlugins = selectPlugins(config.plugins, options.target);
    const activeTargets = getConfiguredTargets(config);
    if (options.fix) {
      for (const plugin of selectedPlugins) {
        await fixPluginDependencies(config, plugin, activeTargets);
      }
    }

    const checks = await checkPlugins(config, selectedPlugins, activeTargets);
    reportAndThrowOnFailures(checks);
    return;
  }

  const targetNames: KirieTargetName[] = options.target
    ? [options.target as KirieTargetName]
    : getConfiguredTargets(config);

  if (options.target) {
    assertConfiguredTarget(config, options.target as KirieTargetName, "kirie doctor");
  }

  if (options.fix) {
    if (targetNames.includes("web") && (options.target === "web" || await projectUsesDotnet(config))) {
      await installDotnetWebToolchain({
        arch: options.arch,
        godotArgs: config.godot.args,
        godotCommand: config.godot.command,
        homeDir: options.homeDir,
        platform: options.platform,
        projectDir: config.godot.project,
      });
    }

    await repairGodotExportPresetsForTargets(config, targetNames);

    const activePlugins = selectPluginsForTargets(config.plugins, targetNames);
    for (const plugin of activePlugins) {
      await fixPluginDependencies(config, plugin, targetNames);
    }
  }

  const checks = options.target === "web"
    ? [
        await dotnetWebDoctorCheck(options),
        ...(await checkPlugins(config, selectPluginsForTargets(config.plugins, ["web"]), ["web"])),
      ]
    : await runDoctorChecks({
        arch: options.arch,
        config,
        env: options.env,
        homeDir: options.homeDir,
        platform: options.platform,
        targets: targetNames,
      });

  reportAndThrowOnFailures(checks);
}

function reportAndThrowOnFailures(checks: DoctorCheckResult[]): void {
  for (const check of checks) {
    console.log(`${check.status} ${check.name}: ${check.message}`);
  }

  const failures = checks.filter((check) => check.status === DoctorCheckStatus.Fail);
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error ?? new Error(`${failure.name}: ${failure.message}`)),
      `kirie doctor found ${failures.length} problem(s).`,
    );
  }
}

export async function runDoctorChecks(options: {
  arch?: NodeJS.Architecture;
  config: ResolvedKirieConfig;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  targets?: readonly KirieTargetName[];
}): Promise<DoctorCheckResult[]> {
  const targets = options.targets ?? getConfiguredTargets(options.config);
  const godotCommand = await checkGodotCommand({
    godotArgs: options.config.godot.args,
    godotCommand: options.config.godot.command,
    projectDir: options.config.godot.project,
  });
  const exportTemplates = godotCommand.version
    ? await checkGodotExportTemplates({
        homeDir: options.homeDir,
        platform: options.platform,
        version: godotCommand.version,
      })
    : {
        message: "skipped because the Godot version could not be detected",
        name: "Godot export templates",
        status: DoctorCheckStatus.Fail,
      };

  const checks: DoctorCheckResult[] = [godotCommand.check, exportTemplates];

  for (const target of targets) {
    switch (target) {
      case "android":
        checks.push(await checkAndroidSdk(options.env));
        checks.push(...checkAndroidTargetConfig(options.config, options.platform));
        break;
      case "ios":
        checks.push(...(await checkIosTargetConfig(options.config, options.platform)));
        break;
      case "web":
        if (await projectUsesDotnet(options.config)) {
          checks.push(
            await dotnetWebDoctorCheck({
              arch: options.arch,
              homeDir: options.homeDir,
              platform: options.platform,
            }),
          );
        }
        break;
      case "desktop":
        break;
    }
  }

  const activePlugins = selectPluginsForTargets(options.config.plugins, targets);
  checks.push(...(await checkPlugins(options.config, activePlugins, targets)));
  return checks;
}

function checkAndroidTargetConfig(
  config: ResolvedKirieConfig,
  platform: NodeJS.Platform = process.platform,
): DoctorCheckResult[] {
  const androidTarget = config.targets.android;
  if (!androidTarget) {
    return [];
  }

  const checks: DoctorCheckResult[] = [];
  const presetName = androidTarget.preset ?? "Android";
  const presetsPath = path.join(config.godot.project, "export_presets.cfg");

  if (existsSync(presetsPath)) {
    const presets = listExportPresets(config.godot.project);
    const matching = presets.find((item) => item.name === presetName);
    if (!matching) {
      checks.push({
        message: `preset "${presetName}" not found in ${presetsPath}`,
        name: "Android export preset",
        status: DoctorCheckStatus.Fail,
      });
    } else if (androidTarget.host === "godot" && config.web) {
      try {
        const internet = readExportPresetValue({
          optionName: "permissions/internet",
          presetName,
          projectDir: config.godot.project,
        });
        checks.push({
          message: internet === true
            ? `${presetName} (permissions/internet=true)`
            : `${presetName} requires permissions/internet=true (run: pnpm kirie doctor --fix android)`,
          name: "Android export preset",
          status: internet === true
            ? DoctorCheckStatus.Ok
            : DoctorCheckStatus.Fail,
        });
      } catch {
        checks.push({
          message: `${presetName} requires permissions/internet=true (run: pnpm kirie doctor --fix android)`,
          name: "Android export preset",
          status: DoctorCheckStatus.Fail,
        });
      }
    } else {
      checks.push({
        message: presetName,
        name: "Android export preset",
        status: DoctorCheckStatus.Ok,
      });
    }
  }

  if (androidTarget.host === "native" && androidTarget.project) {
    const hostProjectDir = path.resolve(config.cwd, androidTarget.project);
    const gradlew = resolveGradleWrapperPath(hostProjectDir, platform);
    if (!existsSync(hostProjectDir)) {
      checks.push({
        message: `Android host project directory does not exist: ${hostProjectDir}`,
        name: "Android native host project",
        status: DoctorCheckStatus.Fail,
      });
    } else if (!existsSync(gradlew)) {
      checks.push({
        message: `Gradle wrapper not found at ${gradlew}`,
        name: "Android native host project",
        status: DoctorCheckStatus.Fail,
      });
    } else {
      checks.push({
        message: `${hostProjectDir} (${androidTarget.module ?? ":app"})`,
        name: "Android native host project",
        status: DoctorCheckStatus.Ok,
      });
    }
  }

  return checks;
}

async function checkIosTargetConfig(
  config: ResolvedKirieConfig,
  platform: NodeJS.Platform = process.platform,
): Promise<DoctorCheckResult[]> {
  const iosTarget = config.targets.ios;
  if (!iosTarget) {
    return [];
  }

  const checks: DoctorCheckResult[] = [];
  if (platform !== "darwin") {
    checks.push({
      message: `iOS builds require macOS (current platform: ${platform})`,
      name: "Xcode toolchain",
      status: DoctorCheckStatus.Fail,
    });
    return checks;
  }

  try {
    const xcodeResult = await execa("xcodebuild", ["-version"], { cwd: config.cwd });
    const firstLine = xcodeResult.stdout.trim().split(/\r?\n/, 1)[0] ?? "xcodebuild";
    checks.push({
      message: firstLine,
      name: "Xcode toolchain",
      status: DoctorCheckStatus.Ok,
    });
  } catch (error) {
    checks.push(failedCheck("Xcode toolchain", error));
  }

  const presetName = iosTarget.preset ?? "iOS";
  const presetsPath = path.join(config.godot.project, "export_presets.cfg");
  if (existsSync(presetsPath)) {
    const presets = listExportPresets(config.godot.project);
    const matching = presets.find((item) => item.name === presetName);
    if (!matching) {
      checks.push({
        message: `preset "${presetName}" not found in ${presetsPath}`,
        name: "iOS export preset",
        status: DoctorCheckStatus.Fail,
      });
    } else {
      try {
        const projectOnly = readExportPresetValue({
          optionName: "application/export_project_only",
          presetName,
          projectDir: config.godot.project,
        });
        checks.push({
          message: projectOnly === true
            ? `${presetName} (application/export_project_only=true)`
            : `${presetName} requires application/export_project_only=true (run: pnpm kirie doctor --fix ios)`,
          name: "iOS export preset",
          status: projectOnly === true
            ? DoctorCheckStatus.Ok
            : DoctorCheckStatus.Fail,
        });
      } catch {
        checks.push({
          message: `${presetName} requires application/export_project_only=true (run: pnpm kirie doctor --fix ios)`,
          name: "iOS export preset",
          status: DoctorCheckStatus.Fail,
        });
      }
    }
  }

  if (iosTarget.host === "native" && iosTarget.project) {
    const hostProjectPath = path.resolve(config.cwd, iosTarget.project);
    if (!existsSync(hostProjectPath)) {
      checks.push({
        message: `Xcode project/workspace not found: ${hostProjectPath}`,
        name: "iOS native host project",
        status: DoctorCheckStatus.Fail,
      });
    } else {
      try {
        const schemes = await resolveXcodeSchemes(hostProjectPath, config.cwd);
        if (iosTarget.scheme && !schemes.includes(iosTarget.scheme)) {
          checks.push({
            message: `scheme "${iosTarget.scheme}" not found in ${hostProjectPath} (available: ${schemes.join(", ") || "none"})`,
            name: "iOS native host project",
            status: DoctorCheckStatus.Fail,
          });
        } else if (!iosTarget.scheme && schemes.length !== 1) {
          checks.push({
            message: schemes.length === 0
              ? `no shared schemes found in ${hostProjectPath}; set targets.ios.scheme`
              : `multiple schemes found (${schemes.join(", ")}); set targets.ios.scheme in kirie.config.ts`,
            name: "iOS native host project",
            status: DoctorCheckStatus.Fail,
          });
        } else {
          checks.push({
            message: `${hostProjectPath} (${iosTarget.scheme ?? schemes[0]})`,
            name: "iOS native host project",
            status: DoctorCheckStatus.Ok,
          });
        }
      } catch (error) {
        checks.push(failedCheck("iOS native host project", error));
      }
    }
  }

  return checks;
}

async function repairGodotExportPresetsForTargets(
  config: ResolvedKirieConfig,
  targets: readonly KirieTargetName[],
): Promise<void> {
  const presetsPath = path.join(config.godot.project, "export_presets.cfg");
  if (!existsSync(presetsPath)) {
    return;
  }

  const patches: Array<{ option: string; presetName: string; valueLiteral: string }> = [];
  if (targets.includes("ios") && config.targets.ios) {
    const presetName = config.targets.ios.preset ?? "iOS";
    if (!hasPresetBooleanTrue(config.godot.project, presetName, "application/export_project_only")) {
      patches.push({
        option: "application/export_project_only",
        presetName,
        valueLiteral: "true",
      });
    }
  }

  if (targets.includes("android") && config.targets.android?.host === "godot" && config.web) {
    const presetName = config.targets.android.preset ?? "Android";
    if (!hasPresetBooleanTrue(config.godot.project, presetName, "permissions/internet")) {
      patches.push({
        option: "permissions/internet",
        presetName,
        valueLiteral: "true",
      });
    }
  }

  if (patches.length === 0) {
    return;
  }

  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-doctor-preset-fix-"));
  try {
    const scriptPath = path.join(temporaryDir, "repair_presets.gd");
    const statements = patches
      .map(
        (patch) =>
          `        if preset_name == ${JSON.stringify(patch.presetName)}:\n` +
          `            config.set_value(options_section, ${JSON.stringify(patch.option)}, ${patch.valueLiteral})\n` +
          `            changed = true`,
      )
      .join("\n");

    await fs.writeFile(
      scriptPath,
      `extends SceneTree

func _init() -> void:
    var preset_path := ProjectSettings.globalize_path("res://export_presets.cfg")
    var config := ConfigFile.new()
    if config.load(preset_path) != OK:
        push_error("Could not load export_presets.cfg.")
        quit(2)
        return

    var changed := false
    var index := 0
    while config.has_section("preset.%d" % index):
        var section := "preset.%d" % index
        var preset_name := str(config.get_value(section, "name", ""))
        var options_section := "%s.options" % section
${statements}
        index += 1

    if changed and config.save(preset_path) != OK:
        push_error("Could not save export_presets.cfg.")
        quit(2)
        return
    quit()
`,
    );

    await execa(
      config.godot.command,
      [
        ...config.godot.args,
        "--headless",
        "--path",
        config.godot.project,
        "--script",
        scriptPath,
      ],
      {
        cwd: config.godot.project,
        stdio: "inherit",
      },
    );
  } finally {
    await fs.rm(temporaryDir, { force: true, recursive: true });
  }
}

function hasPresetBooleanTrue(
  projectDir: string,
  presetName: string,
  optionName: string,
): boolean {
  try {
    return readExportPresetValue({ optionName, presetName, projectDir }) === true;
  } catch {
    return false;
  }
}

function selectPluginsForTargets(
  plugins: KiriePlugin[],
  targets: readonly KirieTargetName[],
): KiriePlugin[] {
  return plugins.filter((plugin) =>
    targets.some((target) => isPluginActiveForTarget(plugin, target)),
  );
}

function filterAddonsForTargets(
  plugin: KiriePlugin,
  targets: readonly KirieTargetName[],
): KirieGodotAddonDependency[] {
  const matchingTargets = targets.filter((target) => isPluginActiveForTarget(plugin, target));
  if (matchingTargets.length === 0) {
    return [];
  }

  return (plugin.godotAddons ?? []).filter((addon) =>
    matchingTargets.some((target) => isAddonActiveForTarget(addon, target)),
  );
}

async function checkPlugins(
  config: ResolvedKirieConfig,
  plugins: KiriePlugin[],
  targets: readonly KirieTargetName[],
): Promise<DoctorCheckResult[]> {
  return (await Promise.all(
    plugins.map((plugin) => checkPluginDependencies(config, plugin, targets)),
  )).flat();
}

async function checkPluginDependencies(
  config: ResolvedKirieConfig,
  plugin: KiriePlugin,
  targets: readonly KirieTargetName[],
): Promise<DoctorCheckResult[]> {
  const checks: DoctorCheckResult[] = [];
  for (const addon of filterAddonsForTargets(plugin, targets)) {
    try {
      const result = await checkGodotAddon(config.godot.project, addon);
      const missingOptional = addon.optional && !result.installed;
      checks.push({
        message: result.valid
          ? result.message
          : `${result.message} (run: pnpm kirie doctor --fix plugin:${plugin.id})`,
        name: `${plugin.id} / ${addon.id}`,
        status: result.valid
          ? DoctorCheckStatus.Ok
          : missingOptional ? DoctorCheckStatus.Warn : DoctorCheckStatus.Fail,
      });
    } catch (error) {
      checks.push(failedCheck(`${plugin.id} / ${addon.id}`, error));
    }
  }

  const dotnetPackages = plugin.dotnetPackages ?? [];
  if (dotnetPackages.length === 0 || !(await projectUsesDotnet(config))) {
    return checks;
  }

  for (const dependency of dotnetPackages) {
    try {
      const reference = await getDotnetDependencyReference({
        csproj: config.godot.csproj,
        dependency,
        projectDir: config.godot.project,
      });
      const valid = reference?.type === "project" || reference?.version === dependency.version;
      checks.push({
        message: reference?.type === "project"
          ? `local project reference ${reference.path}`
          : valid
            ? `${dependency.version} in ${config.godot.csproj ?? config.godot.project}`
            : `${reference?.version ?? "not installed"}; requires ${dependency.version} (run: pnpm kirie doctor --fix plugin:${plugin.id})`,
        name: `${plugin.id} / ${dependency.id}`,
        status: valid ? DoctorCheckStatus.Ok : DoctorCheckStatus.Fail,
      });
    } catch (error) {
      checks.push(failedCheck(`${plugin.id} / ${dependency.id}`, error));
    }
  }

  return checks;
}

async function fixPluginDependencies(
  config: ResolvedKirieConfig,
  plugin: KiriePlugin,
  targets: readonly KirieTargetName[],
): Promise<void> {
  for (const addon of filterAddonsForTargets(plugin, targets)) {
    await installGodotAddon({ addon, projectDir: config.godot.project });
  }

  const dotnetPackages = plugin.dotnetPackages ?? [];
  if (dotnetPackages.length === 0 || !(await projectUsesDotnet(config))) {
    return;
  }

  for (const dependency of dotnetPackages) {
    const options = {
      csproj: config.godot.csproj,
      dependency,
      projectDir: config.godot.project,
    };
    const reference = await getDotnetDependencyReference(options);
    if (reference?.type !== "project" && reference?.version !== dependency.version) {
      await installDotnetPackage(options);
    }
  }
}

async function projectUsesDotnet(config: ResolvedKirieConfig): Promise<boolean> {
  return hasDotnetProject({
    csproj: config.godot.csproj,
    projectDir: config.godot.project,
  });
}

async function dotnetWebDoctorCheck(options: {
  arch?: NodeJS.Architecture;
  homeDir?: string;
  platform?: NodeJS.Platform;
}): Promise<DoctorCheckResult> {
  const result = await checkDotnetWebToolchain(options);
  return {
    message: result.message,
    name: "Experimental Godot .NET Web toolchain",
    status: result.valid ? DoctorCheckStatus.Ok : DoctorCheckStatus.Fail,
  };
}

function failedCheck(name: string, error: unknown): DoctorCheckResult {
  const failure = error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
  return {
    error: failure,
    message: failure.message,
    name,
    status: DoctorCheckStatus.Fail,
  };
}

function selectPlugins(plugins: KiriePlugin[], target?: DoctorTarget): KiriePlugin[] {
  if (!target) {
    return plugins;
  }

  const id = target.slice("plugin:".length);
  const plugin = plugins.find((candidate) => candidate.id === id);
  if (!plugin) {
    throw new Error(`Kirie plugin is not configured: ${id}`);
  }

  return [plugin];
}

export async function checkGodotCommand(
  options: CheckGodotCommandOptions,
): Promise<GodotCommandCheckResult> {
  try {
    const version = parseGodotVersion(
      await (options.runGodotVersion ?? runGodotVersion)({
        godotArgs: options.godotArgs,
        godotCommand: options.godotCommand,
        projectDir: options.projectDir,
      }),
    );

    return {
      check: {
        message: version,
        name: "Godot command",
        status: DoctorCheckStatus.Ok,
      },
      version,
    };
  } catch (error) {
    const failure = new Error(
      `could not run ${options.godotCommand} --version: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
      { cause: error },
    );
    return {
      check: {
        error: failure,
        message: failure.message,
        name: "Godot command",
        status: DoctorCheckStatus.Fail,
      },
    };
  }
}

export async function checkGodotExportTemplates(
  options: CheckGodotExportTemplatesOptions,
): Promise<DoctorCheckResult> {
  const templatesDir = resolveGodotExportTemplatesDir({
    homeDir: options.homeDir ?? os.homedir(),
    platform: options.platform ?? process.platform,
    version: options.version,
  });
  const missingMessage = `missing templates for Godot ${options.version} at ${templatesDir}`;

  if (!existsSync(templatesDir) || readdirSync(templatesDir).length === 0) {
    return {
      message: missingMessage,
      name: "Godot export templates",
      status: DoctorCheckStatus.Fail,
    };
  }

  return {
    message: templatesDir,
    name: "Godot export templates",
    status: DoctorCheckStatus.Ok,
  };
}

export async function checkAndroidSdk(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorCheckResult> {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) {
    return {
      message: "set ANDROID_HOME to the Android SDK directory",
      name: "Android SDK",
      status: DoctorCheckStatus.Fail,
    };
  }
  const invalidSdkMessage = `${sdk} does not exist or is not a directory`;
  const sdkStat = statSync(sdk, { throwIfNoEntry: false });
  if (!sdkStat?.isDirectory()) {
    return {
      message: invalidSdkMessage,
      name: "Android SDK",
      status: DoctorCheckStatus.Fail,
    };
  }

  return {
    message: `${env.ANDROID_HOME ? "ANDROID_HOME" : "ANDROID_SDK_ROOT"}=${sdk}`,
    name: "Android SDK",
    status: DoctorCheckStatus.Ok,
  };
}

export async function detectGodotVersion(options: {
  godotArgs: string[];
  godotCommand: string;
  projectDir: string;
}): Promise<string> {
  const output = await runGodotVersion(options);
  return parseGodotVersion(output);
}

async function runGodotVersion(options: RunGodotVersionOptions): Promise<string> {
  const result = await execa(options.godotCommand, [...options.godotArgs, "--version"], {
    cwd: options.projectDir,
  });
  return result.stdout;
}

export function parseGodotVersion(output: string): string {
  const [version] = output.trim().split(/\s+/, 1);
  if (!version) {
    throw new Error("empty version output");
  }

  return version.replace(/\.official\..*$/, "");
}

export function resolveGodotExportTemplatesRootDir(
  options: { homeDir?: string; platform?: NodeJS.Platform } = {},
): string {
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;

  if (platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
    );
  }

  if (platform === "win32") {
    return path.join(homeDir, "AppData", "Roaming", "Godot", "export_templates");
  }

  return path.join(homeDir, ".local", "share", "godot", "export_templates");
}

export function resolveGodotExportTemplatesDir(options: TemplatePathOptions): string {
  return path.join(
    resolveGodotExportTemplatesRootDir({
      homeDir: options.homeDir,
      platform: options.platform,
    }),
    options.version,
  );
}
