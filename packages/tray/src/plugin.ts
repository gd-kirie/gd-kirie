import type { KiriePlugin } from "kirie/plugin";
import { defineKiriePlugin } from "kirie/plugin";
import packageJson from "../package.json" with { type: "json" };

// ADR-0013: Tray stays an explicit plugin and owns its .NET and native host.
// See docs/decisions/0013-use-tray-icon-for-the-tray-plugin.md.
export default defineKiriePlugin({
  id: "tray",
  dotnetPackages: [
    {
      id: "GdKirie.Tray",
      version: packageJson.version,
    },
  ],
}) as KiriePlugin;
