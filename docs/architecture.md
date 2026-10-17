# Architecture Notes

Kirie is evolving into an application framework with an embeddable low-level
Godot plugin and IPC core. The repository scope is still intentionally
constrained, but the constraint now applies to where higher-level behavior
belongs, not to limiting the whole project to a minimum plugin shape.

The low-level plugin and IPC core provide:

- a Godot-facing Kirie service
- a scene-friendly KirieNode node
- a thin C# KirieClient wrapper for .NET projects
- Android and iOS native WebView implementations
- a desktop Godot CEF backend, starting with macOS
- an iframe backend for Godot Web exports
- packaged `res://` web resource loading for native exported apps
- a repo-level platform integration test project

Application-framework behavior such as CLI workflows, host-window
capabilities, routing, export orchestration, and mobile development sessions
belongs above that core. The current `@gd-kirie/ipc` package is intentionally
only a browser-side transport wrapper on top of the platform bridge, including
same-origin iframe messages on Web. Eventa
adapters and Platform capability packages live above Kirie and use that
low-level text transport.

The mobile IPC experiment keeps Kirie core byte-oriented and CBOR-based while
preserving separate text, binary, and data lanes. Higher-level protocols,
including Eventa adapters, remain above Kirie. Android carries CBOR packets
through AndroidX WebKit ArrayBuffer message channels. iOS carries CBOR packets
as base64 strings through WKWebView script messages and keeps native
serialization coverage for the same lane payload contract.

## Current Godot API direction

`kirie` is the low-level WebView and IPC bridge.

Higher-level semantics such as event routing, richer message contracts, or
request/response abstractions are expected to live above this layer, for example
in future app-specific adapters above Kirie or `@gd-kirie/ipc`.

Current public Godot-facing names should stay close to that low-level role:

- `create_webview(options := {})`
- `destroy_webview()`
- `load_url(url)`
- `load_html_string(html, base_url := "")`
- `send_text(message)`
- `send_binary(bytes)`
- `send_data(value)`
- `get_launch_option(key)`
- `grant_permission(request_id)`
- `deny_permission(request_id)`

These names describe the current low-level transport API. Android implements
the lane shape with AndroidX WebKit ArrayBuffer message channels and CBOR
packets. iOS implements the same text, binary, and data lanes with CBOR packets
carried as base64 strings through WKWebView script messages.
Web implements these lanes with a transferred `MessagePort` and structured clone.

The Godot-facing `Kirie` script stays a thin wrapper over the native singleton,
desktop CEF node, or Web DOM session.
Each backend owns its platform lifecycle and serialization behavior.

The C# `KirieClient` wrapper follows the same low-level surface. Its default
constructor forwards to the platform singleton, while `FromNode(...)` borrows
an existing scene `KirieNode` so C# can retain a typed API without creating a
second WebView owner. Methods use C# naming, and Kirie signals are exposed as C#
events. Internal Godot `Callable` usage exists only inside this wrapper. A
borrowed node must outlive the client; disposing the client disconnects its
callbacks but leaves node and WebView ownership with `KirieNode`.

Current signals should also stay narrow:

- `webview_ready`
- `text_received`
- `binary_received`
- `data_received`
- `permission_requested`
- `ipc_error`

The Godot-facing scripts are authored in `packages/kirie/src-godot` and
converted to Git-ignored GDScript in `packages/kirie/addon/addons/kirie`.
The generated paths and `class_name` declarations remain the public Godot
interface. TypeScript source does not ship in the addon zip.

Desktop permission requests remain pending until the application grants or
denies each request ID. Kirie only forwards the permission type, requesting
origin, and request ID. The application owns the trust policy and must resolve
unknown permission types and untrusted origins by denying them. This keeps the
low-level API independent of Godot CEF while avoiding a global allow policy.

Higher-level invocation APIs do not enter Kirie core. Confirmed application
capabilities are implemented above it through packages such as Platform, Tray,
and Notifications.

For the current milestone, Kirie should treat `KirieNode` as the public
scene-tree ownership unit for a platform WebView. A user may place a
`KirieNode` under the main scene, under a Godot `Window` node, or in another
scene structure that fits their project.

Kirie core does not own window organization. Prefab windows, panels,
workspaces, cross-view forwarding, and routing remain application concerns
above the low-level WebView and IPC surface. Do not create a general
BrowserWindow facade or add these capabilities to GDScript.

## Platform capability layer

The Platform layer exposes confirmed host-owned capabilities that ordinary Web
APIs cannot provide. Its dependency direction is:

```text
@gd-kirie/platform -> @gd-kirie/ipc-eventa -> @gd-kirie/ipc
GdKirie.Platform -> GdKirie.EventaAdapter
```

The browser client borrows the application's existing `KirieEventaContext`.
The Godot host registers the matching Eventa contract against that context and
binds its lifetime to one explicit `Window`; neither package creates a second
IPC owner.

The implemented Platform capabilities are:

- opening absolute HTTP and HTTPS URLs with the system browser
- opening the current application's data directory
- host-window bounds snapshots in screen coordinates
- current-display bounds snapshots in screen coordinates
- unscaled pixel position snapshots and change events relative to the host window
- pointer passthrough
- native move and resize gestures
- always-on-top
- centering on the current display
- system-wide global shortcuts on macOS and Windows
- [Android system Back requests](decisions/0005-add-android-system-back-to-the-platform-layer.md)

