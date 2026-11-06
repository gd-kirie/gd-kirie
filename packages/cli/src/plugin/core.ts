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
        sha256: "a966363e0835e727ffae182a222d577b42057db41368a7b82cf618d1cd47eb4e",
        url: "https://github.com/dsh0416/godot-cef/releases/download/v2.1.3/godot_cef-v2.1.3.zip",
      },
      version: "2.1.3",
    },
  ],
};

export default corePlugin;
