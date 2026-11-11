import type { InlineConfig, ViteDevServer } from "vite";
import type { ResolvedKirieConfig, ResolvedKirieWebConfig } from "./config.ts";
import fs from "node:fs";
import path from "node:path";
import { createViteBuildConfig } from "@gd-kirie/build";

export interface StartedViteServer {
  server: ViteDevServer;
  url: string;
}

export interface StartViteDevServerOptions {
  clearScreen?: boolean;
  crossOriginIsolation?: boolean;
  force?: boolean;
  host?: string;
  logLevel?: "info" | "warn" | "error" | "silent";
  port?: number;
  preferNetworkUrl?: boolean;
  strictPort?: boolean;
}

export async function startViteDevServer(
  config: ResolvedKirieConfig,
  options: StartViteDevServerOptions = {},
): Promise<StartedViteServer> {
  if (!config.web) {
    throw new Error(
      "Kirie Vite dev server requires webview(...) from \"kirie/plugin/webview\" in kirie.config.ts.",
    );
  }

  assertWebEntryExists(config.web.root);

  const viteConfig = await createViteConfig(config, config.web, options);
  const { createServer } = await importVite();
  const server = await createServer(viteConfig);

  let listening = false;
  try {
    await server.listen();
    listening = true;
  } finally {
    if (!listening) {
      await server.close();
    }
  }

  const localUrl = server.resolvedUrls?.local[0];
  const networkUrl = server.resolvedUrls?.network[0];
  const url = options.preferNetworkUrl
    ? (networkUrl ?? localUrl)
    : (localUrl ?? networkUrl);

  if (!url) {
    await server.close();
    throw new Error("Vite did not report a local dev server URL.");
  }

  return {
    server,
    url,
  };
}

async function createViteConfig(
  config: ResolvedKirieConfig,
  web: ResolvedKirieWebConfig,
  options: StartViteDevServerOptions = {},
): Promise<InlineConfig> {
  const buildConfig = await createViteBuildConfig({
    mode: config.mode,
    viteConfig: web.vite,
    webRoot: web.root,
  });
  let headers;
  if (options.crossOriginIsolation) {
    headers = {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    };
  }

  const { mergeConfig } = await importVite();

  return mergeConfig(buildConfig, {
    clearScreen: options.clearScreen,
    force: options.force,
    logLevel: options.logLevel,
    server: {
      headers,
      host: options.host ?? "127.0.0.1",
      open: false,
      port: options.port ?? 5173,
      strictPort: options.strictPort ?? false,
    },
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

function assertWebEntryExists(webRoot: string): void {
  const indexPath = path.join(webRoot, "index.html");

  if (fs.existsSync(indexPath)) {
    return;
  }

  throw new Error(`Kirie dev requires ${indexPath}.`);
}
