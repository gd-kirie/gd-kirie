# Android

This directory hosts the Kotlin-based Android implementation for Kirie.

Current direction:

- based on the standard Godot Android v2 plugin template
- structured as an Android library root with a `plugin` module
- depends on the Godot Android library matching the repo's target Godot version
- ships to staged Godot addon trees as local AAR files through
  `EditorExportPlugin`
- can also publish `moe.gdkirie.kirie:core` to Maven Central for Gradle
  hosts; see [`docs/maven-publishing.md`](../../../../docs/maven-publishing.md)

Current responsibility:

- create and manage the Android WebView
- expose a Godot Android plugin singleton
- bridge low-level CBOR IPC lanes between Godot and web content
- resolve `res://` web URLs to files exported into the APK/AAB assets

Android IPC currently uses AndroidX WebKit `WebMessageListener` channels with
ArrayBuffer payloads. The browser side sends and receives CBOR through
`@gd-kirie/ipc`; native Android code encodes and decodes CBOR with Jackson CBOR.
Text maps to `String`, binary maps to `ByteArray`, and data maps through
Jackson `JsonNode` into Godot-compatible values.

`res://` loading is intentionally limited to packaged application assets. The
Android implementation rewrites `res://` URLs to Kirie's local asset origin and
serves the matching APK/AAB asset through the WebView request handler. For
example, `res://src-web/dist/index.html` resolves to `src-web/dist/index.html`,
and `res://src-web/dist` resolves to `src-web/dist/index.html`. Runtime-mounted
Godot packs are not part of this path. `http://`, `https://`, and `file://`
URLs keep the default Android WebView loading behavior.

The addon export plugin automatically adds `res://src-web/dist` files to
Android exports and fails export when `res://src-web/dist/index.html` is
missing. User projects do not need an export preset `include_filter` entry for
that web build output.

Runtime configuration is injected by the addon export plugin as Android
application manifest metadata. WebView inspection and invalid TLS certificate
bypass are controlled by Godot export preset options instead of being tied to the
native AAR build configuration.

Notes:

- The current skeleton was adapted from the official Godot Android v2 plugin
  template at commit `089491f`.
- Local AAR export follows Godot's Android plugin v2 and `EditorExportPlugin`
  hooks; see `docs/references.md` for the official Godot references.
- Build staged AARs with `mise run build:android-aar`.
- Exported projects use the release AAR by default. Local Kirie development can
  select the debug AAR for Android native debugging by passing
  `-- --kirie-android-aar=debug` to the Godot export command.
- Exported applications read their engine command line arguments from the export
  preset. A single export can replace them by passing
  `-- --kirie-android-extra-args=<arguments>` to the Godot export command, for
  example to select a renderer on an emulator without changing the preset.
- Demo packaging from the upstream template was intentionally removed because
  this repository keeps Godot-facing addon files under
  `packages/kirie/addon/addons/kirie/`.
