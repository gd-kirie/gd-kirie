---
status: "superseded"
date: 2026-10-04
decision-makers: "LemonNeko"
consulted: "Codex, Lody"
informed: "Kirie contributors"
---

# Add system tray and menu capabilities to the Platform layer

Superseded by [ADR-0012](0012-extract-system-tray-into-a-kirie-plugin.md),
which moved the capability from Platform into the Tray plugin. Later,
[ADR-0013](0013-use-tray-icon-for-the-tray-plugin.md) replaced the Godot and
AppKit implementations with `tray-icon`.

## Context

Desktop Kirie applications need to create a system tray icon, attach native
menus, update their state, and receive user activations. Applications may own
that behavior in their C# host, in their browser application, or in both.

Godot already exposes these facilities through `StatusIndicator` and
`PopupMenu`. Kirie should preserve those semantics instead of introducing a
separate menu renderer or a reduced application-specific menu model. The
capability belongs above the low-level WebView and IPC layers because it owns
application UI and behavior rather than WebView transport.

The browser cannot pass Godot objects such as `Texture2D` through Eventa. It
also has a shorter connection lifetime than the application host: navigation
or a page reload must not implicitly destroy an existing tray icon or menu.

## Decision

Add system tray and menu capabilities to `GdKirie.Platform` and
`@gd-kirie/platform`. Do not add them to `addons/kirie`, `@gd-kirie/ipc`, or
the public GDScript API.

The attached C# Platform host owns one tray controller backed by a Godot
`StatusIndicator` and its `PopupMenu` nodes. It creates, updates, and destroys
those nodes on Godot's main thread and releases them when the Platform host is
disposed. Browser navigation and Eventa reconnection do not change that
lifetime.

C# and browser callers operate the same controller and menu state:

- C# calls the controller directly and receives idiomatic C# events.
- `@gd-kirie/platform` invokes matching Eventa contracts handled by the C#
  host.
- Calls take effect in main-thread execution order. A later update replaces
  the affected earlier state regardless of which entry point produced it.
- Kirie does not add a lease, separate C# and browser menu regions, or a
  second browser-owned menu state.

The public surface follows the relevant `StatusIndicator` and `PopupMenu`
capabilities, including their item kinds, submenus, shortcuts, icons, and
mutable item state. Kirie maps caller-owned stable string IDs to Godot's menu
indices and 32-bit item IDs. It owns the mapping and rebuilds it whenever menu
structure changes; applications do not depend on Godot indices.

C# may provide Godot resources such as `Texture2D` directly. Eventa payloads
use serializable resource references. Browser callers may reference imported
Godot resources with `res://` paths, but they do not send PNG or SVG bytes,
data URLs, or web URLs as image content.

Every menu-item activation raises the C# activation event and emits the
matching inbound Eventa contract with the same stable item ID. Kirie does not
add a second raw status-indicator press API: Godot does not emit that signal
while a menu is attached.

Unsupported platforms fail at the capability boundary instead of silently
creating an inert controller. Kirie checks the current display server's
`StatusIndicator` feature instead of maintaining a platform list. Linux support
therefore follows Godot's implementation when it becomes available; Kirie does
not add a parallel native tray backend.

This decision does not define what closing an application window does. Hiding,
minimizing, removing a taskbar or Dock entry, keeping the process alive, and
quitting remain separate application-lifecycle decisions.

## Consequences

- C# hosts and browser applications can configure the same tray and menu
  without creating competing owners.
- A configured tray survives browser reloads and remains usable by C# while no
  browser subscriber is connected.
- Applications that subscribe in both C# and JavaScript receive both
  notifications and must avoid running the same business action twice.
- TypeScript and C# contracts must keep stable IDs, item semantics, resource
  references, and errors aligned.
- Native desktop validation is required because headless integration tests
  cannot prove that a system tray icon or native menu is visible and usable.
- Kirie inherits the capabilities and platform differences of Godot's
  `StatusIndicator` and `PopupMenu` implementations.

## Rejected Alternatives

### Support configuration only from C#

This prevents browser-owned application state, localization, and commands from
driving the menu through the application's existing Eventa context.

### Make the browser the tray owner

This ties native resources to page readiness and makes navigation or reload
implicitly affect application-owned desktop UI.

### Keep separate C# and browser menu state

Two state stores can disagree about item identity, ordering, checked state, and
resource lifetime while still targeting one operating-system tray icon.

### Add tray APIs to the low-level Kirie addon

System tray behavior is an application capability. Adding it to the WebView
and IPC core would cross the existing package boundary and expose application
behavior through GDScript.

### Transfer image bytes through Eventa

Encoding image content into JSON adds a second asset-loading path without a
confirmed use case. Packaged tray and menu icons can use Godot resource
references, while C# callers retain direct access to Godot resource types.

## References

- [Godot `StatusIndicator` documentation](https://docs.godotengine.org/en/stable/classes/class_statusindicator.html)
- [Godot `PopupMenu` documentation](https://docs.godotengine.org/en/stable/classes/class_popupmenu.html)
- [Godot system tray guide](https://docs.godotengine.org/en/stable/tutorials/ui/creating_applications.html#creating-an-icon-in-the-system-tray)
- [ADR-0006: Export Platform inbound events as Eventa contracts](0006-export-platform-inbound-events-as-eventa-contracts.md)
