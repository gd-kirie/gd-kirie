import core from "kirie/plugin/core";

export default {
  plugins: [core],
  web: {
    vite: {
      build: { outDir: "custom-dist" },
    },
  },
};