Global shortcuts use Godot logical keys and explicit register/unregister
operations. The browser receives pressed and released states through one
`onKeyEvent` handler, including while the Godot window is hidden or unfocused.
The registration lifetime belongs to `GdKiriePlatformHost`. macOS uses Carbon
hot-key registration. Windows shares one lazy `WH_KEYBOARD_LL` hook across
Platform hosts, filters it to host-owned registrations, and posts accepted
state changes to Godot's main thread. The Windows choice and its non-exclusive
conflict semantics are recorded in
[ADR-0003](decisions/0003-use-a-low-level-keyboard-hook-for-windows-global-shortcuts.md).
Linux global-shortcut backends remain pending work rather than excluded
platforms.

Android system Back is forwarded from the bound window's
`Window.GoBackRequested` signal. The browser subscribes to the exported
`backRequested` contract and decides whether it changes the route or closes the
application. The application keeps Godot's `SceneTree.quit_on_go_back`
disabled while it handles Back; the Platform host does not change that setting.
The choice is recorded in
[ADR-0005](decisions/0005-add-android-system-back-to-the-platform-layer.md).

## Tray plugin

The Tray packages and native extension are maintained in
[kirie-plugins](https://github.com/gd-kirie/kirie-plugins).

System trays and native popup menus belong to the optional Tray plugin. Its
dependency direction is:

```text
@gd-kirie/tray -> @gd-kirie/ipc-eventa -> @gd-kirie/ipc
GdKirie.Tray -> GdKirie.EventaAdapter
```

`@gd-kirie/tray/plugin` declares the `GdKirie.Tray` NuGet host and the bundled
`addons/kirie_tray` GDExtension. The browser client and Godot host borrow the
application's existing Eventa context. The descriptor supplies installation data.

The Rust extension uses
[`tray-icon`](https://github.com/tauri-apps/tray-icon) and registers one
`KirieTrayNative` class. The .NET host owns one native instance through Godot's
`ClassDB`. It loads `res://` textures, converts them to RGBA pixels, and calls
the native instance through Godot. Each native instance owns its tray.
The host destroys the tray and releases the instance on Godot's main thread.

The npm plugin bundles macOS, Windows, and Linux libraries for x64 and Arm64.
Godot selects and exports the native library through `.gdextension` feature
tags. The NuGet package contains only the managed host. Linux uses `tray-icon`'s
KSNI backend.

Browser calls use the `kirie:tray:*` contracts. The .NET package only adapts
those contracts to the private Rust library: it passes menu JSON and scalar
values through and emits activated menu IDs. `window.kirie.platform.os` may
select inputs such as a macOS template icon; the .NET host rejects non-desktop
systems, and the Rust library rejects template icons outside macOS. This design
is recorded in
[ADR-0015](decisions/0015-load-tray-through-a-gdextension.md).

The public API is independent of Uninvoke. Any Uninvoke-specific names, event
IDs, compatibility behavior, or unsupported-method policy belong in the
Uninvoke repository's Kirie adapter. Application lifecycle, display
enumeration, arbitrary shell or process execution, a general operating-system
permission API, updater behavior, multi-window factories, and general
capability discovery remain outside this milestone.

`@gd-kirie/platform` is the application capability SDK. It must not be confused
with the existing `window.kirie.platform` value and TypeScript
`KiriePlatform` interface in `@gd-kirie/ipc`; those identify the native OS and
low-level WebView backend and are not capability objects.

## Notifications plugin

The Notifications packages and export adapter are maintained in
[kirie-plugins](https://github.com/gd-kirie/kirie-plugins).

`@gd-kirie/notifications` and `GdKirie.Notifications` borrow the application's
existing Eventa context and expose immediate notifications with live click
activation. The fixed dependency direction is
`@gd-kirie/notifications -> @gd-kirie/ipc-eventa -> @gd-kirie/ipc` and
`GdKirie.Notifications -> GdKirie.EventaAdapter`.

macOS and Windows use the implementations moved from Platform. Android and iOS
call the pinned `godot-notification-scheduler` v6.0 native singleton. The
addon-rooted export adapter injects its AAR or XCFramework and export metadata;
it does not add a second notification implementation or a project-root
`ios/plugins` shim. IDs remain caller-owned strings, activations route only to
the live host that published them, and richer scheduling APIs remain outside
the current contract. This boundary is recorded in
[ADR-0014](decisions/0014-extract-notifications-into-a-kirie-plugin.md).

Windows pointer passthrough is the one initial native exception. Godot's current
Windows hit-test path returns `HTTRANSPARENT`, whose forwarding scope is limited
to windows in the same thread. `GdKirie.Platform` therefore changes the bound
window's layered/transparent extended styles through P/Invoke so pointer hits
can reach other applications. Other platforms use Godot's window API directly.

The public Godot API should primarily let users address WebViews through node
references:

- `$KirieNode.load_url(url)`
- `$KirieNode.send_text(message)`
- `$KirieNode.send_binary(bytes)`
- `$KirieNode.send_data(value)`

Native implementations may keep internal handles or IDs to manage platform instances.
Android and iOS use private view IDs only to route callbacks back to the owning `KirieNode`; public routing names, browser-driven cross-view forwarding, and window helper APIs are deferred higher-level concerns.

Kirie supports loading packaged offline web content from Godot project
resources. The current native resolvers can serve packaged `res://` paths. The
Kirie CLI app layout standardizes production web content at
`res://src-web/dist/index.html`, as described below.

## Runtime debug configuration

Debug behavior that affects exported applications is controlled by Godot export
preset options, not by automatically detecting whether the export itself is a
debug build.

The current export preset options are:

- `kirie/debug/enable_web_inspector`
- `kirie/debug/allow_tls_bypass`

On Android, the export plugin writes these values as application manifest
metadata for the native plugin to read at runtime. On iOS, it writes matching
Info.plist values. The iOS ATS widening plist block is injected only when
`kirie/debug/allow_tls_bypass` is enabled.

Android native artifact selection is separate from application debug behavior.
Exports use `Kirie-release.aar` by default. Repository-local Android native
debugging can opt into `Kirie-debug.aar` for a single export by passing
`-- --kirie-android-aar=debug` to the Godot export command.

Android application command line arguments are part of the export preset. A
single export can replace them by passing
`-- --kirie-android-extra-args=<arguments>` to the Godot export command, which
the export plugin applies through Godot's `command_line/extra_args` Android
export option. Use this to keep environment-specific arguments, such as an
emulator renderer override, out of the shared preset.

## Kirie app layout and CLI direction

The Kirie application shape is a Godot project with a Vite web frontend beside
the Godot source:

```text
kirie.config.ts
package.json
pnpm-lock.yaml / bun.lock / package-lock.json
project.godot
src-godot/
  main.tscn
  main.gd or main.cs
src-web/
  index.html
  src/
  assets/
  dist/
addons/
  kirie/
  godot_cef/
  others/
```

Directory responsibilities are:

- `src-godot`: Godot host application source.
- `src-web`: Vite web UI source and production build output.
- `addons`: Godot plugins. Kirie remains installed as `addons/kirie`, and Godot
  CEF remains installed as `addons/godot_cef`.
- `kirie.config.ts`: Kirie CLI configuration for coordinating Godot, Vite, and
  local build inputs.
- `@gd-kirie/build`: publishable JavaScript API for build and export automation
  that can be used without the Kirie CLI.

Kirie does not own native platform project directories. Do not introduce
Capacitor-style `ios/` or `android/` project trees into Kirie user projects.
Native capabilities should be provided by Godot plugins.

The Kirie CLI surface is intentionally small. The current implemented subset
covers desktop development, local build inputs, platform export, and mobile
install-and-launch flows:

```sh
kirie dev
kirie dev desktop
kirie dev android
kirie dev ios
kirie dev web
kirie build
kirie build web
kirie build dotnet
kirie export android
kirie export ios
kirie export web
kirie doctor
kirie run
kirie run desktop
kirie run android
kirie run ios
```

`kirie run` and `kirie run desktop` launch the Godot project on desktop. Both
commands accept raw Godot arguments after `--`.

`kirie run android` installs the exported APK by default. Its `--skip-install`
option launches an already-installed APK, as used by platform integration CI.

The broader application workflow should keep these command semantics. The
`--mode <mode>` option is supported by `kirie dev`; public `--mode` support for
`build`, `export`, and `run` is still planned:

```sh
kirie build [--mode <mode>]
kirie export [--mode <mode>]
kirie run [--mode <mode>] [--export]
kirie dev
kirie init
kirie doctor
kirie doctor [target]
kirie doctor --fix
kirie doctor --fix [target]
```

```mermaid
flowchart TD
    Command["User command"] --> Which{"Which command?"}

    Which --> Build["kirie build\n--mode <mode>\ndefault: production"]
    Build --> BuildInputs["Prepare local inputs"]
    BuildInputs --> BuildDone["Finish"]

    Which --> Export["kirie export\n--mode <mode>\ndefault: production"]
    Export --> ExportBuild["Prepare local inputs"]
    ExportBuild --> Package["Produce platform package"]
    Package --> ExportDone["Finish"]

    Which --> Run["kirie run\n--mode <mode>\ndefault: production"]
    Run --> RunBuild["Prepare local inputs"]
    RunBuild --> RunExport{"--export?"}
    RunExport -->|yes| RunPackage["Produce platform package"]
    RunPackage --> RunPackageTarget["Run exported package"]
    RunExport -->|no| RunDirect["Direct run / deploy built outputs"]

    Which --> Dev["kirie dev"]
    Dev --> DevServer["Start Vite hot-reload server"]
    DevServer --> DevDotnet["Build C#/.NET if configured"]
    DevDotnet --> DevTarget{"Target requires deploy package?"}
    DevTarget -->|desktop no| DevDesktop["Run Godot project directly"]
    DevTarget -->|mobile/deploy yes| DevPackage["Produce development package"]
    DevPackage --> DevDeploy["Install / launch / attach logs"]
```

In this model, `build` prepares local inputs, `export` packages those inputs,
`run` runs or deploys the built inputs without exporting by default, and `dev`
runs a hot-reload development session. `run --export` is the explicit form for
exporting before running; users may also run `kirie export && kirie run` when
they want the steps separated. For exported mobile targets, `run` is an
install-and-launch command: Android `run` installs the default APK before
starting the app, and iOS `run` installs the selected `.app` before launching
it. `kirie export ios` first asks Godot for the Xcode project and then invokes
`xcodebuild` to produce an installable `.app`; without `--device` it builds for
the iOS Simulator, while `--device <UDID>` selects a physical-device build
and lets Xcode use the local Apple Development signing configuration. `build`,
`export`, and `run` default to `production` mode and
should accept `--mode <mode>` for `development`, `staging`, or other
user-defined modes once that option is implemented. `dev` should never run the
production web build because it owns the Vite hot-reload server; desktop
development can run without exporting, while mobile or deploy-style development
may use a development export path. `dev` may still build the Godot C#/.NET
project when one is configured.

`@gd-kirie/build` owns explicit-input programmatic build and export primitives.
The package exports the .NET builder, Vite builder, Vite configuration
factory, Godot exporter, and export-preset reader. The CLI owns the Godot
import step that prepares a fresh project.
Development sessions, mobile device selection, install, launch, launch-option
injection, log streaming, and watch policy stay in `kirie`.

The `kirie` package exports `defineKirieConfig` and `KirieConfig` for
configuration files. Command implementations are internal to the CLI.

`kirie dev` starts a Vite development server and reads the actual resolved URL
after Vite listens. Desktop development launches Godot as a child process and
passes the dev launch options as Godot user arguments:

```text
--kirie-dev=1
--kirie-web-url=http://127.0.0.1:<actual-port>/
```

Applications with packaged content select the injected `kirie-web-url` when it
is present and otherwise use their production resource path. This selection
does not depend on a debug build or require the separate `kirie-dev` option.

Android development exports and installs the debug APK, runs
`adb reverse tcp:<actual-port> tcp:<actual-port>`, then passes the same
hyphenated keys as Android intent extras. The Android app receives
`kirie-web-url` as a device-local loopback URL, such as
`http://127.0.0.1:<actual-port>/`, so it does not depend on the phone or
emulator reaching the host machine through the LAN. Because Android WebView
still opens a network socket for the loopback HTTP connection, `kirie dev
android` requires the Android export preset to enable
`permissions/internet=true`; runtime commands must fail on a wrong preset rather
than rewriting it. iOS development currently targets the simulator path: it
exports the Xcode project, builds a simulator `.app`, installs and launches it
through `simctl`, and passes the same keys as process arguments. Web development
exports the Godot host once, serves it from the Vite origin, and passes the Vite
URL through the same launch options. C# Web development requires the
experimental toolchain installed by `kirie doctor --fix web`.

Before launching the development session, `kirie dev` runs Godot in headless
import mode for the project. Use Godot's `--import` command-line option for this
prepare step rather than hand-rolling editor flags; the Godot command-line
reference defines `--import` as starting the editor, waiting for resources to be
imported, and then quitting. This is a CLI fresh-project concern: ordinary Godot
addon usage normally passes through the editor or project manager first, while a
one-command `kirie dev` run may otherwise parse the main scene before Godot has
registered addon `class_name` scripts such as `GdKirie` in the global script
class cache. See `docs/references.md` for the Godot command-line and GDScript
named-class references.

The CLI does not support Finder, Dock, or other non-CLI launched macOS app
processes. It only supports development sessions that the CLI starts and owns.

`kirie build` builds local intermediate artifacts needed by a runnable or
exportable Godot project, but it does not produce platform application packages.
It should build every configured or clearly discovered input. `kirie build web`
builds only the Vite web output. `kirie build dotnet` builds only the Godot
C#/.NET project and fails when no project or solution is present. If no C#
project is configured or discovered, the aggregate `kirie build` command may
skip the `.NET` step; if a C# project is present, C# build failure must fail the
command.

`kirie export` means a complete platform export workflow: build local inputs
first, then call Godot's export flow for the selected platform or preset.
For Web, it verifies `src-web/dist/index.html`, exports Godot, and replaces the
sibling `src-web/dist` tree with the current Vite build. The copy occurs only
after Godot export succeeds. `--no-build` requires an existing Vite build and
fails before Godot starts when the entry file is missing.
`kirie run` should build local inputs first, then directly run the scene or
deploy the built outputs by default. For Android exports, deploy means
installing the default `kirie export android` output before launching the Godot
activity. It should only run an export workflow when the user passes
`--export`. Neither command should silently create or repair project
configuration.

`kirie init <target> <template> [--overwrite]` initializes a new project from
the named folder under `templates/` in the pinned `moeru-ai/kirie-templates`
commit in `packages/cli/src/commands/init.ts`. It sets `package.json.name` and the
`src-web/index.html` title, preserving template-owned Godot configuration.
After initialization, run `pnpm install` and `pnpm kirie doctor --fix` to
install addons. The command is non-interactive and does not migrate or repair
existing projects. `kirie doctor` is read-only
diagnostics and `kirie doctor --fix` may apply supported repairs. Repair writes
to Godot-owned configuration files, including `project.godot` and
`export_presets.cfg`, must go through Godot itself, for example a headless
helper script using
`ProjectSettings` or `ConfigFile`. JavaScript code must not patch existing
Godot configuration text directly.

`kirie doctor` is the read-only environment and project prerequisite check. It
does not build local inputs, run exports, install SDK packages, download export
templates, or mutate project files. It should report one diagnostic row per
check, include the detected value when one exists, include a concise fix hint
when a required check fails, and exit non-zero when any required check fails.
The check implementation should preserve enough failure detail for diagnostics;
avoid generic boolean helpers that collapse missing paths, wrong file types,
permission failures, and command failures into the same result.

Optional prerequisites are reported as warnings and do not make an unscoped
`kirie doctor` invocation fail. `kirie doctor plugin:<id>` limits diagnosis to
one explicitly configured Kirie plugin, while a bare `kirie doctor --fix`
applies every supported automatic repair. System SDKs and tools remain
user-managed.

`kirie.config.ts` lists active plugin descriptors in its `plugins` array.
The `kirie/plugin/core` descriptor declares the required Kirie addon, the
optional desktop Godot CEF addon, and the `GdKirie.EventaAdapter` and
`GdKirie.Platform` NuGet packages. The Kirie addon is bundled with the npm
package; Godot CEF remains a large external archive pinned by URL and SHA-256.
`packages/cli/src/commands/doctor/addons.ts` validates either source before atomically
replacing an installation. Doctor skips plugin .NET dependencies when the
Godot project has no `.csproj`.

The initial `kirie doctor` check matrix is:

| Check | Purpose | Required behavior |
| --- | --- | --- |
| Kirie plugin dependencies | Confirm configured Godot addons and .NET packages match their descriptors. | Fail when a required dependency is missing or incompatible, and offer `kirie doctor --fix plugin:<id>`. |
| Godot command | Confirm the configured Godot executable can be launched and identify its version. | Run the configured command with a version probe and report the detected version or command failure. |
| Godot export templates | Confirm export templates exist for the detected Godot version. | Check the template location matching Godot's version string and report missing or empty template directories without installing templates. |
| Android SDK | Confirm Android export prerequisites can find an SDK. | Prefer `ANDROID_HOME`, accept compatible existing environments, and report whether the SDK directory exists. |
| Android Java path | Confirm Godot's Android editor settings point at a usable Java/JDK. | Read Godot `EditorSettings`, check the Android Java SDK path, and report missing, invalid, or non-executable Java configuration. |
| Android export preset | Confirm the project export preset contains required Android options for Kirie workflows. | Inspect `export_presets.cfg` through a structured parser and report missing presets or required option mismatches without rewriting the file. |

Later doctor checks may cover the iOS toolchain and Godot C#/.NET setup. Add
those checks only when the corresponding Kirie workflow is implemented enough
that a failed prerequisite can be explained with a concrete fix path.

Kirie enforces Vite as the web toolchain. Users should not hand-write a fixed
development URL. The CLI should let Vite handle port conflicts, then pass the
resolved URL to Godot. Advanced Vite configuration belongs under
`web.vite` in `kirie.config.ts`; Kirie owns the base Vite invariants:

```text
root = web.root
base = "./"
server.host = "127.0.0.1"
server.port = 5173
server.strictPort = false
server.open = false
build.outDir = "dist"
```

User-supplied `web.vite` may extend Vite for plugins, aliases, defines, CSS,
JSON, extra assets, proxying, headers, HMR details, Rollup options, and
dependency optimization. It must not override Kirie-owned invariants such as
`root`, `base`, `server.host`, `server.port`, `server.open`, or
`build.outDir`. Explicit command-line flags may override runtime server values
for a single invocation.

Kirie command-line flags are Kirie API, not an implicit promise to support the
entire Vite CLI surface. The current `kirie dev` flags are:

```text
--project <dir>       Godot project directory, defaulting to the current project.
--host <host>         Vite dev server host override.
--port <number>       Vite dev server port override.
--strict-port         Fail if the requested Vite port is unavailable.
--mode <mode>         Vite mode.
--force               Force Vite dependency pre-bundling.
--log-level <level>   Vite log level: info, warn, error, or silent.
--clear-screen        Allow Vite to clear the terminal.
--no-clear-screen     Prevent Vite from clearing the terminal.
```

Kirie must either parse and map Vite-shaped flags explicitly to Vite's public
JavaScript API or proxy them to the real Vite CLI. Unknown flags must fail
instead of being silently ignored. Arguments after `--` on `kirie dev` are
reserved for desktop Godot user arguments:

```sh
kirie dev --host 0.0.0.0 --port 5173 --mode staging -- --verbose
```

`--open` is intentionally not part of `kirie dev` because Kirie launches Godot
instead of opening a browser. `--base`, `--outDir`, and Vite's own `--config`
are also not part of the `kirie dev` surface because Kirie owns those values
through `kirie.config.ts` and the app layout. A Kirie `--config <path>` override
remains planned.

Host-window capabilities remain outside the CLI workflow and are composed by
application code through the Platform packages.

Mobile development targets use one platform command with unified device
selection: `kirie dev ios --device <selector>` and
`kirie dev android --device <selector>`. iOS export and run support both
simulators and physical devices behind the same selector; Kirie may still use
different launch backends internally for simulators, real devices, Android
emulators, and Android devices.

## Packaged web resource loading

`res://` web loading is scoped to resources that are exported with the
application package itself.

For Android, Kirie should resolve `res://` web URLs against files exported into
the APK/AAB assets. For iOS, Kirie should resolve `res://` web URLs against
files exported into the app bundle. Runtime-mounted Godot packs are explicitly
out of scope for this path.

When loading `http://`, `https://`, or `file://` URLs, Kirie should keep using
the platform WebView's default loading behavior instead of intercepting or
rewriting those URLs.

The Kirie CLI app layout uses `res://src-web/dist/index.html` as the default
production entry. The addon export plugin packages `res://src-web/dist` for
Android and iOS exports and fails export when `res://src-web/dist/index.html` is
missing. For Web exports, `kirie export web` copies that build beside the Godot
HTML output at `src-web/dist`; the iframe backend maps only this resource root
to the sibling same-origin tree. The previous `res://web` behavior is not preserved as a compatibility
layer. Users should continue to use Godot's official export preset flow by
default. Kirie may diagnose export preset issues, and explicit setup or repair
commands may write supported preset changes through Godot, but normal run,
build, and export commands must not silently mutate export presets.

## Desktop Godot CEF direction

Kirie now treats Godot CEF as the desktop WebView and IPC backend compatibility
target. The first desktop target is macOS. Windows and Linux should follow the
same shape once macOS works, but iOS and Android continue to use their platform
WebView implementations.

This work is scoped to Kirie's current low-level WebView and IPC surface:

- `create_webview`
- `destroy_webview`
- `load_url`
- `load_html_string`
- `send_text`
- `send_binary`
- `send_data`
- `webview_ready`, `text_received`, `binary_received`, `data_received`, and
  `ipc_error`

Do not expose Godot CEF's full browser-control API as Kirie API just because the
desktop backend can do it. If Kirie later adopts more of the Godot CEF IPC
surface, add each capability only when there is a cross-platform plan for the
Android WebView and iOS WKWebView backends.

The `@gd-kirie/ipc` browser package should not detect backend implementation
details such as `window.sendIpcMessage` or Android channel object names. It
should select its transport from the Kirie runtime platform object:

```ts
interface KiriePlatform {
  os: "android" | "ios" | "macos" | "windows" | "linux";
  backend: "webview" | "wkwebview" | "godot-cef";
}

interface KirieRuntime {
  platform: KiriePlatform;
}

interface Window {
  kirie?: KirieRuntime;
}
```

The runtime object belongs to Kirie, not to Godot CEF. Godot CEF currently
documents renderer-side IPC globals such as `window.sendIpcMessage`,
`window.sendIpcBinaryMessage`, and `window.sendIpcData`, but not a stable
platform-information object.

Desktop Godot CEF binaries are external downloaded artifacts, not part of the
`kirie` npm package. The core plugin descriptor owns the pinned Godot CEF version
and artifact checksum. `kirie doctor` reports
a missing Godot CEF addon as an optional warning. Desktop run or export flows
require it;
if it is missing, fail before export or run and print
`pnpm kirie doctor --fix plugin:core`. Android and iOS workflows must not require
a Godot CEF download.

Downloaded Godot CEF addons should use the standard Godot addon layout:

```text
addons/godot_cef/
```

This lets Godot load the Godot CEF GDExtension normally. Project instances of
that directory should be ignored and not committed. The CLI downloads the
pinned release with progress reporting and checksum verification, verifies the
archive layout, and only then installs it. After installation, the CLI writes
the verified archive checksum to `.godot/kirie/godot-cef.sha256`. This cache is
local to the Godot project. `kirie doctor` compares it with the checksum pinned
in the CLI without another download. The fixer replaces the installation
target when the checksum is missing or different. The public installer command is:

```sh
pnpm kirie doctor --fix plugin:core
```

The repository root declares `kirie` for integration fixtures. Its
mise wrapper runs that root-local binary against the selected Godot project:

```sh
mise run install:godot-cef <godot-project-dir>
```

## JavaScript runtime injection

Kirie browser-side code requires one invariant:

```text
Kirie initializes the JavaScript global before any user page script runs.
```

The injected runtime must be small and must not depend on the DOM. It should only
require `globalThis` or `window`:

```js
globalThis.kirie ??= {};
globalThis.kirie.platform = Object.freeze({
  os: "macos",
  backend: "godot-cef",
});
```

The platform mapping for this pre-page-script injection is:

- Android: `WebViewCompat.addDocumentStartJavaScript`, registered before
  `loadUrl`, `loadData`, or `loadDataWithBaseURL`. Android documents this as a
  document-beginning script that runs before page JavaScript, while the DOM tree
  might not be ready.
- iOS: `WKUserScript` with `WKUserScriptInjectionTime.atDocumentStart`, added to
  the `WKUserContentController` before the `WKWebView` loads content. Apple
  documents this as after creation of the webpage document element but before
  loading other content.
- Godot CEF: set `CefTexture.preload_script` or `preload_script_path` before the
  `CefTexture` node enters the scene tree or before its browser is otherwise
  initialized. Godot CEF documents this as running after its built-in JavaScript
  bridge is registered and before the document loads.

Godot CEF's public Godot-facing API also documents `eval(code)`, but `eval`
executes JavaScript in the browser's main frame after the page exists. Do not use
`eval` for Kirie's runtime initialization because it cannot guarantee that the
runtime is available before the user's module bundle runs.

This mirrors established desktop WebView framework patterns. Electron uses a
preload script that runs before the page is loaded and is commonly used to
expose renderer IPC APIs. Tauri exposes initialization scripts whose documented
timing is after the global object is created but before the HTML document is
parsed and before scripts in the HTML run; it also documents an Android fallback
that prepends initialization scripts to each HTML head when document-start
support is unavailable. Wails serves `index.html` with injected IPC and runtime
scripts. Kirie's HTML rewrite is therefore an intentional first step, not the
final preferred backend hook.

## iOS packaging direction

For the current milestone, iOS should follow the same addon-centered shape as
Android:

- users consume `addons/kirie`
- produced addon trees include `addons/kirie/ios/Kirie.debug.xcframework` and
  `addons/kirie/ios/Kirie.release.xcframework`
- the addon export plugin injects the xcframework, system frameworks, plist
  content, and native initialization glue through Apple export hooks
- example projects should not carry a separate `res://ios/plugins` shim

This is aligned with Godot's iOS plugin model in behavior, while keeping Kirie's
install shape addon-centered:

- Godot's iOS plugin guide defines a native iOS plugin as a static library or
  static-library `.xcframework` with Godot headers, initialization and
  deinitialization entry points, matching Godot compile flags, optional debug
  and release variants, and a `.gdip` descriptor.
- Kirie keeps the same native binary and entry-point model, but does not rely on
  `.gdip` auto-discovery under `res://ios/plugins`. The addon export plugin owns
  discovery and injects the selected framework, plist content, bundle resources,
  and initialization glue through `EditorExportPlugin` Apple embedded platform
  hooks.
- Kirie builds `Kirie.debug.xcframework` from the `ReleaseDebug` configuration
  and `Kirie.release.xcframework` from the `Release` configuration. The
  `ReleaseDebug` naming follows the upstream Godot iOS plugins repository,
  which documents that official debug export templates are compiled with
  `release_debug`, not the full `debug` target.
- Native iOS Godot-facing classes should be registered through ClassDB and bind
  their signals in `_bind_methods` with `ADD_SIGNAL`. This keeps signal metadata
  in Godot's normal object system instead of maintaining a separate callback
  registry in Kirie.

The official iOS plugin documentation still describes `res://ios/plugins`
because that is Godot's automatic plugin discovery path. Kirie's exception is
only the packaging location and activation mechanism; the binary ABI, build
flags, entry points, and exported Xcode integration remain based on Godot's
iOS plugin and Apple embedded platform export APIs.

## GitHub Release addon flow

GitHub Release addon publishing is configured through the `Addon Release`
workflow. Keep it separate from npm package publishing. The npm packages contain
browser APIs, CLI tools, and bundled addons. Optional Tray and Notifications
packages are built and published from kirie-plugins.

The release artifact shape and workflow modes live in
[Addon Release](./addon-release.md).

The .NET Eventa adapter and Platform host use a separate NuGet release lane.
The Tray and Notifications hosts are published from kirie-plugins.
Keep NuGet publishing separate from addon zip publishing and npm publishing.

## IPC and adapter split

Kirie IPC is moving from the previous JSON-shaped message path to explicit
`text`, `binary`, and `data` lanes. Android currently implements this lane shape
over byte-oriented CBOR packets:

- text payloads are CBOR text strings
- binary payloads are CBOR byte strings
- data payloads are a constrained cross-platform data subset: null, booleans,
  numbers, strings, arrays, and maps with string keys

Godot objects, nodes, callables, RIDs, symbols, functions, custom classes,
cycles, dates, regular expressions, and other engine-local or JavaScript-local
values are out of scope for the data lane.

### Godot Web iframe backend

Web exports keep the same `KirieNode` owner and lane API. C# borrows that owner
through `KirieClient.FromNode()`.

The DOM adapter creates, sizes, navigates, and destroys a same-origin iframe.
It transfers a private `MessagePort` after each document load. It must not grow
container APIs, serialization, application protocols, or another JavaScript
runtime. Those responsibilities stay in their existing packages.

The Godot backend uses official
[JavaScriptBridge](https://docs.godotengine.org/en/stable/classes/class_javascriptbridge.html)
APIs. It performs the one required recursive conversion between Godot Variant
containers and native JavaScript containers. Web lane traffic uses structured
clone through the transferred port. Eventa remains an adapter above Kirie IPC.

The Web backend supports same-origin content only. It maps
`res://src-web/dist` to the Vite build beside the exported Godot page. Other
`res://` roots are unavailable to the browser.

C# Web support uses the experimental templates from
`gd-kirie/godot-dotnet-web-templates`. `kirie doctor --fix web` installs and
validates them without installing another Godot editor or writing machine-local
paths into the project. The template
repository owns their build and release workflow. The templates use WebAssembly
threads, so served Web content must be cross-origin isolated; `kirie dev web`
supplies the isolation headers for development. The CLI uses the template's
Python assembler to package the standard .NET host and application assemblies.
It restores the bundled Godot packages with
[NuGet PackageDownload](https://learn.microsoft.com/en-us/nuget/consume-packages/packagedownload-functionality)
into a release-specific cache before resolving the application SDK.

### Data lane type mapping

The data lane keeps one semantic subset across the browser, Godot wrappers, and
Android native code, but each layer uses its own host-language representation:

| Data lane value | TypeScript `@gd-kirie/ipc` | Godot GDScript | Godot C# | Android Kotlin after bridge |
| --- | --- | --- | --- | --- |
| null | `null` | `null` / `TYPE_NIL` | `Variant.Type.Nil` | `null` |
| boolean | `boolean` | `bool` / `TYPE_BOOL` | `Variant.Type.Bool` | `Boolean` |
| integer | `number` | `int` / `TYPE_INT` | `Variant.Type.Int` | `Long` |
| float | `number` | `float` / `TYPE_FLOAT` | `Variant.Type.Float` | `Double` |
| string | `string` | `String` / `TYPE_STRING` | `Variant.Type.String` | `String` |
| array | `KirieData[]` | `Array` / `TYPE_ARRAY` | `Variant.Type.Array` | `Array<*>` |
| map/object | `{ [key: string]: KirieData }` | `Dictionary` / `TYPE_DICTIONARY` | `Variant.Type.Dictionary` | `Dictionary` |

The public Godot API stays Variant-shaped: GDScript exposes
`send_data(value: Variant)`, and C# exposes `SendData(Variant value)`. Android
does not expose a single Kotlin `Any?` entrypoint for all data lane values,
because Godot's Android plugin bridge registers JVM parameter types for
conversion. A Kotlin `Any?` parameter becomes `java.lang.Object`; Godot treats
that as a Java object parameter, not as a general Variant parameter. A Kotlin
`Array<Any?>` parameter becomes JVM `Object[]`; Godot treats that as a typed
JavaObject array, not as a heterogeneous Godot `Array`.

The Godot wrappers therefore validate the root `Variant` kind, place the value
under a private `Dictionary` key, and call one Android `sendData(Dictionary)`
method. The Android plugin unwraps that key immediately before CBOR encoding.
The `Dictionary` exists only at the Godot Android bridge boundary; it is not the
data lane protocol shape, and it does not force CBOR values to be map roots.
Root `null`, scalar, array, and map values are still encoded as their original
CBOR data item.

The relevant Godot 4.7.1 stable sources are
[`GodotPlugin.java`](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/platform/android/java/lib/src/main/java/org/godotengine/godot/plugin/GodotPlugin.java#L129-L161)
method registration,
[`godot_plugin_jni.cpp`](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/platform/android/plugin/godot_plugin_jni.cpp#L72-L91)
native method registration,
[`java_class_wrapper.cpp`](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/platform/android/java_class_wrapper.cpp#L118-L128)
Java object argument validation,
[`java_class_wrapper.cpp`](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/platform/android/java_class_wrapper.cpp#L224-L255)
array argument validation, and
[`jni_utils.cpp`](https://github.com/godotengine/godot/blob/a13da4feb8d8aefc283c3763d33a2f170a18d541/platform/android/jni_utils.cpp#L158-L211)
Variant container conversion.

The browser-side `@gd-kirie/ipc` package uses `cborg` for CBOR. Android native
code uses Jackson CBOR because it provides a dynamic `JsonNode` tree for the
data lane; Kotlinx Serialization CBOR is schema-first and is not used for the
dynamic data lane. Android converts `JsonNode` values into Godot-compatible JVM
objects before emitting Godot signals. Do not add a GDScript CBOR codec for this
path.

Godot CEF is a learning reference and future compatibility target because it
separates `ipc_message`, `ipc_binary_message`, and `ipc_data_message`, with its
data lane documented as CBOR-backed.

Eventa remains above Kirie. `@gd-kirie/ipc-eventa` and
`GdKirie.EventaAdapter` support event emission and unary request/response RPC
over Kirie text IPC. Their JSON messages are adapter encodings, not Kirie core
payload types. Treat `moeru-ai/eventa` and `moeru-ai/eventa.net` as the upstream
Eventa projects; do not change those projects unless an adapter exposes a real
design issue. The .NET adapter lives under `packages/GdKirie.EventaAdapter`,
uses the root `GdKirie.slnx`, and provides a NuGet source bridge for connecting
to addon-shipped `KirieClient.cs` without putting Eventa files in
`addons/kirie`.

`GdKirie.EventaAdapter` is `net10.0` only. Projects targeting `net8.0` or
`net9.0` are expected to fail restore or build when they reference it. Do not
copy Eventa protocol logic into Kirie to bypass the upstream Eventa .NET target
framework.

The Eventa adapter should gain a binary or structured transport after the text
transport proves the event and unary RPC shape. Prefer an explicit opt-in entry
point, such as a data-lane context, before changing the default transport. The
binary transport should use Kirie's CBOR-backed data or binary lane directly
instead of layering another JSON string over it, and it should document any
payload restrictions that come from Kirie's cross-platform data subset.
