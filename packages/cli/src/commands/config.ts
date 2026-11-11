import type { UserConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  isAddonActiveForTarget,
  isPluginActiveForTarget,
  type KirieGodotAddonDependency,
  type KiriePlugin,
  type KirieTargetName,
} from "../plugin/index.ts";

export interface LoadKirieConfigOptions {
  command?: "build" | "serve";
  cwd?: string;
  mode?: string;
}

export interface KirieConfigEnv {
  command: "build" | "serve";
  mode: string;
}

export interface KirieGodotConfig {
  args?: string[];
  command?: string;
  csproj?: string;
  project?: string;
}

export interface KirieGodotTargetConfig {
  host: "godot";
  preset?: string;
}

export interface KirieIosNativeTargetConfig {
  host: "native";
  preset?: string;
  project?: string;
  scheme?: string;
}

export type KirieIosTargetConfig = KirieGodotTargetConfig | KirieIosNativeTargetConfig;

export interface KirieAndroidNativeTargetConfig {
  host: "native";
  module?: string;
  preset?: string;
  project?: string;
}

export type KirieAndroidTargetConfig = KirieGodotTargetConfig | KirieAndroidNativeTargetConfig;

export interface KirieTargetsConfig {
  android?: KirieAndroidTargetConfig;
  desktop?: KirieGodotTargetConfig;
  ios?: KirieIosTargetConfig;
  web?: KirieGodotTargetConfig;
}

export interface KirieConfig {
  godot?: KirieGodotConfig;
  plugins?: KiriePlugin[];
  targets: KirieTargetsConfig;
}

export type KirieConfigFactory = (env: KirieConfigEnv) => KirieConfig | Promise<KirieConfig>;
export type KirieConfigExport = KirieConfig | Promise<KirieConfig> | KirieConfigFactory;

export interface ResolvedKirieWebConfig {
  pluginId: string;
  root: string;
  vite: UserConfig;
}

export interface ResolvedKirieTargets {
  android?: KirieAndroidTargetConfig;
  desktop?: KirieGodotTargetConfig;
  ios?: KirieIosTargetConfig;
  web?: KirieGodotTargetConfig;
}

export interface ResolvedKirieConfig {
  configFile?: string;
  cwd: string;
  godot: {
    args: string[];
    command: string;
    csproj?: string;
    project: string;
  };
  mode: string;
  plugins: KiriePlugin[];
  targets: ResolvedKirieTargets;
  web?: ResolvedKirieWebConfig;
}

const ALL_TARGET_NAMES: readonly KirieTargetName[] = ["desktop", "ios", "android", "web"];
const ALLOWED_TOP_LEVEL_KEYS = new Set(["godot", "plugins", "targets"]);
const ALLOWED_GODOT_KEYS = new Set(["args", "command", "csproj", "project"]);
const ALLOWED_DESKTOP_OR_WEB_TARGET_KEYS = new Set(["host", "preset"]);
const ALLOWED_IOS_TARGET_KEYS = new Set(["host", "preset", "project", "scheme"]);
const ALLOWED_ANDROID_TARGET_KEYS = new Set(["host", "module", "preset", "project"]);

let configImportSequence = 0;

export function defineKirieConfig(config: KirieConfig): KirieConfig;
export function defineKirieConfig(config: KirieConfigFactory): KirieConfigFactory;
export function defineKirieConfig(
  config: KirieConfig | KirieConfigFactory,
): KirieConfig | KirieConfigFactory {
  return config;
}

export async function loadKirieConfig(
  options: LoadKirieConfigOptions = {},
): Promise<ResolvedKirieConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const command = options.command ?? "serve";
  const mode = options.mode ?? (command === "build"
    ? "production"
    : "development");
  const configFile = path.join(cwd, "kirie.config.ts");

  if (!fs.existsSync(configFile)) {
    throw new Error(
      `Missing required Kirie config file: ${configFile}. Create kirie.config.ts or pass --project <dir>.`,
    );
  }

  const fileUrl = `${pathToFileURL(configFile).href}?u=${Date.now()}-${++configImportSequence}`;
  const imported = (await import(fileUrl)) as { default?: KirieConfigExport };
  if (!("default" in imported) || imported.default === undefined) {
    throw new Error(`Kirie config must export a default configuration: ${configFile}`);
  }

  const rawExport = imported.default;
  const evaluated = typeof rawExport === "function"
    ? await rawExport({ command, mode })
    : await rawExport;

  return resolveKirieConfig(evaluated, {
    configFile,
    cwd,
    mode,
  });
}

