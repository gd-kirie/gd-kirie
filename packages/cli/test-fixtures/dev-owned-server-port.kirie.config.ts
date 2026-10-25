import core from "kirie/plugin/core";

export default {
  plugins: [core],
  web: {
    vite: {
      server: { port: 4321 },
    },
  },
};
