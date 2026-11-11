import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default {
  plugins: [
    core,
    webview({
      root: "./src-web",
      vite: {
        server: { port: 4321 },
      },
    }),
  ],
  targets: {
    desktop: { host: "godot" },
  },
};