export function resolveKirieConfig(
  input: unknown,
  context: { configFile?: string; cwd: string; mode?: string },
): ResolvedKirieConfig {
  if (!isPlainRecord(input)) {
    throw new Error("kirie.config.ts must export a configuration object.");
  }

  for (const key of Object.keys(input)) {
    if (key === "web") {
      throw new Error(
        "Top-level \"web\" configuration has been removed from kirie.config.ts. " +
        "Configure webview({ root: \"./src-web\" }) from \"kirie/plugin/webview\" in plugins instead.",
      );
    }
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(
        `Unknown top-level key "${key}" in kirie.config.ts. Allowed keys: godot, plugins, targets.`,
      );
    }
  }

  const cwd = path.resolve(context.cwd);
  const godot = validateGodotConfig(input.godot);
  const targets = validateTargetsConfig(input.targets);
  const configuredTargets = ALL_TARGET_NAMES.filter((name) => targets[name] !== undefined);
  const plugins = validatePlugins(input.plugins, configuredTargets);
  const project = path.resolve(cwd, godot.project ?? ".");

  let resolvedWeb: ResolvedKirieWebConfig | undefined;
  for (const plugin of plugins) {
    if (!plugin.web) {
      continue;
    }
    if (typeof plugin.web.root !== "string" || plugin.web.root.trim() === "") {
      throw new Error(`Plugin "${plugin.id}" must declare a non-empty web.root string.`);
    }

    resolvedWeb = {
      pluginId: plugin.id,
      root: path.resolve(cwd, plugin.web.root),
      vite: plugin.web.vite ?? {},
    };
  }

  return {
    configFile: context.configFile,
    cwd,
    godot: {
      args: godot.args ?? [],
      command: godot.command ?? "godot",
      csproj: godot.csproj
        ? path.resolve(project, godot.csproj)
        : undefined,
      project,
    },
    mode: context.mode ?? "production",
    plugins,
    targets,
    web: resolvedWeb,
  };
}

export function getConfiguredTargets(config: ResolvedKirieConfig): KirieTargetName[] {
  return ALL_TARGET_NAMES.filter((name) => config.targets[name] !== undefined);
}

export function assertConfiguredTarget<T extends KirieTargetName>(
  config: ResolvedKirieConfig,
  target: T,
  commandLabel: string,
): NonNullable<ResolvedKirieTargets[T]> {
  const targetConfig = config.targets[target];
  if (!targetConfig) {
    const configured = getConfiguredTargets(config);
    throw new Error(
      `${commandLabel} cannot target "${target}" because it is not declared in targets (${configured.join(", ")}).`,
    );
  }

  return targetConfig as NonNullable<ResolvedKirieTargets[T]>;
}

export function resolveSingleOrExplicitTarget<T extends KirieTargetName>(
  config: ResolvedKirieConfig,
  explicitTarget: T | undefined,
  commandName: "dev" | "run",
  allowedTargets?: readonly T[],
): T {
  if (explicitTarget !== undefined) {
    assertConfiguredTarget(config, explicitTarget, `kirie ${commandName}`);
    return explicitTarget;
  }

  const configured = getConfiguredTargets(config);
  if (configured.length >= 2) {
    throw new Error(
      `Multiple targets configured (${configured.join(", ")}); specify a target: kirie ${commandName} <target>`,
    );
  }

  const sole = configured[0]!;
  if (allowedTargets && !allowedTargets.includes(sole as T)) {
    throw new Error(
      `Target "${sole}" is not supported by kirie ${commandName} (supported: ${allowedTargets.join(", ")}).`,
    );
  }

  return sole as T;
}

export function getActivePluginsForTarget(
  config: ResolvedKirieConfig,
  target: KirieTargetName,
): KiriePlugin[] {
  return config.plugins.filter((plugin) => isPluginActiveForTarget(plugin, target));
}

