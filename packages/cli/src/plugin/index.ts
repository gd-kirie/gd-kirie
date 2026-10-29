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
  version?: string;
}

export interface KirieDotnetPackageDependency {
  id: string;
  version: string;
}

export interface KiriePlugin {
  id: string;
  dotnetPackages?: KirieDotnetPackageDependency[];
  godotAddons?: KirieGodotAddonDependency[];
}

export function defineKiriePlugin(plugin: KiriePlugin): KiriePlugin {
  return plugin;
}
