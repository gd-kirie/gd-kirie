import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default defineKirieConfig(({ command }) => {
  if (command === "build") {
    throw new Error("dev should reuse the serve config");
  }

  return {
    godot: {
      args: ["fake-godot.js"],
      command: process.execPath,
    },
    plugins: [
      core,
      webview({
        root: "./src-web",
        vite: { logLevel: "silent" },
      }),
    ],
    targets: {
      android: { host: "godot" },
    },
  };
});
