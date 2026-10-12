import notifications from "@gd-kirie/notifications";
import Vue from "@vitejs/plugin-vue";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";

export default defineKirieConfig({
  plugins: [core, notifications],
  web: { vite: { plugins: [Vue()], build: { emptyOutDir: true, sourcemap: true } } },
});
