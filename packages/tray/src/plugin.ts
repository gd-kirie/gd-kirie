import type { KiriePlugin } from "kirie/plugin";
import { defineKiriePlugin } from "kirie/plugin";
import packageJson from "../package.json" with { type: "json" };

const bundledAddonUrl = new URL("../addon/kirie_tray", import.meta.url).href;

// ADR-0015: Godot loads and exports the optional Tray native library.
// See docs/decisions/0015-load-tray-through-a-gdextension.md.
export default defineKiriePlugin({
  id: "tray",
  dotnetPackages: [
    {
      id: "GdKirie.Tray",
      version: packageJson.version,
    },
  ],
  godotAddons: [
    {
      id: "kirie-tray",
      path: "addons/kirie_tray",
      source: {
        type: "bundled",
        url: bundledAddonUrl,
      },
      version: packageJson.version,
    },
  ],
}) as KiriePlugin;
