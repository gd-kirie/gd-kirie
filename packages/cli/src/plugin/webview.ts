import type { UserConfig } from "vite";
import type { KiriePlugin } from "./index.ts";

import packageJson from "../../package.json" with { type: "json" };

export interface WebviewPluginOptions {
  root: string;
  vite?: UserConfig;
}

export function webview(options: WebviewPluginOptions): KiriePlugin {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.root !== "string" ||
    options.root.trim() === ""
  ) {
    throw new Error("webview({ root }) requires a non-empty root directory path.");
  }

  return {
    godotAddons: [
      {
        id: "kirie",
        path: "addons/kirie",
        source: {
          archivePath: "addons/kirie",
          type: "remote",
          url: `https://github.com/gd-kirie/gd-kirie/releases/download/v${packageJson.version}/kirie-addon.zip`,
        },
        version: packageJson.version,
      },
      {
        id: "godot-cef",
        path: "addons/godot_cef",
        source: {
          archivePath: "dist/addons/godot_cef",
          sha256: "a966363e0835e727ffae182a222d577b42057db41368a7b82cf618d1cd47eb4e",
          type: "remote",
          url: "https://github.com/dsh0416/godot-cef/releases/download/v2.1.3/godot_cef-v2.1.3.zip",
        },
        targets: ["desktop"],
        version: "2.1.3",
      },
    ],
    id: "webview",
    web: {
      root: options.root,
      vite: options.vite,
    },
  };
}

export default webview;
