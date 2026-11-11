import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default {
  plugins: [
    core,
    webview({
      root: "./src-web",
      vite: {
        build: { outDir: "custom-dist" },
      },
    }),
  ],
  targets: {
    desktop: { host: "godot" },
  },
};
