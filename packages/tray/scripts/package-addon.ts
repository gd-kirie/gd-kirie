import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };

const source = fileURLToPath(new URL("../gdextension", import.meta.url));
const artifacts = fileURLToPath(new URL("../../GdKirie.Tray/native/artifacts", import.meta.url));
const addonRoot = fileURLToPath(new URL("../addon", import.meta.url));
const destination = fileURLToPath(new URL("../addon/kirie_tray", import.meta.url));

await fs.rm(destination, { force: true, recursive: true });
await fs.mkdir(addonRoot, { recursive: true });
await fs.writeFile(fileURLToPath(new URL("../addon/.gdignore", import.meta.url)), "");
await fs.cp(source, destination, { recursive: true });
await fs.writeFile(
  fileURLToPath(new URL("../addon/kirie_tray/plugin.cfg", import.meta.url)),
  `[plugin]\nname="Kirie Tray"\ndescription="Native Tray GDExtension"\nauthor="Moeru AI"\nversion="${packageJson.version}"\n`,
);

if (existsSync(artifacts)) {
  await fs.cp(artifacts, fileURLToPath(new URL("../addon/kirie_tray/bin", import.meta.url)), {
    recursive: true,
  });
}
