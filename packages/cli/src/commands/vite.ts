import type { ResolvedKirieConfig } from "./config.ts";
import fs from "node:fs";
import path from "node:path";
import { createViteBuildConfig } from "@gd-kirie/build";

import { createServer, type InlineConfig, mergeConfig, type ViteDevServer } from "vite";

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
  assertWebEntryExists(config.web.root);

  const server = await createServer(createViteConfig(config, options));

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
  const url = options.preferNetworkUrl ? (networkUrl ?? localUrl) : (localUrl ?? networkUrl);

  if (!url) {
    await server.close();
    throw new Error("Vite did not report a local dev server URL.");
  }

  return {
    server,
    url,
  };
}

function createViteConfig(
  config: ResolvedKirieConfig,
  options: StartViteDevServerOptions = {},
): InlineConfig {
  const buildConfig = createViteBuildConfig({
    mode: config.mode,
    viteConfig: config.web.vite,
    webRoot: config.web.root,
  });
  let headers;
  if (options.crossOriginIsolation) {
    headers = {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    };
  }

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

function assertWebEntryExists(webRoot: string): void {
  const indexPath = path.join(webRoot, "index.html");

  if (fs.existsSync(indexPath)) {
    return;
  }

  throw new Error(`Kirie dev requires ${indexPath}.`);
}
