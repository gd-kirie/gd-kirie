---
status: "superseded"
date: 2026-08-24
decision-makers: "LemonNeko"
consulted: "Codex"
informed: "Kirie contributors"
---

# Add system-wide global shortcuts to the Platform layer

Superseded by [ADR-0003](0003-use-a-low-level-keyboard-hook-for-windows-global-shortcuts.md).
The public Platform contract remains in use; ADR-0003 replaces the Windows
backend and its conflict semantics.

## Context and Problem Statement

A Godot desktop application can need to respond to an explicitly registered
shortcut while its window is hidden, unfocused, or in the background. Godot's
normal input event path is window-focused and therefore cannot provide this
behavior by itself. Godot has an open
[global-shortcut proposal](https://github.com/godotengine/godot-proposals/issues/1919),
but no released engine API currently satisfies the requirement.

How should Kirie's Platform packages expose dynamic global shortcuts on macOS,
Windows, Linux X11, and Linux Wayland while retaining Godot's familiar logical
key model and avoiding permission-sensitive arbitrary keyboard hooks?

## Decision Drivers

* Shortcuts must work while the Godot application is hidden, unfocused, or in
  the background.
* macOS, Windows, Linux X11, and Linux Wayland are required desktop targets.
* Applications need to register a shortcut only while a feature is active and
  unregister it afterward.
* Consumers need one key-event callback that reports both pressed and released
  transitions, with no events caused by keyboard auto-repeat.
* The API should use Godot-style logical keys, not hardware positions or
  physical keycodes.
* The library must not own product policy such as whether a user accepts a
  compositor or system confirmation dialog.
* The implementation must preserve the existing Platform dependency direction
  and borrow the application's Eventa context.

## Considered Options

* Use only Godot's focused input event system
* Use Godot's shortcut model with native system registration per platform
* Install arbitrary global keyboard hooks

## Decision Outcome

Chosen option: "Use Godot's shortcut model with native system registration per
platform", because it provides background operation on every required desktop
target without broad keyboard monitoring. Godot supplies the public input
semantics; each native backend supplies only the system registration and
pressed/released delivery that Godot does not currently expose.

The capability belongs to `@gd-kirie/platform` and `GdKirie.Platform`. It does
not belong to Kirie's low-level WebView/IPC layer, GDScript API, or any
application such as AIRI.

The public contract has these semantics:

- `register(shortcut, onKeyEvent)` registers one structured shortcut and
  resolves only after the host platform accepts it.
- `unregister(shortcut)` unregisters the same structured shortcut and resolves
  only after the host platform releases it.
- `onKeyEvent` is the shortcut's single event handler. Its event reports whether
  the shortcut was pressed or released.
- A shortcut uses Godot's logical `InputEventKey.keycode` plus the Shift, Alt,
  Ctrl, Meta, and Command-or-Control modifier flags. It does not expose
  `physical_keycode`.
- A canonical shortcut consists of the logical key and normalized modifiers.
  Command-or-Control is resolved for the current operating system before
  canonicalization.
- Registering the same canonical shortcut twice in one Platform host is an
  error. A host-system conflict or refusal is also returned as an error.
- One physical press produces one `onKeyEvent({ state: "pressed" })` call and one
  release produces one `onKeyEvent({ state: "released" })` call. Keyboard
  auto-repeat produces no extra calls.
- Version 1 has no string syntax such as `"Ctrl+Shift+K"` and no arbitrary-key
  monitoring or hook API.

The TypeScript surface uses these shapes. Every modifier field is required:

```ts
interface GlobalShortcut {
  keycode: number;
  shiftPressed: boolean;
  altPressed: boolean;
  ctrlPressed: boolean;
  metaPressed: boolean;
  commandOrControlAutoremap: boolean;
}

interface GlobalShortcutKeyEvent {
  state: "pressed" | "released";
}

interface GlobalShortcutsClient {
  register: (
    shortcut: GlobalShortcut,
    onKeyEvent: (event: GlobalShortcutKeyEvent) => void,
  ) => Promise<void>;
  unregister: (shortcut: GlobalShortcut) => Promise<void>;
}
```

The TypeScript and C# sides use the invoke IDs
`kirie:platform:global-shortcut:register` and
`kirie:platform:global-shortcut:unregister`, plus the normal Eventa event
`kirie:platform:global-shortcut:state-changed`. Its payload contains the
canonical shortcut and `state: "pressed" | "released"`. The TypeScript client
keeps each `onKeyEvent` handler locally and sends only the structured shortcut
across the borrowed Eventa context. It installs the handler before invoking
registration and rolls it back if registration fails; it removes the handler
only after unregistration succeeds. The C# host owns native registrations and
emits state changes back through the same context. Registrations belong to
`GdKiriePlatformHost`; disposing the host unregisters all remaining shortcuts
and native resources.

Native backends use the narrowest platform facility that meets the contract:

- Windows uses
  [`RegisterHotKey`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)
  with `MOD_NOREPEAT` for presses. Since `WM_HOTKEY` reports activation rather
  than release, a small backend-owned release poll uses `GetAsyncKeyState`, the
  same non-hook approach used by
  [Tauri's global-hotkey Windows backend](https://github.com/tauri-apps/global-hotkey/blob/dev/src/platform_impl/windows/mod.rs).
- macOS uses Carbon `RegisterEventHotKey` registration and its pressed/released
  event kinds, following the established
  [Tauri global-hotkey macOS backend](https://github.com/tauri-apps/global-hotkey/tree/dev/src/platform_impl/macos).
- Linux X11 uses `XGrabKey` and consumes the corresponding press and release
  events, following the
  [Tauri global-hotkey X11 backend](https://github.com/tauri-apps/global-hotkey/blob/dev/src/platform_impl/x11/mod.rs).
- Linux Wayland uses the
  [XDG GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html),
  including its `Activated` and `Deactivated` signals. Binding may present
  compositor-owned confirmation UI. The library reports success, cancellation,
  or failure; the terminal product decides how to explain and respond to it.

The Wayland backend uses
[`Tmds.DBus.Protocol` 0.95.0](https://www.nuget.org/packages/Tmds.DBus.Protocol/0.95.0)
for low-level D-Bus access without a generated portal-specific facade.
Its upstream [protocol API](https://github.com/tmds/Tmds.DBus/blob/main/docs/protocol.md)
provides the D-Bus boundary.
macOS and X11 use system frameworks and libraries.

Native callbacks reach Godot's main thread before emitting Eventa state changes.
The feature preserves the existing Platform dependency direction and host-window
behavior.

### Consequences

* Good, because applications can use a focused feature shortcut without keeping
  a Godot window active.
* Good, because registration is explicit and scoped rather than monitoring all
  keyboard input.
* Good, because the public key representation follows Godot's existing
  [`Shortcut` and `InputEventKey`](https://docs.godotengine.org/en/latest/classes/class_shortcut.html)
  concepts.
* Good, because registration lifetime is explicit and cleaned up with the
  existing Platform host.
* Bad, because four native backend paths and their event loops require separate
  implementation and integration coverage.
* Bad, because Wayland compositor behavior and user confirmation are outside the
  library's control.
* Neutral, because a future Godot global-shortcut API may allow native backends
  to be replaced without changing the public Platform contract.

## Pros and Cons of the Options

### Use only Godot's focused input event system

* Good, because it adds no native integration.
* Good, because it directly uses Godot's event and shortcut types.
* Bad, because it cannot satisfy the defining background and unfocused-window
  requirement.

### Use Godot's shortcut model with native system registration per platform

* Good, because it combines a familiar logical-key API with actual system-wide
  registration.
* Good, because it registers only combinations requested by the application.
* Bad, because each desktop environment exposes different registration and
  lifecycle behavior.

### Install arbitrary global keyboard hooks

* Good, because hooks can observe keys and releases even where a registration
  API is limited.
* Bad, because they monitor more input than the requested feature needs and can
  require accessibility or input-monitoring permission.
* Bad, because permission and security implications would make the library
  contract and terminal-product behavior more complex.

## More Information

This decision deliberately leaves a hook-based arbitrary keyboard listener for
a separate future decision. Revisit the native implementations when Godot's
global-shortcut proposal lands in the repository's supported engine version, or
when a required operating system removes one of the selected registration APIs.
