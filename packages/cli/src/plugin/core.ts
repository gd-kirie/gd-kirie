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
        sha256: "55badbf72cc3f9036d0c9933c4405ce10f574378ca6d427c3919c557c3ea614a",
        url: "https://github.com/dsh0416/godot-cef/releases/download/v2.1.1/godot_cef-v2.1.1.zip",
      },
      version: "2.1.1",
    },
  ],
};

export default corePlugin;
