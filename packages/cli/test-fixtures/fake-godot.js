import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (process.argv.includes("--version")) {
  console.log("4.5.stable.official.876b29033");
  process.exit(0);
}

const file = "godot-invocations.json";
const invocations = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : [];

invocations.push({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    KIRIE_DEV: process.env.KIRIE_DEV,
    KIRIE_WEB_URL: process.env.KIRIE_WEB_URL,
  },
});

writeFileSync(file, JSON.stringify(invocations));

const exportIndex = process.argv.findIndex((argument) => argument.startsWith("--export-"));
if (exportIndex >= 0) {
  const outputPath = process.argv[exportIndex + 2];
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "<!doctype html><title>Fake Godot Web</title>");
}
