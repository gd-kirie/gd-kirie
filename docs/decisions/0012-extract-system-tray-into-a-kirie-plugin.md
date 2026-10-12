---
status: "superseded"
date: 2026-10-10
decision-makers: "Doji"
consulted: "Codex"
informed: "Kirie contributors"
---

# Extract the system tray into a Kirie plugin

Superseded by [ADR-0013](0013-use-tray-icon-for-the-tray-plugin.md), which
retains the independent Tray plugin and its Eventa ownership while replacing
the native implementation and distribution constraint.

## Context

[ADR-0009](0009-add-system-tray-and-menu-capabilities.md) placed Tray inside
the Platform packages. This makes the capability part of the core installation,
couples its wire contract to Platform, and prevents applications from selecting
Tray independently through the plugin system introduced by
[ADR-0010](0010-introduce-kirie-plugins-and-the-core-plugin.md).

The macOS template-icon work in
[ADR-0011](0011-own-macos-status-items-for-template-icons.md) gives Tray its
own native lifecycle, making the package boundary explicit before that API is
released.

## Decision

Move the complete Tray capability into two independently published packages:

- `@gd-kirie/tray` owns browser types, `createTrayClient`, Eventa contracts,
  and the `@gd-kirie/tray/plugin` descriptor;
- `GdKirie.Tray` owns contract registration, the host, controller, Godot menu
  implementation, and the macOS AppKit implementation.

The descriptor declares only `GdKirie.Tray`. Applications enable it explicitly
beside `core`, then register and attach its C# host to the application's existing
Eventa registry and context. The wire prefix is `kirie:tray:*`.

Remove Tray from `@gd-kirie/platform` and `GdKirie.Platform`. Do not retain
compatibility re-exports, forwarding handlers, runtime plugin hooks, another
Eventa owner, or a Godot addon. Existing Tray behavior, including
`iconAsTemplate`, remains unchanged.

## Consequences

- Applications install and initialize only the capability they select.
- Tray owns its public API, wire names, native resources, and release artifacts.
- Existing Platform Tray imports and `kirie:platform:tray:*` callers must migrate.
- The core plugin continues to install Platform for its remaining capabilities;
  extracting those capabilities is outside this decision.

## Implementation Plan

- Add `packages/tray/` and `packages/GdKirie.Tray/`.
- Remove Tray contracts and lifecycle code from `packages/platform/` and
  `packages/GdKirie.Platform/`.
- Configure `examples/tray/` with `[core, tray]` and initialize only the Tray
  runtime API.
- Add both packages to workspace release, publishing, and architecture docs.
- Keep both package versions aligned with the repository release version; add
  no third-party runtime dependency.
- Follow the existing Eventa `Register`/`Attach` host pattern and declarative
  plugin descriptor. Avoid compatibility forwarding and runtime plugin hooks.
- Keep one TypeScript request/response contract test and compile the C# host
  against the Godot .NET SDK.

## Verification

- [x] `mise run lint:eslint`
- [x] `mise run lint:csharp`
- [x] `mise run typecheck`
- [x] `mise run test:unit`
- [x] `mise run test:dotnet`
- [x] `mise run build:packages`
- [x] `mise x -- pnpm -C examples/tray exec kirie build dotnet`
- [x] No Tray symbols or `kirie:platform:tray:*` wire IDs remain in either
  Platform package.

## Rejected Alternatives

- **Add only a plugin descriptor**: installation would look optional while the
  runtime capability remained owned and installed by Platform.
- **Keep compatibility forwarding layers**: duplicates the public contract and
  weakens the new ownership boundary without a confirmed compatibility need.

## References

- [Godot `StatusIndicator`](https://docs.godotengine.org/en/stable/classes/class_statusindicator.html)
- [Godot `NativeMenu`](https://docs.godotengine.org/en/stable/classes/class_nativemenu.html)
- [Apple `NSImage.isTemplate`](https://developer.apple.com/documentation/appkit/nsimage/istemplate)
