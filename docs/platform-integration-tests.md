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

On iOS, Godot sends `print` to Apple's unified log instead of standard output.
The CLI streams the application's unified log so the adapter receives ViDot
events. See Godot's [OsLogLogger implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/drivers/apple/os_log_logger.cpp).

The Android package name is `ai.moeru.kirie.integrationtests`.

The fixture disables Android Swappy frame pacing for Godot 4.7.2. That Godot
version can fail to present Vulkan frames on the CI emulator with
`VkResult error 5`. Remove the override after the Godot 4.8 upgrade and verify
the suite again. See [Godot issue 121035](https://github.com/godotengine/godot/issues/121035)
and [Godot pull request 121701](https://github.com/godotengine/godot/pull/121701).

## iOS

Build the iOS debug addon artifact, start a simulator, and run the suite:

```sh
mise run build:ios-debug-xcframework
mise run test:integration-ios
```

Set `SIMULATOR_ID` to select a simulator. Set `IOS_DEVICE_ID` to run on a
physical device.

The adapter stages the generated tests, invokes `kirie export ios`, and then
invokes `kirie run ios`. The CLI installs the app and forwards its console
output.

Godot 4.7.2 uses Compatibility rendering in the iOS Simulator. The tests cover
the WebView and IPC paths. They do not verify Mobile or Metal rendering.

## CI

The platform workflows build the required native addon first. Each workflow
then runs one command for the full suite:

```sh
mise run test:integration-desktop
mise run test:integration-android
mise run test:integration-ios
```

The launcher exports mobile apps after ViDot generates the test scripts. This
keeps the generated scripts and the selected tests in the same application
process.
