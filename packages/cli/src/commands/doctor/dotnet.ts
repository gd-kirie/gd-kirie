import type { KirieDotnetPackageDependency } from "../../plugin/index.ts";
import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

interface MsbuildItem {
  FullPath?: string;
  Identity: string;
  Version?: string;
  VersionOverride?: string;
}

interface MsbuildEvaluation {
  Items?: {
    PackageReference?: MsbuildItem[];
    PackageVersion?: MsbuildItem[];
    ProjectReference?: MsbuildItem[];
  };
  Properties?: {
    MSBuildProjectDirectory?: string;
  };
}

export type DotnetDependencyReference = { type: "package"; version?: string } |
  { path: string; type: "project" };

export interface DotnetPackageOptions {
  csproj?: string;
  dependency: KirieDotnetPackageDependency;
  projectDir: string;
  runDotnet?: (args: string[], cwd: string) => Promise<string>;
}

export async function hasDotnetProject(options: {
  csproj?: string;
  projectDir: string;
}): Promise<boolean> {
  if (options.csproj) {
    return true;
  }

  const entries = await fs.readdir(options.projectDir, { withFileTypes: true });
  return entries.some(
    (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".csproj",
  );
}

export async function getDotnetDependencyReference(
  options: DotnetPackageOptions,
): Promise<DotnetDependencyReference | undefined> {
  const args = [
    "msbuild",
    ...(options.csproj ? [options.csproj] : []),
    "-getProperty:MSBuildProjectDirectory",
    "-getItem:PackageReference,PackageVersion,ProjectReference",
  ];
  const run = options.runDotnet ?? runDotnet;
  const output = await run(args, options.projectDir);
  const evaluation = JSON.parse(output) as MsbuildEvaluation;
  const items = evaluation.Items ?? {};
  const reference = items.PackageReference?.find(
    (item) => item.Identity.toLowerCase() === options.dependency.id.toLowerCase(),
  );
  if (reference) {
    const centralVersion = items.PackageVersion?.find(
      (item) => item.Identity.toLowerCase() === options.dependency.id.toLowerCase(),
    );
    return {
      type: "package",
      version: reference.VersionOverride ?? reference.Version ?? centralVersion?.Version,
    };
  }

  for (const projectReference of items.ProjectReference ?? []) {
    const projectPath = projectReference.FullPath ?? path.resolve(
      evaluation.Properties?.MSBuildProjectDirectory ?? options.projectDir,
      projectReference.Identity,
    );
    const packageId = await run(
      ["msbuild", projectPath, "-getProperty:PackageId"],
      options.projectDir,
    );
    if (packageId.trim().toLowerCase() === options.dependency.id.toLowerCase()) {
      return { path: projectReference.Identity, type: "project" };
    }
  }

  return undefined;
}

export async function installDotnetPackage(options: DotnetPackageOptions): Promise<void> {
  const args = [
    "package",
    "add",
    options.dependency.id,
    "--version",
    options.dependency.version,
    ...(options.csproj ? ["--project", options.csproj] : []),
  ];
  await (options.runDotnet ?? runDotnet)(args, options.projectDir);
}

async function runDotnet(args: string[], cwd: string): Promise<string> {
  const result = await execa("dotnet", args, { cwd });
  return result.stdout;
}
