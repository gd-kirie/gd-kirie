import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default defineKirieConfig(({ command, mode }) => {
  if (command !== "build" || mode !== "production") {
    throw new Error(`Unexpected config context: ${command} ${mode}`);
  }

  return {
    plugins: [
      core,
      webview({
        root: "./src-web",
        vite: {
          build: { sourcemap: true },
        },
      }),
    ],
    targets: {
      desktop: { host: "godot" },
    },
  };
});
