import type { KiriePlugin } from "./index.ts";

import packageJson from "../../package.json" with { type: "json" };

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
        type: "remote",
        archivePath: "addons/kirie",
        url: `https://github.com/gd-kirie/gd-kirie/releases/download/v${packageJson.version}/kirie-addon.zip`,
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
