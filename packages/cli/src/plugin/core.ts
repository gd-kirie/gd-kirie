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
        sha256: "d4fee44698591e42ce05f743ccd080b88ca36263d8d0e1b3b7ae00f85a6becba",
        url: "https://github.com/dsh0416/godot-cef/releases/download/v2.2.0/godot_cef-v2.2.0.zip",
      },
      version: "2.2.0",
    },
  ],
};

export default corePlugin;
