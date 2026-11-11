import type { InlineConfig, UserConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

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

  const buildConfig = await createViteBuildConfig(options);
  const { build } = await importVite();
  await build(buildConfig);
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

export async function createViteBuildConfig(options: BuildViteWebOptions): Promise<InlineConfig> {
  assertNoKirieOwnedViteOptions((options.viteConfig ?? {}) as Record<string, unknown>);

  const { mergeConfig } = await importVite();

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

async function importVite(): Promise<typeof import("vite")> {
  try {
    return await import("vite");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "Vite is required when kirie/plugin/webview is configured. Install vite in your project dependencies.",
        { cause: error },
      );
    }

    throw error;
  }
}

function assertNoKirieOwnedViteOptions(viteConfig: Record<string, unknown>): void {
  assertNoOwnedOptions(viteConfig, "webview.vite", KIRIE_OWNED_VITE_OPTIONS);

  const server = viteConfig.server;
  if (server && typeof server === "object") {
    assertNoOwnedOptions(
      server as Record<string, unknown>,
      "webview.vite.server",
      KIRIE_OWNED_VITE_SERVER_OPTIONS,
    );
  }

  const buildOptions = viteConfig.build;
  if (buildOptions && typeof buildOptions === "object") {
    assertNoOwnedOptions(
      buildOptions as Record<string, unknown>,
      "webview.vite.build",
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
