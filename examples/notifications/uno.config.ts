import type { Preset } from "unocss";
import { presetChromatic } from "@proj-airi/unocss-preset-chromatic";
import { defineConfig, presetAttributify, presetWind3 } from "unocss";

export default defineConfig({
  content: { filesystem: ["node_modules/@proj-airi/ui/src/**/*.{ts,vue}"] },
  presets: [
    presetWind3(),
    presetAttributify(),
    presetChromatic({ baseHue: 220.44, colors: { primary: 0 } }) as Preset,
  ],
});
