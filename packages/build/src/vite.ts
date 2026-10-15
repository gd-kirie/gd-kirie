import fs from "node:fs";
import path from "node:path";
import { build, type InlineConfig, mergeConfig, type UserConfig } from "vite";

const KIRIE_OWNED_VITE_OPTIONS = ["root", "base"] as const;
const KIRIE_OWNED_VITE_SERVER_OPTIONS = ["host", "port", "strictPort", "open"] as const;
const KIRIE_OWNED_VITE_BUILD_OPTIONS = ["outDir"] as const;

export interface BuildViteWebOptions {
  mode?: string;
  viteConfig?: UserConfig;
  webRoot: string;
}

export interface CopyViteWebOutputOptions {
  outputDir: string;
  webRoot: string;
}

export async function buildViteWeb(options: BuildViteWebOptions): Promise<void> {
  const indexPath = path.join(options.webRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Kirie build web requires ${indexPath}.`);
  }

  await build(createViteBuildConfig(options));
}

export function assertViteWebOutput(webRoot: string): void {
  const indexPath = path.join(webRoot, "dist", "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Kirie Web export requires ${indexPath}. Run kirie build web or remove --no-build.`,
    );
  }
}

export function copyViteWebOutput(options: CopyViteWebOutputOptions): void {
  assertViteWebOutput(options.webRoot);

  const sourceDir = path.resolve(options.webRoot, "dist");
  const targetDir = path.resolve(options.outputDir, "src-web", "dist");
  if (pathContains(sourceDir, targetDir) || pathContains(targetDir, sourceDir)) {
    throw new Error(
      `Kirie Web export source and target directories cannot contain each other: ${sourceDir} and ${targetDir}.`,
    );
  }

  fs.rmSync(targetDir, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function pathContains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function createViteBuildConfig(options: BuildViteWebOptions): InlineConfig {
  assertNoKirieOwnedViteOptions((options.viteConfig ?? {}) as Record<string, unknown>);

  return mergeConfig(options.viteConfig ?? {}, {
    base: "./",
    build: {
      outDir: "dist",
    },
    configFile: false,
    mode: options.mode,
    root: options.webRoot,
  }) as InlineConfig;
}

function assertNoKirieOwnedViteOptions(viteConfig: Record<string, unknown>): void {
  assertNoOwnedOptions(viteConfig, "web.vite", KIRIE_OWNED_VITE_OPTIONS);

  const server = viteConfig.server;
  if (server && typeof server === "object") {
    assertNoOwnedOptions(
      server as Record<string, unknown>,
      "web.vite.server",
      KIRIE_OWNED_VITE_SERVER_OPTIONS,
    );
  }

  const buildOptions = viteConfig.build;
  if (buildOptions && typeof buildOptions === "object") {
    assertNoOwnedOptions(
      buildOptions as Record<string, unknown>,
      "web.vite.build",
      KIRIE_OWNED_VITE_BUILD_OPTIONS,
    );
  }
}

function assertNoOwnedOptions(
  config: Record<string, unknown>,
  pathPrefix: string,
  options: readonly string[],
): void {
  for (const option of options) {
    if (option in config) {
      throw new Error(
        `${pathPrefix}.${option} is owned by Kirie and cannot be set in kirie.config.ts.`,
      );
    }
  }
}
