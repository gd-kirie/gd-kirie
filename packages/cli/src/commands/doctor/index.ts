import type { KiriePlugin } from "../../plugin/index.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { loadKirieConfig, type ResolvedKirieConfig } from "../config.ts";
import { checkGodotAddon, installGodotAddon } from "./addons.ts";
import { checkDotnetWebToolchain, installDotnetWebToolchain } from "./dotnet-web.ts";
import { getDotnetDependencyReference, hasDotnetProject, installDotnetPackage } from "./dotnet.ts";

export const DoctorCheckStatus = {
  Fail: "fail",
  Ok: "ok",
  Warn: "warn",
} as const;
export type DoctorCheckStatus = (typeof DoctorCheckStatus)[keyof typeof DoctorCheckStatus];

export type DoctorTarget = "web" | `plugin:${string}`;

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

interface TemplatePathOptions {
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

  const webTarget = options.target === "web";
  const plugins = webTarget ? [] : selectPlugins(config.plugins, options.target);
  if (options.fix) {
    if (webTarget) {
      await installDotnetWebToolchain({
        arch: options.arch,
        godotArgs: config.godot.args,
        godotCommand: config.godot.command,
        homeDir: options.homeDir,
        platform: options.platform,
        projectDir: config.godot.project,
      });
    }

    for (const plugin of plugins) {
      await fixPluginDependencies(config, plugin);
    }
  }

  const checks = webTarget ?
      [await dotnetWebDoctorCheck(options)] :
    options.target ?
        await checkPlugins(config, plugins) :
        await runDoctorChecks({
          config,
          env: options.env,
          homeDir: options.homeDir,
          platform: options.platform,
        });

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
  config: ResolvedKirieConfig;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}): Promise<DoctorCheckResult[]> {
  // TODO: Check Godot EditorSettings for `export/android/java_sdk_path` and
  // verify that it points at a usable Java/JDK before Android export diagnostics pass.
  const godotCommand = await checkGodotCommand({
    godotArgs: options.config.godot.args,
    godotCommand: options.config.godot.command,
    projectDir: options.config.godot.project,
  });
  const exportTemplates = godotCommand.version ?
      await checkGodotExportTemplates({
        homeDir: options.homeDir,
        platform: options.platform,
        version: godotCommand.version,
      }) :
      {
        message: "skipped because the Godot version could not be detected",
        name: "Godot export templates",
        status: DoctorCheckStatus.Fail,
      };

  return [
    godotCommand.check,
    exportTemplates,
    await checkAndroidSdk(options.env),
    ...(await checkPlugins(options.config, options.config.plugins)),
  ];
}

async function checkPlugins(
  config: ResolvedKirieConfig,
  plugins: KiriePlugin[],
): Promise<DoctorCheckResult[]> {
  return (await Promise.all(
    plugins.map((plugin) => checkPluginDependencies(config, plugin)),
  )).flat();
}

async function checkPluginDependencies(
  config: ResolvedKirieConfig,
  plugin: KiriePlugin,
): Promise<DoctorCheckResult[]> {
  const checks: DoctorCheckResult[] = [];
  for (const addon of plugin.godotAddons ?? []) {
    try {
      const result = await checkGodotAddon(config.godot.project, addon);
      const missingOptional = addon.optional && !result.installed;
      checks.push({
        message: result.valid ?
          result.message :
          `${result.message} (run: pnpm kirie doctor --fix plugin:${plugin.id})`,
        name: `${plugin.id} / ${addon.id}`,
        status: result.valid ?
          DoctorCheckStatus.Ok :
          missingOptional ? DoctorCheckStatus.Warn : DoctorCheckStatus.Fail,
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
        message: reference?.type === "project" ?
          `local project reference ${reference.path}` :
          valid ?
            `${dependency.version} in ${config.godot.csproj ?? config.godot.project}` :
            `${reference?.version ?? "not installed"}; requires ${dependency.version} (run: pnpm kirie doctor --fix plugin:${plugin.id})`,
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
): Promise<void> {
  for (const addon of plugin.godotAddons ?? []) {
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
  const failure = error instanceof Error ? error : new Error(String(error), { cause: error });
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
        error instanceof Error ? error.message : String(error)
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

async function runGodotVersion(options: RunGodotVersionOptions): Promise<string> {
  const result = await execa(options.godotCommand, [...options.godotArgs, "--version"], {
    cwd: options.projectDir,
  });
  return result.stdout;
}

function parseGodotVersion(output: string): string {
  const [version] = output.trim().split(/\s+/, 1);
  if (!version) {
    throw new Error("empty version output");
  }

  return version.replace(/\.official\..*$/, "");
}

function resolveGodotExportTemplatesDir(options: TemplatePathOptions): string {
  if (options.platform === "darwin") {
    return path.join(
      options.homeDir,
      "Library",
      "Application Support",
      "Godot",
      "export_templates",
      options.version,
    );
  }

  if (options.platform === "win32") {
    return path.join(
      options.homeDir,
      "AppData",
      "Roaming",
      "Godot",
      "export_templates",
      options.version,
    );
  }

  return path.join(
    options.homeDir,
    ".local",
    "share",
    "godot",
    "export_templates",
    options.version,
  );
}
