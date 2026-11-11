import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default {
  plugins: [
    core,
    webview({
      root: "./src-web",
      vite: { logLevel: "silent" },
    }),
  ],
  targets: {
    android: { host: "godot" },
    desktop: { host: "godot" },
    ios: { host: "godot" },
    web: { host: "godot" },
  },
};
