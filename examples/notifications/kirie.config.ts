import notifications from "@gd-kirie/notifications";
import Vue from "@vitejs/plugin-vue";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";
import UnoCSS from "unocss/vite";

export default defineKirieConfig({
  plugins: [core, notifications],
  godot: { csproj: "KirieNotifications.csproj" },
  web: {
    vite: {
      plugins: [Vue(), UnoCSS()],
      build: { emptyOutDir: true, sourcemap: true },
    },
  },
});
