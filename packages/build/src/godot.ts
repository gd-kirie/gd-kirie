import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

export type ExportMode = "debug" | "release";

export interface ExportGodotPresetOptions {
  godotArgs?: string[];
  godotCommand: string;
  installAndroidBuildTemplate?: boolean;
  mode: ExportMode;
  outputPath: string;
  preset: string;
  projectDir: string;
  userArgs?: string[];
}

export async function exportGodotPreset(options: ExportGodotPresetOptions): Promise<void> {
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });

  const args = [
    ...(options.godotArgs ?? []),
    "--headless",
    "--path",
    options.projectDir,
  ];

  if (options.installAndroidBuildTemplate) {
    args.push("--install-android-build-template");
  }

  args.push(
    options.mode === "debug"
      ? "--export-debug"
      : "--export-release",
    options.preset,
    options.outputPath,
  );

  if (options.userArgs?.length) {
    args.push("--", ...options.userArgs);
  }

  await execa(options.godotCommand, args, {
    cwd: options.projectDir,
    stdio: "inherit",
  });
}
