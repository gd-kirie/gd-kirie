# Kirie iOS Plugin

This directory contains the native iOS implementation for `Kirie`, the first-pass transparent web UI layer for the Godot project.

## What this version does

- Exposes `init_kirie` and `deinit_kirie` entry points for the Godot iOS plugin system.
- Registers the `Kirie` Godot singleton.
- Creates a transparent full-screen `WKWebView` through `createWebView`.
- Bridges text, binary, and data IPC lanes with CBOR packets carried through
  `window.webkit.messageHandlers.kirie.postMessage(...)` and `kirie:ipc-packet`
  DOM events.
- Resolves `res://` web URLs to files exported into the app bundle and serves
  them through Kirie's `WKURLSchemeHandler`.

`res://` loading is intentionally limited to packaged application bundle
resources. For example, `res://src-web/dist/index.html` resolves to Kirie's
resource origin and serves the bundled `dist/index.html` generated from
`src-web/dist`.
`res://src-web/dist` resolves to `src-web/dist/index.html`. Runtime-mounted
Godot packs are not part of this path.
`http://`, `https://`, and `file://` URLs keep the default `WKWebView` loading
behavior.

## Tooling

- `xcodebuild`
- `xcodegen` (pinned through mise)
- Apple toolchain from the installed Xcode

The native framework requires iOS 16 or later.

The project definition lives in [project.yml](./project.yml). The generated `.xcodeproj` is intentionally not committed.

## Test

Run the Swift unit tests from the repository root:

```sh
mise run test:swift
```

The XCTest target runs on the macOS host and does not require an iOS Simulator.

## Build

Run the repository-level task:

```sh
mise run build:ios-xcframework
```

The task will:

1. Generate a local Xcode project under `.generated/`
2. Archive `Kirie` for `iphoneos` and `iphonesimulator` in `ReleaseDebug` and
   `Release` configurations
3. Create `Kirie.debug.xcframework` and `Kirie.release.xcframework`
4. Stage both results under `packages/kirie/addon/addons/kirie/ios/`

`ReleaseDebug` is used for `Kirie.debug.xcframework` because Godot's official
iOS plugin references state that debug export templates are built with the
`release_debug` target. The project keeps the Godot-required C++ module flags,
`PTRCALL_ENABLED`, `TYPED_METHOD_BIND`, and the debug-template flags on that
configuration so the plugin binary matches the exported Godot template.

## Runtime configuration

Export-time plist keys are injected by the addon export plugin. WebView debug
capabilities, such as inspectability and invalid TLS certificate bypass, are
controlled by Godot export preset options instead of being tied to the native
framework build configuration.

## Notes

- The WebView is visually transparent, but it still captures touches everywhere it covers.
- Native Swift hosts can expose the C entry points `kirie_attach_host_view` and
  `kirie_detach_host_view` through their bridging header to attach Kirie
  WebViews to an explicit `UIView` container. Existing WebViews move with the
  selected host. Detaching the active host removes its WebViews from the view
  hierarchy while preserving their sessions for the next explicit host. A
  stale detach for a previously replaced host is ignored. Before a host is
  explicitly selected, Kirie retains its legacy active-window hosting behavior.
- Known issue: if iOS shows a system-level modal during early app startup, such
  as an account sign-in prompt, WebView creation can fail before an active host
  window is available. Future lifecycle work should queue creation until the
  host scene or window is ready instead of relying only on bounded retries.
- ATS widening is injected only when the TLS bypass export option is enabled.
- Invalid TLS certificates are bypassed only when the TLS bypass export option is enabled.

## Current packaging direction

- keep iOS native artifacts inside staged `addons/kirie` trees
- inject iOS native pieces through the addon export plugin
- do not depend on `res://ios/plugins` or `.gdip` shims

This differs from Godot's automatic `.gdip` discovery path only in packaging
location. Kirie still follows the native iOS plugin model: it exposes
initialization and deinitialization entry points, links a static-library
xcframework into the exported Xcode project, registers its Godot-facing object
through ClassDB, and binds native signals in `_bind_methods`.
