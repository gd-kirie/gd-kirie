import type { UserConfig } from "vite";

export type KirieTargetName = "desktop" | "ios" | "android" | "web";

export interface BundledGodotAddonSource {
  sha256?: never;
  type: "bundled";
  url: string;
}

export interface RemoteGodotAddonSource {
  archivePath: string;
  sha256?: string;
  type: "remote";
  url: string;
}

export type GodotAddonSource = BundledGodotAddonSource | RemoteGodotAddonSource;

export interface KirieGodotAddonDependency {
  id: string;
  optional?: boolean;
  path: string;
  source: GodotAddonSource;
  targets?: readonly KirieTargetName[];
  version?: string;
}

export interface KirieDotnetPackageDependency {
  id: string;
  version: string;
}

export interface KiriePluginWebConfig {
  root: string;
  vite?: UserConfig;
}

export interface KiriePlugin {
  dotnetPackages?: KirieDotnetPackageDependency[];
  godotAddons?: KirieGodotAddonDependency[];
  id: string;
  supportedTargets?: readonly KirieTargetName[];
  web?: KiriePluginWebConfig;
}

export function defineKiriePlugin(plugin: KiriePlugin): KiriePlugin {
  return plugin;
}

export function isPluginActiveForTarget(
  plugin: KiriePlugin,
  target: KirieTargetName,
): boolean {
  return !plugin.supportedTargets || plugin.supportedTargets.includes(target);
}

export function isAddonActiveForTarget(
  addon: KirieGodotAddonDependency,
  target: KirieTargetName,
): boolean {
  return !addon.targets || addon.targets.includes(target);
}
