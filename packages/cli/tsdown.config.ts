import { defineConfig } from "tsdown";

export default defineConfig({
  dts: {
    sourcemap: true,
  },
  entry: {
    "cli": "src/cli.ts",
    "index": "src/index.ts",
    "plugin/core": "src/plugin/core.ts",
    "plugin/index": "src/plugin/index.ts",
    "plugin/webview": "src/plugin/webview.ts",
  },
  fixedExtension: false,
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: false,
});
