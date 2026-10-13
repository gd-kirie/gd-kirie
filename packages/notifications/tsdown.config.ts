import { defineConfig } from "tsdown";

export default defineConfig({
  dts: { sourcemap: true },
  entry: "src/index.ts",
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  target: false,
});
