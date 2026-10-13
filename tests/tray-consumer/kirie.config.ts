import tray from "@gd-kirie/tray/plugin";
import { defineKirieConfig } from "kirie";

export default defineKirieConfig({
  plugins: [
    {
      ...tray,
      dotnetPackages: [{ id: "GdKirie.Tray", version: "@TEST_VERSION@" }],
    },
  ],
});
