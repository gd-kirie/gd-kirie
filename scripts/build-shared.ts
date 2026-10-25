import path from "node:path";
import process from "node:process";
import { execa } from "execa";
import { exportIosApp as exportCliIosApp } from "../packages/cli/src/commands/ios.ts";

export const rootDir = process.cwd();
export const scriptsDir = path.join(rootDir, "scripts");
export const distDir = "dist";
export const godotSourceRoot = path.join(rootDir, "godot");

interface AndroidDebugExportOptions {
  projectDir: string;
  userArgs?: string[];
}

export async function runKirieCli(args: string[]): Promise<void> {
  await execa(process.execPath, kirieCliArgs(args), {
    cwd: rootDir,
    stdio: "inherit",
  });
}

export function kirieCliArgs(args: string[]): string[] {
  return [
    path.join(rootDir, "packages/cli/src/cli.ts"),
    ...args,
  ];
}

export async function exportAndroidDebug(options: AndroidDebugExportOptions): Promise<void> {
  const args = [
    "export",
    "android",
    "--project",
    path.resolve(rootDir, options.projectDir),
  ];

  if (options.userArgs && options.userArgs.length > 0) {
    args.push("--", ...options.userArgs);
  }

  await runKirieCli(args);
}

export async function exportIosApp(
  projectDir: string,
  appPath: string,
  target: "device" | "simulator",
  device?: string,
): Promise<void> {
  await exportCliIosApp({
    appPath: path.resolve(rootDir, appPath),
    cwd: path.resolve(rootDir, projectDir),
    device,
    target,
  });
  console.log(`Successfully built: ${appPath}`);
}
