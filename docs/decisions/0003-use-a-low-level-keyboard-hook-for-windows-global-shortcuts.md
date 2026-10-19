---
status: "accepted"
date: 2026-08-31
decision-makers: "LemonNeko"
consulted: "Codex"
informed: "Kirie contributors"
---

# Use a low-level keyboard hook for Windows global shortcuts

## Context and Problem Statement

[ADR-0002](0002-add-system-wide-global-shortcuts.md) selected
`RegisterHotKey` plus release polling for Windows. `RegisterHotKey` reports
activation through `WM_HOTKEY`, but it does not report key release. Supporting
the existing `pressed` and `released` contract would therefore require polling
the registered primary key.

Windows can instead report both transitions through `WH_KEYBOARD_LL` without a
macOS-style Accessibility or Input Monitoring consent prompt. The hook observes
the keyboard stream for the current desktop, so it has a broader internal
capability than native hot-key registration even when Kirie exposes only
explicitly registered combinations.

## Decision

The Windows backend uses one lazy process-wide `WH_KEYBOARD_LL` hook on a
dedicated background thread. The hook starts when the first Windows shortcut is
registered and stops synchronously after the last registration is removed.
Each `GdKiriePlatformHost` still owns its registrations and callback lifetime.

The native callback handles key-down and key-up transitions, never suppresses
input, and always chains through `CallNextHookEx`. It does not expose arbitrary
keyboard events. Kirie filters the stream to structured shortcuts registered
through the existing Platform API, suppresses auto-repeat, and emits one
`pressed` followed by one `released` state.

Godot logical keys resolve to Windows scan-code signatures at registration by
using Godot's physical-to-logical layout mapping. Modifier state tracks left
and right Shift, Alt, Control, and Windows keys independently, then collapses
them to the existing public modifier booleans. AltGr therefore follows the
Windows event stream and may satisfy a Control+Alt shortcut.

Hook callbacks post accepted state changes to the captured Godot main-thread
`SynchronizationContext`. Delivery revalidates the registration token so no
queued event is emitted after unregistration completes.

Windows registration is non-exclusive. It means that Kirie's filter is active
after the hook starts; it does not reserve the combination or detect that
another process uses the same shortcut. This replaces ADR-0002's Windows
system-conflict behavior. macOS and future Linux backends retain their own
native registration behavior.

## Consequences

- Press and release are event-driven, with no release timer or polling loop.
- Multiple Platform hosts share one native hook while retaining host-scoped
  registration tokens and cleanup.
- The process can observe keyboard events on its current Windows desktop while
  at least one shortcut is registered, although unrelated events are discarded
  and never exposed.
- Normal desktop use introduces no permission prompt, but Windows secure
  desktops, sessions, and integrity boundaries still apply.
- The callback must remain fast and exception-safe. Windows may silently remove
  a low-level hook whose callback exceeds `LowLevelHooksTimeout`.
- Kirie cannot report external shortcut conflicts on Windows.
- No keyboard suppression, arbitrary listener, physical-key API, text
  conversion, simulation, mouse hook, or process-lifetime hook is introduced.

## Sources

- [SetWindowsHookExW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw)
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
- [CallNextHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-callnexthookex)
- [UnhookWindowsHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-unhookwindowshookex)
