import type { KiriePlugin } from "./index.ts";

import packageJson from "../../package.json" with { type: "json" };

export const core: KiriePlugin = {
  dotnetPackages: [
    {
      id: "GdKirie.EventaAdapter",
      version: packageJson.version,
    },
    {
      id: "GdKirie.Platform",
      version: packageJson.version,
    },
  ],
  id: "core",
};

export default core;
