# @gd-kirie/build

`@gd-kirie/build` provides programmatic build, export, and native-embed functions for Kirie projects. The package requires Node.js 24 or later and runs without the Kirie CLI. `vite` is an optional peer dependency (`^7.0.0 || ^8.0.0`) that loads only when you call Vite web functions. Projects without a WebView frontend do not need `vite` installed.

## Godot, .NET, and Vite primitives

`buildDotnet` compiles the Godot C# project or skips compilation when `skipMissingProject` is `true` and no `.csproj` file exists. `exportGodotPreset` runs Godot in headless mode to export a named preset in `debug` or `release` mode. `listExportPresets` and `readExportPresetValue` parse `export_presets.cfg` without mutating the project. `createViteBuildConfig`, `buildViteWeb`, `assertViteWebOutput`, and `copyViteWebOutput` build and stage Vite web assets.

```ts
import { buildDotnet, buildViteWeb, exportGodotPreset } from "@gd-kirie/build";

await buildViteWeb({ mode: "production", webRoot: "./src-web" });
await buildDotnet({ projectDir: ".", skipMissingProject: true });
await exportGodotPreset({
  godotCommand: "godot",
  mode: "release",
  outputPath: "dist/desktop/app",
  preset: "macOS",
  projectDir: ".",
});
```

## Shell modes and mobile embed staging

Kirie supports two shell modes on `ios` and `android`. In `host: "godot"` mode, Godot owns the application process and exports the full platform project through `exportGodotPreset`. In `host: "native"` mode, a SwiftUI or Android application owns the process and embeds Godot as a view or fragment. `stageIosEmbed` and `stageAndroidEmbed` prepare embeddable Godot outputs in `.kirie/embed/<platform>/<mode>/` without modifying the Godot project directory. On iOS, `.kirie/embed/ios/<mode>/` contains `Frameworks/`, `Resources/<Executable>.pck`, `Sources/KirieGodotPlugins.mm`, `Sources/KirieHostBridge.mm`, `Sources/KirieGodotView.swift`, and `KirieEmbed.xcconfig`. On Android, `.kirie/embed/android/<mode>/` contains `godot-embed-<mode>.aar`, `libs/`, `Sources/KirieHostPlugin.kt`, `Sources/KirieGodotFragment.kt`, and `godot-build/`.

Native mobile targets support two output modes that depend on the target `project` path. In App mode, `project` points to the host Xcode project or Gradle root directory. `buildIosNativeHostApp` runs `xcodebuild` with an incremental `-derivedDataPath`, and `buildAndroidNativeHostApp` runs Gradle `assemble<Mode>` on the host module. In Artifact mode, `project` is omitted because an external build system compiles the host application. `exportIosEmbedArtifact` and `exportAndroidEmbedArtifact` copy the staged `.kirie/embed/<platform>/<mode>/` bundle and `kirie-embed-manifest.json` to `dist/kirie/<platform>/<mode>/`.

## Native host bridge and C# packages

Staged native embed sources register a `KirieHost` Godot singleton in `KirieHostBridge.mm` on iOS and `KirieHostPlugin.kt` on Android. `KirieHost` exposes the `send_to_host` method for outbound messages and the `host_message_received` signal for inbound messages. In `GdKirie.Platform`, `KirieHostTextTransport` implements `IKirieTextTransport` over `KirieHost` so C# scripts run Eventa RPC without a WebView. `GdKiriePlatform.Attach(context, hostWindow, windowBackend)` separates window operations behind `IKirieWindowBackend`.

Embedded Godot windows keep operating-system and Back handlers even without a standalone desktop window. `GdKirie.EventaAdapter` ships `build` and `buildTransitive` MSBuild targets that compile `KirieClientEventaBridge.cs` only when `addons/kirie/csharp/KirieClient.cs` exists in the consumer project. WebView-free C# projects and transitive library consumers build cleanly without `addons/kirie`.
