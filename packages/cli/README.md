# Kirie CLI

The `kirie` command coordinates Godot, .NET, native mobile hosts, and optional Vite web builds on Node.js 24 or later. Every command except `kirie init` reads `kirie.config.ts` from the project directory through native TypeScript module loading. Projects without `webview(...)` do not need `vite` installed.

## Project configuration

Declare each target and its `host` mode explicitly in `targets`. Add `core` from `kirie/plugin/core` to manage `GdKirie.EventaAdapter` and `GdKirie.Platform` for C# projects. Add `webview({ root: "./src-web" })` from `kirie/plugin/webview` to manage the Vite frontend, `addons/kirie`, and desktop `addons/godot_cef`.

```ts
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";
import webview from "kirie/plugin/webview";

export default defineKirieConfig({
  plugins: [
    core,
    webview({ root: "./src-web" }),
  ],
  targets: {
    desktop: { host: "godot" },
    ios: { host: "godot" },
  },
});
```

## Commands and target selection

Common commands cover project creation, diagnostics, local builds, development sessions, exports, and launches:

```sh
pnpm kirie init my-app basic
pnpm kirie doctor
pnpm kirie doctor --fix plugin:webview
pnpm kirie build
pnpm kirie dev desktop
pnpm kirie dev ios
pnpm kirie dev android
pnpm kirie dev web
pnpm kirie export desktop
pnpm kirie export ios
pnpm kirie export android
pnpm kirie export web
pnpm kirie run desktop
pnpm kirie run ios
pnpm kirie run android
```

If `targets` declares one target, `kirie dev` and `kirie run` select that target automatically. If `targets` declares two or more targets, pass the target name explicitly. For example, run `pnpm kirie dev desktop` or `pnpm kirie run desktop`. Pass `desktop`, `ios`, `android`, `web`, or `plugin:<id>` to `kirie doctor` to scope diagnostics and `--fix` repairs.

## Mobile shell modes and Web target

On `ios` and `android`, `host: "godot"` builds a Godot-owned mobile application. Set `host: "native"` to stage an embeddable Godot bundle in `.kirie/embed/<platform>/<mode>/` for a SwiftUI or Android host application. Set `project` on the target to build and launch the host application in `kirie dev`, `kirie export`, and `kirie run`. Omit `project` to run in Artifact mode, where `kirie export` writes a standalone embed bundle to `dist/kirie/<platform>/<mode>/`. For simulator runs, `kirie run ios` and `kirie dev ios` select the simulator with `--device` or `SIMULATOR_ID`. See [iOS integration testing](../../docs/platform-integration-tests.md#ios) for simulator prerequisites and log behavior.

`kirie dev web` exports the Godot Web host once, starts the Vite development server, and prints its URL. C# projects require the experimental .NET Web templates:

```sh
pnpm kirie doctor --fix web
```

Godot 4.7.2 does not officially support .NET Web export. These templates come from upstream Draft PR #106125 and install without modifying the Godot editor or writing machine-local paths. The templates use WebAssembly threads, so the page must be cross-origin isolated. `kirie dev web` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, and production servers must send the same headers.
