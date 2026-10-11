---
status: "superseded"
date: 2026-10-10
decision-makers: "Doji"
consulted: "Codex, Lody"
informed: "Kirie contributors"
---

# Use Kirie-owned macOS status items for template icons

Superseded by [ADR-0013](0013-use-tray-icon-for-the-tray-plugin.md), which
replaces the handwritten AppKit and Godot tray implementations with
`tauri-apps/tray-icon`.

## Context

[ADR-0009](0009-add-system-tray-and-menu-capabilities.md) uses Godot
`StatusIndicator` and `PopupMenu` for desktop system trays. This supports
ordinary icons, but Godot does not expose the AppKit `NSImage.isTemplate`
property required for native macOS template-image rendering.

Kirie needs this behavior without patching Godot, distributing another native
artifact, replacing the existing tray contract, or duplicating the complete
menu implementation in AppKit.

## Decision

Add the optional TypeScript field `iconAsTemplate` and matching C# init property
`IconAsTemplate`. Both default to `false`; existing C# constructor and method
signatures remain available.

On macOS, `TrayController` delegates directly to one optional
`MacOsTrayBackend`. The backend:

- creates and removes one AppKit `NSStatusItem`;
- converts the Godot texture to `NSImage` and sets `isTemplate`;
- owns image, tooltip, visibility, click, and cleanup behavior; and
- creates menus with Godot `NativeMenu`, using caller-owned string IDs as item
  tags and activation values.

`TrayController` keeps its existing Godot `StatusIndicator` and `PopupMenu`
implementation inline for other platforms. There is no shared backend
interface or separate wrapper for the Godot path. Passing
`iconAsTemplate: true` outside macOS raises `PlatformNotSupportedException`.

All public tray operations continue to use the existing main-thread guard and
host-owned controller. This change does not modify `addons/kirie`, low-level IPC,
the public GDScript API, or Godot.

## Consequences

- macOS gains native template tinting without a new dependency or binary.
- Existing tray ownership, menu behavior, activation events, and `res://`
  resource paths remain unchanged.
- Kirie now owns the AppKit status-item lifetime and low-level Objective-C
  message signatures on macOS.
- A future Godot API for template status images can replace the backend without
  changing the Tray contract.

## Rejected Alternatives

- **Patch or fork Godot**: requires a custom engine build.
- **Modify Godot's private status item**: depends on an unexposed native handle
  and private implementation details.
- **Implement the complete tray with AppKit**: duplicates menu items, updates,
  submenus, accelerators, and activation mapping already provided by
  `NativeMenu`.

## Implementation Plan

- `packages/tray/src/index.ts` and `index.test.ts`: define and verify the
  optional wire field.
- `packages/GdKirie.Tray/src/TrayController.cs`: retain existing public
  signatures, select the macOS backend, and keep the Godot path inline.
- `packages/GdKirie.Tray/src/Tray/MacOsTrayBackend.cs`: own the AppKit status
  item, image conversion, callback target, and `NativeMenu` resources.
- `examples/tray/`: use monochrome template artwork only on macOS.
- Tray package READMEs and architecture documents: describe the platform
  behavior.

Do not introduce a general backend interface, a second AppKit menu model, a
second Eventa owner, or access to Godot's private native state. No caller
migration, environment variable, project setting, package dependency, or
distributed binary is required.

## Verification

- [x] `mise run lint:eslint`
- [x] `mise run lint:csharp`
- [x] `mise run typecheck`
- [x] `mise run test:unit`
- [x] `mise run test:dotnet`
- [x] `mise x -- pnpm -C examples/tray exec kirie build dotnet`

## References

- [Apple `NSStatusBar` documentation](https://developer.apple.com/documentation/appkit/nsstatusbar)
- [Apple `NSImage.isTemplate` documentation](https://developer.apple.com/documentation/appkit/nsimage/istemplate)
- [Godot `NativeMenu` documentation](https://docs.godotengine.org/en/stable/classes/class_nativemenu.html)
- [Godot `StatusIndicator` documentation](https://docs.godotengine.org/en/stable/classes/class_statusindicator.html)
- [ADR-0009: Add system tray and menu capabilities](0009-add-system-tray-and-menu-capabilities.md)
