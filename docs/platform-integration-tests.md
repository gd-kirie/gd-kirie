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

Build the iOS debug addon artifact, start a simulator, and run the suite:

```sh
mise run typecheck
mise run build:ios-debug-xcframework
mise run test:integration-ios
```

Set `SIMULATOR_ID` to select a simulator. Set `IOS_DEVICE_ID` to run on a
physical device.

The native framework and integration app require iOS 15 or later with Xcode 27.

The adapter stages the generated tests, invokes `kirie export ios`, and then
invokes `kirie run ios`. The CLI installs the app and forwards its console
output. On the simulator, the CLI passes Godot's `--log-file` option with
the app's `tmp/kirie.log` path. It streams engine logs and ViDot events from
this file and reads the remaining output after process exit. This retains
events without a separate unified-log subscription. See the
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

The iOS workflow uses one `xcode-27` job on macOS 27 with the image's default
Xcode 27 version. It records the selected tool versions in `toolchain.log`.
See the
[runner image software list](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md).

The job has a ten-minute limit. It first downloads Godot 4.7.2 headers and the
ordinary-edition arm64 simulator debug library from the
[Godot Mobile Plugins release](https://github.com/godot-mobile-plugins/godot-ios-builds/releases/tag/4.7.2-stable).
Versions and SHA-256 checksums are pinned in `scripts/ios-ci-runtime.env`.
Both archives are verified before extraction. Missing or invalid downloads fail
before tool installation. There is no source build fallback in PR CI, so an empty
Actions cache cannot trigger a full Godot compilation.

The official Godot build process does not produce an arm64 simulator library.
The community release supplies that missing slice and generated headers without
requiring Kirie to maintain a separate engine build or release process.
See the [official iOS build script](https://github.com/godotengine/godot-build-scripts/blob/master/build-ios/build.sh).

PR jobs install only Node, pnpm, and XcodeGen through mise, plus the ordinary
Godot editor. The mise cache key uses the tool lockfile rather than the task
definitions, so documentation and task edits do not invalidate installed tools.
The community archives are pinned dependencies downloaded on every run. The
official ordinary-edition `ios.zip` is restored from cache or extracted from the
checksum-verified official export archive. It is saved immediately after a
successful installation, independently of later build and test results.

The debug addon build retains the device archive and limits the simulator
archive to `arm64`. Release builds keep their default architectures. See
[Xcode build settings](https://developer.apple.com/documentation/xcode/configuring-the-build-settings-of-a-target/).

The workflow starts the iPhone 16 Pro simulator with iOS 27.0 before installing
tools and dependencies. The simulator boots in the background while the workflow
installs dependencies and builds the addon and test prerequisites. Before running
tests, the workflow waits for startup to finish with `simctl bootstatus -b`.
See CircleCI's [simulator pre-start guidance](https://circleci.com/docs/guides/execution-managed/using-macos/#pre-start-the-simulator).

`mise run build:integration` builds the integration fixture's package dependencies
and web assets. It uses pnpm's dependency selection instead of building all
publishable packages. See [pnpm filtering](https://pnpm.io/filtering).
The iOS workflow then runs `mise run --skip-deps test:integration-ios` to avoid
repeating those builds. Use `--skip-deps` only after building the prerequisites.

ViDot generates the test scripts before the launcher exports the test app.
The workflow records command duration and resource use with `/usr/bin/time -l`.
It also records memory and free disk space at the start and end of the job.
Xcode build logs include task timing through `-showBuildTimingSummary`.
See Apple's [build timing guidance](https://developer.apple.com/videos/play/wwdc2018/408/).
The workflow uploads setup, build, simulator, test, and engine logs as the
`ios-integration-logs` artifact, including failed runs.

When upgrading Godot, verify that the community release provides matching headers
and an arm64 simulator debug archive before changing the pins. Check the archive's
actual architecture and simulator platform with `lipo` and `otool`, then run the
full integration suite. These archives are test dependencies; production addon
builds and official Godot export templates retain their existing responsibilities.
