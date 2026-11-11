import { buildDotnet, buildViteWeb } from "@gd-kirie/build";

import { loadKirieConfig } from "./config.ts";

export interface BuildOptions {
  cwd?: string;
  mode?: string;
}

export async function runBuild(options: BuildOptions = {}): Promise<void> {
  const config = await loadKirieConfig({
    command: "build",
    cwd: options.cwd,
    mode: options.mode,
  });

  if (config.web) {
    await buildViteWeb({
      mode: config.mode,
      viteConfig: config.web.vite,
      webRoot: config.web.root,
    });
  }

  await buildDotnet({
    csproj: config.godot.csproj,
    projectDir: config.godot.project,
    skipMissingProject: true,
  });
}

export async function runBuildWeb(options: BuildOptions = {}): Promise<void> {
  const config = await loadKirieConfig({
    command: "build",
    cwd: options.cwd,
    mode: options.mode,
  });

  if (!config.web) {
    throw new Error(
      "kirie build web requires webview(...) from \"kirie/plugin/webview\" in kirie.config.ts.",
    );
  }

  await buildViteWeb({
    mode: config.mode,
    viteConfig: config.web.vite,
    webRoot: config.web.root,
  });
}

export async function runBuildDotnet(options: BuildOptions = {}): Promise<void> {
  const config = await loadKirieConfig({
    command: "build",
    cwd: options.cwd,
    mode: options.mode,
  });

  await buildDotnet({
    csproj: config.godot.csproj,
    projectDir: config.godot.project,
  });
}
