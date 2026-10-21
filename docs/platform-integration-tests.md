# Platform Integration Tests

The platform integration suite is in `tests/integration`.

The same ViDot tests run on desktop, Android, and iOS. Each suite uses one app
process. ViDot gives each test a new scene-tree root and frees that root after
the test.

## Scope

The suite tests this path:

```text
Godot -> Kirie platform implementation -> WebView -> JavaScript -> Godot
```

The tests cover:

- text, binary, and data IPC round trips
- WebView destruction and recreation
- packaged `res://` web assets
- routing between two `KirieNode` instances
- IPC session continuity while a node or its parent is hidden

The browser fixture uses `@gd-kirie/ipc`. Eventa behavior has separate tests.

## Layout

```text
tests/integration/
  project.godot
  export_presets.cfg
  vitest.config.ts
  tstogd.json
  src/
    integration_probe.ts
    webview.test.ts
  src-web/
    src/main.ts
  scripts/
    mobile_test_runner.gd
```

`integration_probe.ts` is TypeScript source. The test script imports its class.
The build creates the required GDScript in ignored output directories.

The test file imports `test` and `expect` from `@vidot/vitest`. Each test adds
its `KirieNode` below `context.root`. Do not add a second cleanup registry.

## Vitest Adapter

`@gd-kirie/vitest` wraps the ViDot pool:

```ts
import { kirie } from "@gd-kirie/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    isolate: false,
    pool: kirie({
      projectPath: import.meta.dirname,
    }),
  },
});
```

The default target is `desktop`. The integration config reads
`KIRIE_TEST_TARGET` to select `android` or `ios`.

ViDot compiles and runs the tests. The Kirie adapter performs these tasks:

1. Invoke the Kirie CLI launcher for the selected target.
2. Stage generated scripts inside the Godot project for mobile exports.
3. Map packaged resource paths back to the host test paths.
4. Forward ViDot events from application output.

The adapter does not call Godot, `adb`, or `xcrun` directly.

## Desktop

Install Godot CEF and import the project:

```sh
mise run install:godot-cef tests/integration
mise x -- godot --headless --import --path tests/integration
```

Run the suite:

```sh
mise run test:integration-desktop
```

The adapter invokes `kirie run desktop`. The CLI starts Godot with the ViDot
runner and `--headless`.

The headless suite cannot validate a visible system tray or native menu. Run
the `tray` example on Windows, macOS, and a Linux desktop with a
StatusNotifierItem host for icon and menu replacement, tooltip, visibility,
activation, and cleanup acceptance. Follow the
[`tray` example README](https://github.com/gd-kirie/kirie-examples/blob/main/examples/tray/README.md). On macOS, also confirm the
template icon in light and dark menu-bar appearances.

## Android

Build the Android addon artifact, then run the suite:

```sh
mise run build:android-aar
mise run test:integration-android
```

The adapter stages the generated tests, invokes `kirie export android`, and
then invokes `kirie run android`. The CLI installs the APK, clears app data and
logcat, starts the app, and streams its log output.

Godot classifies `--script` as an extended command-line option. Standard export
templates do not enable extended options. The integration project's main scene
therefore attaches the staged ViDot runner to its `SceneTree` on mobile exports.
See the [Godot command-line tutorial](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html).

The Android package name is `ai.moeru.kirie.integrationtests`.

The fixture disables Android Swappy frame pacing for Godot 4.7.2. That Godot
version can fail to present Vulkan frames on the CI emulator with
`VkResult error 5`. Remove the override after the Godot 4.8 upgrade and verify
the suite again. See [Godot issue 121035](https://github.com/godotengine/godot/issues/121035)
and [Godot pull request 121701](https://github.com/godotengine/godot/pull/121701).

## iOS

Build the iOS simulator addon artifact and run the suite:

```sh
mise run typecheck
mise run build:ios-simulator-xcframework
mise run test:integration-ios
```

Set `SIMULATOR_ID` to select a simulator, or start one before running the suite.
For a physical device, build with `mise run build:ios-xcframework` instead and
set `IOS_DEVICE_ID`.

The native framework and integration app require iOS 16 or later.
Simulator exports also require a matching arm64 Godot library at
`godot/bin/libgodot.ios.template_debug.arm64.simulator.a` in this repository
(`template_release` for release exports). Prepare it before running the suite;
the CLI does not build the engine. CI uses the community archive described below.

The adapter stages the generated tests, invokes `kirie export ios`, and then
invokes `kirie run ios`. The CLI waits for simulator readiness before installing
and launching the app. It streams Godot logs and ViDot events from
`tmp/kirie.log`, including remaining output after process exit, using Godot's
`--log-file` option. See the
[Godot command-line reference](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html).

Godot 4.7.2 uses Compatibility rendering in the iOS Simulator. The tests cover
the WebView and IPC paths. They do not verify Mobile or Metal rendering.

## CI

The platform workflows build the required native addon first. These tasks build
the test prerequisites and run the full suite:

```sh
mise run test:integration-desktop
mise run test:integration-android
mise run test:integration-ios
```

The launcher exports mobile apps after ViDot generates the test scripts. This
keeps the generated scripts and the selected tests in the same application
process.

The Typecheck job runs `mise run typecheck`, which includes the integration
fixture. Platform tasks generate and run tests without repeating these checks.
The fixture's `pnpm -C tests/integration test` command still includes typechecks
for standalone use.

Swift unit tests run independently in the [unit-test workflow](../.github/workflows/unittest.yml).
The [iOS integration workflow](../.github/workflows/platform-integration-ios.yml)
downloads matching headers and the arm64 simulator debug library from
[Godot Mobile Plugins](https://github.com/godot-mobile-plugins/godot-ios-builds/releases/tag/4.7.2-stable).
The archives are version-pinned and SHA-256 verified because the
[official iOS build script](https://github.com/godotengine/godot-build-scripts/blob/master/build-ios/build.sh)
does not provide that simulator slice. CI does not compile Godot.

`build:ios-simulator-xcframework` creates a debug XCFramework containing only
the arm64 simulator framework. The release task `build:ios-xcframework` still
builds both device and simulator frameworks. `test:integration-ios` prepares
the addon scripts, CLI bundle, and test web assets.
Other workspace packages are imported from source and need no separate bundles.

When upgrading Godot, verify the matching community archives, their architecture
and simulator platform (`lipo` and `otool`), then run the full integration suite.