export function getActiveAddonsForTargets(
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

export function createGodotExportUserArgs(
  config: ResolvedKirieConfig,
  target: KirieTargetName,
  extraUserArgs?: string[],
): string[] {
  const activePlugins = getActivePluginsForTarget(config, target);
  const activeIds = activePlugins.map((plugin) => plugin.id);
  const extra = extraUserArgs ?? [];
  const generated: string[] = [];

  if (!extra.some((arg) => arg.startsWith("--kirie-plugins="))) {
    generated.push(`--kirie-plugins=${activeIds.join(",")}`);
  }
  if (
    config.web &&
    activeIds.includes(config.web.pluginId) &&
    !extra.some((arg) => arg.startsWith("--kirie-web-dist="))
  ) {
    generated.push(`--kirie-web-dist=${path.resolve(config.web.root, "dist")}`);
  }

  return [
    ...generated,
    ...extra,
  ];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateGodotConfig(rawGodot: unknown): KirieGodotConfig {
  if (rawGodot === undefined) {
    return {};
  }
  if (!isPlainRecord(rawGodot)) {
    throw new Error("\"godot\" in kirie.config.ts must be an object.");
  }

  for (const key of Object.keys(rawGodot)) {
    if (!ALLOWED_GODOT_KEYS.has(key)) {
      throw new Error(
        `Unknown option "godot.${key}" in kirie.config.ts. Allowed keys: args, command, csproj, project.`,
      );
    }
  }
  if (
    rawGodot.args !== undefined &&
    (!Array.isArray(rawGodot.args) || rawGodot.args.some((item) => typeof item !== "string"))
  ) {
    throw new Error("godot.args in kirie.config.ts must be an array of strings.");
  }
  if (rawGodot.command !== undefined && typeof rawGodot.command !== "string") {
    throw new Error("godot.command in kirie.config.ts must be a string.");
  }
  if (rawGodot.csproj !== undefined && typeof rawGodot.csproj !== "string") {
    throw new Error("godot.csproj in kirie.config.ts must be a string.");
  }
  if (rawGodot.project !== undefined && typeof rawGodot.project !== "string") {
    throw new Error("godot.project in kirie.config.ts must be a string.");
  }

  return rawGodot as KirieGodotConfig;
}

function validateTargetsConfig(rawTargets: unknown): ResolvedKirieTargets {
  if (!isPlainRecord(rawTargets)) {
    throw new Error(
      "kirie.config.ts requires a non-empty \"targets\" object (desktop, ios, android, web).",
    );
  }

  const resolved: ResolvedKirieTargets = {};
  for (const [key, value] of Object.entries(rawTargets)) {
    if (!ALL_TARGET_NAMES.includes(key as KirieTargetName)) {
      throw new Error(
        `Unknown target "${key}" in kirie.config.ts. Supported targets: desktop, ios, android, web.`,
      );
    }
    if (value === undefined) {
      continue;
    }

    switch (key as KirieTargetName) {
      case "desktop":
        resolved.desktop = validateGodotOnlyTarget("desktop", value);
        break;
      case "web":
        resolved.web = validateGodotOnlyTarget("web", value);
        break;
      case "ios":
        resolved.ios = validateIosTarget(value);
        break;
      case "android":
        resolved.android = validateAndroidTarget(value);
        break;
    }
  }

  const configuredCount = ALL_TARGET_NAMES.filter((name) => resolved[name] !== undefined).length;
  if (configuredCount === 0) {
    throw new Error(
      "kirie.config.ts must declare at least one target in targets (desktop, ios, android, web).",
    );
  }

  return resolved;
}

function validateGodotOnlyTarget(
  targetName: "desktop" | "web",
  rawTarget: unknown,
): KirieGodotTargetConfig {
  if (!isPlainRecord(rawTarget)) {
    throw new Error(`targets.${targetName} must be an object with { host: "godot" }.`);
  }
  if ("plugins" in rawTarget) {
    throw new Error(
      `Per-target "plugins" is not supported in targets.${targetName}. Declare plugins in top-level plugins.`,
    );
  }
  if (rawTarget.host === undefined) {
    throw new Error(`targets.${targetName}.host is required (expected "godot").`);
  }
  if (rawTarget.host !== "godot") {
    throw new Error(
      `targets.${targetName}.host must be "godot" (got "${String(rawTarget.host)}").`,
    );
  }
  if ("project" in rawTarget || "scheme" in rawTarget || "module" in rawTarget) {
    throw new Error(
      `targets.${targetName} with host: "godot" cannot set project, scheme, or module.`,
    );
  }
  for (const key of Object.keys(rawTarget)) {
    if (!ALLOWED_DESKTOP_OR_WEB_TARGET_KEYS.has(key)) {
      throw new Error(`Unknown option "targets.${targetName}.${key}" in kirie.config.ts.`);
    }
  }
  assertOptionalNonEmptyString(rawTarget.preset, `targets.${targetName}.preset`);

  return {
    host: "godot",
    preset: rawTarget.preset as string | undefined,
  };
}

function validateIosTarget(rawTarget: unknown): KirieIosTargetConfig {
  if (!isPlainRecord(rawTarget)) {
    throw new Error("targets.ios must be an object with explicit host (\"godot\" or \"native\").");
  }
  if ("plugins" in rawTarget) {
    throw new Error(
      "Per-target \"plugins\" is not supported in targets.ios. Declare plugins in top-level plugins.",
    );
  }
  if (rawTarget.host === undefined) {
    throw new Error("targets.ios.host is required (expected \"godot\" or \"native\").");
  }
  if (rawTarget.host !== "godot" && rawTarget.host !== "native") {
    throw new Error(
      `targets.ios.host must be "godot" or "native" (got "${String(rawTarget.host)}").`,
    );
  }
  for (const key of Object.keys(rawTarget)) {
    if (!ALLOWED_IOS_TARGET_KEYS.has(key)) {
      throw new Error(`Unknown option "targets.ios.${key}" in kirie.config.ts.`);
    }
  }

  assertOptionalNonEmptyString(rawTarget.preset, "targets.ios.preset");

  if (rawTarget.host === "godot") {
    if (rawTarget.project !== undefined || rawTarget.scheme !== undefined) {
      throw new Error("targets.ios with host: \"godot\" cannot set project or scheme.");
    }

    return {
      host: "godot",
      preset: rawTarget.preset as string | undefined,
    };
  }

  assertOptionalNonEmptyString(rawTarget.project, "targets.ios.project");
  assertOptionalNonEmptyString(rawTarget.scheme, "targets.ios.scheme");

  if (!rawTarget.project && rawTarget.scheme !== undefined) {
    throw new Error("targets.ios.scheme requires targets.ios.project when host is \"native\".");
  }

  return {
    host: "native",
    preset: rawTarget.preset as string | undefined,
    project: rawTarget.project as string | undefined,
    scheme: rawTarget.scheme as string | undefined,
  };
}

function validateAndroidTarget(rawTarget: unknown): KirieAndroidTargetConfig {
  if (!isPlainRecord(rawTarget)) {
    throw new Error("targets.android must be an object with explicit host (\"godot\" or \"native\").");
  }
  if ("plugins" in rawTarget) {
    throw new Error(
      "Per-target \"plugins\" is not supported in targets.android. Declare plugins in top-level plugins.",
    );
  }
  if (rawTarget.host === undefined) {
    throw new Error("targets.android.host is required (expected \"godot\" or \"native\").");
  }
  if (rawTarget.host !== "godot" && rawTarget.host !== "native") {
    throw new Error(
      `targets.android.host must be "godot" or "native" (got "${String(rawTarget.host)}").`,
    );
  }
  for (const key of Object.keys(rawTarget)) {
    if (!ALLOWED_ANDROID_TARGET_KEYS.has(key)) {
      throw new Error(`Unknown option "targets.android.${key}" in kirie.config.ts.`);
    }
  }

  assertOptionalNonEmptyString(rawTarget.preset, "targets.android.preset");

  if (rawTarget.host === "godot") {
    if (rawTarget.project !== undefined || rawTarget.module !== undefined) {
      throw new Error("targets.android with host: \"godot\" cannot set project or module.");
    }

    return {
      host: "godot",
      preset: rawTarget.preset as string | undefined,
    };
  }

  assertOptionalNonEmptyString(rawTarget.project, "targets.android.project");
  assertOptionalNonEmptyString(rawTarget.module, "targets.android.module");

  if (!rawTarget.project && rawTarget.module !== undefined) {
    throw new Error("targets.android.module requires targets.android.project when host is \"native\".");
  }

  return {
    host: "native",
    module: rawTarget.module as string | undefined,
    preset: rawTarget.preset as string | undefined,
    project: rawTarget.project as string | undefined,
  };
}

function assertOptionalNonEmptyString(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function validatePlugins(
  rawPlugins: unknown,
  configuredTargets: readonly KirieTargetName[],
): KiriePlugin[] {
  if (rawPlugins === undefined) {
    return [];
  }
  if (!Array.isArray(rawPlugins)) {
    throw new TypeError("\"plugins\" in kirie.config.ts must be an array of KiriePlugin objects.");
  }

  const pluginIds = new Set<string>();
  let webPluginId: string | undefined;
  const plugins: KiriePlugin[] = [];

  for (const entry of rawPlugins) {
    if (!isPlainRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new Error("Each entry in \"plugins\" must be a valid KiriePlugin with a string id.");
    }
    const plugin = entry as unknown as KiriePlugin;

    if (pluginIds.has(plugin.id)) {
      throw new Error(`Duplicate Kirie plugin ID: ${plugin.id}`);
    }
    pluginIds.add(plugin.id);

    if (plugin.supportedTargets && plugin.supportedTargets.length > 0) {
      const compatible = plugin.supportedTargets.some((target) =>
        configuredTargets.includes(target),
      );
      if (!compatible) {
        throw new Error(
          `Plugin "${plugin.id}" supports targets [${plugin.supportedTargets.join(", ")}], ` +
          `which does not match any configured target [${configuredTargets.join(", ")}].`,
        );
      }
    }

    if (plugin.web) {
      if (webPluginId) {
        throw new Error(
          `Multiple Kirie plugins declare web assets (${webPluginId}, ${plugin.id}); at most one web plugin is allowed.`,
        );
      }
      webPluginId = plugin.id;
    }

    plugins.push(plugin);
  }

  return plugins;
}
