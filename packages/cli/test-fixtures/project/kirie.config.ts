import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default defineKirieConfig({
  plugins: [
    core,
    webview({ root: "./src-web" }),
  ],
  targets: {
    desktop: { host: "godot" },
  },
});
