import type { KiriePlugin } from "./index.ts";
import { URL } from "node:url";

import packageJson from "../../package.json" with { type: "json" };

const bundledAddonUrl = new URL("../../addon/kirie", import.meta.url).href;

const corePlugin: KiriePlugin = {
  id: "core",
  dotnetPackages: [
    {
      id: "GdKirie.EventaAdapter",
      version: packageJson.version,
    },
    {
      id: "GdKirie.Platform",
      version: packageJson.version,
    },
  ],
  godotAddons: [
    {
      id: "kirie",
      path: "addons/kirie",
      source: {
        type: "bundled",
        url: bundledAddonUrl,
      },
      version: packageJson.version,
    },
    {
      id: "godot-cef",
      optional: true,
      path: "addons/godot_cef",
      source: {
        type: "remote",
        archivePath: "dist/addons/godot_cef",
        sha256: "c302d6dfd34729538c043fab5d6ff3affea7e7f76bb51691bd87381d1fee8e26",
        url: "https://github.com/dsh0416/godot-cef/releases/download/v2.1.0/godot_cef-v2.1.0.zip",
      },
      version: "2.1.0",
    },
  ],
};

export default corePlugin;
