# godot-kirie

Kirie is an experimental Godot application framework built around an embeddable
low-level Godot WebView plugin and IPC core.

## Installation

CLI-managed projects enable the WebView stack through the core plugin:

```sh
pnpm kirie doctor --fix plugin:core
```

Import `kirie/plugin/core` in `kirie.config.ts` and add it to the explicit
`plugins` array before running doctor. The fix installs the bundled Kirie
addon and downloads the desktop Godot CEF backend.
After `kirie init`, run `pnpm install` and `pnpm kirie doctor --fix` in the
generated project.

For manual installation, download `kirie-addon.zip` from a GitHub Release
asset and extract it into your Godot project root. The final layout should be:

```text
res://addons/kirie/
```

If your project already has an `addons` directory, merge the extracted `addons`
directory into the project root. Do not extract the zip inside the existing
`addons` directory.

After copying the files, enable Kirie from Godot's Project Settings Plugins tab.
This follows Godot's plugin installation flow. Release packaging details live in
[docs/addon-release.md](docs/addon-release.md).

## Kirie plugins

A Kirie plugin is an npm package that exports a descriptor created with
`defineKiriePlugin` from `kirie/plugin`. Descriptors declare an ID plus
Godot addon and .NET package dependencies. Addons may be bundled with the npm
package or downloaded from a SHA-256-pinned archive; .NET dependencies use
evaluated MSBuild items for checks and `dotnet package add` for fixes.

Projects enable plugins explicitly:

```ts
import core from "kirie/plugin/core";
import { defineKirieConfig } from "kirie";

export default defineKirieConfig({
  plugins: [core],
});
```

`kirie doctor plugin:core` checks one configured plugin, and
`kirie doctor --fix plugin:core` installs or repairs its declared
dependencies. Core owns the Kirie and Godot CEF addons together with the
`GdKirie.EventaAdapter` and `GdKirie.Platform` NuGet packages. Doctor skips
NuGet checks and fixes when the Godot project has no `.csproj`.

Capabilities such as the system tray are separate plugins. Import
`@gd-kirie/tray/plugin`, add it beside `core`, and run
`kirie doctor --fix plugin:tray` to install its GDExtension and `GdKirie.Tray` host.

## Repository Development

Install the workspace tools and dependencies from the repository root:

```sh
mise install
mise x -- pnpm install --frozen-lockfile
mise run build:packages
```

## Export Options

Kirie adds Godot export preset options under `kirie/debug`:

- `enable_web_inspector`: enable platform WebView inspection for exported apps.
- `allow_tls_bypass`: allow invalid TLS certificates for exported apps. On iOS,
  enabling this also relaxes App Transport Security (ATS) by allowing arbitrary
  loads, which can permit insecure cleartext HTTP requests in addition to bypassing
  invalid TLS certificates.

Both options default to disabled and are intended for development exports only.
In particular, `allow_tls_bypass` reduces transport security and must not be
enabled for production builds.

## Current Architecture

```mermaid
flowchart LR
    A["Godot Project"] --> B["addons/kirie"]
    B --> C["GdKirie / KirieNode / KirieClient"]
    C --> D["Android native implementation"]
    C --> E["iOS native implementation"]
    D <--> F["WebView"]
    E <--> F
    F <--> G["Web app / page"]
```

The repository is still deliberately small, but it now has distinct package,
example, and regression-test areas:

- `packages/kirie`: the Godot addon, C# wrapper, and Android and iOS native
  plugin code
- `packages/ipc`: a thin browser-side transport wrapper for Kirie WebView pages
- `packages/ipc-eventa`: browser-side Eventa adapter over Kirie text IPC
- [`@gd-kirie/platform`](packages/platform/README.md): browser-side desktop host
  capabilities
- [`@gd-kirie/tray`](packages/tray/README.md): browser-side system tray plugin
- [`@gd-kirie/notifications`](packages/notifications/README.md): cross-platform
  system notifications and its Kirie plugin descriptor
- `packages/build`: public build and export automation API for scripts
- `packages/cli`: Kirie command-line tools for development sessions, export,
  install, and launch workflows
- [`@gd-kirie/vitest`](packages/vitest/README.md): ViDot launch adapter for
  Kirie desktop, Android, and iOS tests
- `packages/GdKirie.EventaAdapter`: .NET 10 Eventa adapter over Kirie text IPC
- [`GdKirie.Platform`](packages/GdKirie.Platform/README.md): Godot host for the
  Platform Eventa contract
- [`GdKirie.Tray`](packages/GdKirie.Tray/README.md): Godot host for the Tray
  Eventa contract
- [`GdKirie.Notifications`](packages/GdKirie.Notifications/README.md): Godot
  notification host and native platform adapters
- `examples/basic-ipc`: beginner-friendly demo project for the raw IPC flow
- `examples/basic-kirie-cli`: beginner-friendly demo project for the Kirie CLI workflow
- `examples/basic-platform`: desktop window and shortcut capabilities
- [`examples/tray`](examples/tray/README.md): desktop system tray example
- [`examples/notifications`](examples/notifications/README.md): immediate
  notifications and activation feedback
- `examples/eventa-csharp`: beginner-friendly demo project for Godot C# Eventa adapter usage
- `tests/integration`: exported-app platform integration tests
- `scripts`: repository build, test, and release tasks
- `docs`: project notes and design decisions
  - `docs/dreams`: exploratory notes for ideas outside the current milestone

Primary references live in [docs/references.md](docs/references.md).

The low-level plugin and IPC milestone covers:

1. Create a WebView on mobile and desktop platforms.
2. Establish bidirectional IPC between Godot and the WebView.
3. Support packaged `res://` web content loading for bridge tests.
4. Add desktop Godot CEF compatibility, starting with macOS.
5. Stabilize the Kirie plugin shape used by higher-level framework tooling.

The plugin and IPC layers are intended to stay low-level WebView and IPC
surfaces. A small `@gd-kirie/ipc` browser package exists as a convenience
transport wrapper. Eventa adapters live above that bridge:
`@gd-kirie/ipc-eventa` for browser pages, and `GdKirie.EventaAdapter` for
.NET 10 C# projects. The C# surface is a thin `KirieClient` wrapper over the
same platform singleton used by GDScript, with C# events for the current Kirie
signals.

The mobile IPC experiment uses explicit text, binary, and data lanes over CBOR
packets. The browser package encodes and decodes those packets with `cborg`.
Android native code uses Jackson CBOR and converts structured data through
Jackson's tree model before emitting Godot-compatible values. iOS native code
uses SwiftCBOR and carries CBOR packets as base64 strings through WKWebView
script messages. JSON and Eventa envelopes remain caller or adapter choices
carried over the text lane, not Kirie core payload types.

Desktop compatibility starts with Godot CEF as Kirie's desktop WebView backend,
with macOS as the first target. Scope and runtime-injection details live in
[docs/architecture.md](docs/architecture.md).

`GdKirie.EventaAdapter` intentionally targets `net10.0` because the upstream
Eventa .NET package targets `net10.0`, and .NET 8 LTS reaches end of support on
2026-11-10. Godot C# projects targeting `net8.0` or `net9.0` should expect
restore or build failures when referencing the adapter.
