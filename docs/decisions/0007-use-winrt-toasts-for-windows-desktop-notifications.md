---
status: "proposed"
date: 2026-09-22
decision-makers: "LemonNeko"
consulted: "Codex"
informed: "Kirie contributors"
---

# Use WinRT toasts for Windows desktop notifications

## Context and Problem Statement

[ADR-0004](0004-add-macos-desktop-notifications.md) added
`notifications.show()` and `notifications.onActivated()` and left Windows as a
separate backend decision. Godot exports an unpackaged executable, and the
existing contract only delivers a click while the Platform host is alive.
[ADR-0006](0006-export-platform-inbound-events-as-eventa-contracts.md) later
replaced that subscription with the `notificationActivated` contract and left
the native callback this decision adds unchanged.

`Microsoft.WindowsAppSDK` is the current packaged-app API, but it requires a
Windows target framework and the Windows App SDK runtime.
`Microsoft.Toolkit.Uwp.Notifications` is the older unpackaged .NET package, and
its maintainers now point callers at the Windows App SDK. Neither package fits
`GdKirie.Platform`, which is one `net10.0` assembly built for every desktop
platform.

## Decision

On Windows 10 version 1607 or later, post a silent toast through
`Windows.UI.Notifications.ToastNotificationManager` and receive the click from
an in-process `INotificationActivationCallback`. This is the same mechanism
[Avalonia.Labs](https://github.com/AvaloniaUI/Avalonia.Labs/tree/main/src/Avalonia.Labs.Notifications/Windows)
uses for unpackaged apps.

The running executable gets one AppUserModelID, derived from its path and
stored under `HKCU\Software\Classes` only while Platform hosts own a
notification callback. The registration is removed with the last host, so a
later click does not start the process. The callback posts Kirie's private
native ID to Godot's main thread. The Platform router then emits the
caller-owned ID on the publishing host's Eventa context.

Linux remains unimplemented.

## Consequences

- The Godot editor and an exported game have different notification identities
  because each identity follows that process's executable, and the identity is
  hashed from the executable path rather than from the project or the game name.
  Renaming or moving the executable changes the identity. Notification settings
  and history stay with the old identity.
- Windows does not show a permission prompt. When notifications are turned off,
  `show()` fails. `IToastNotifier::get_Setting` is not a reliable pre-flight
  check on Windows 11: before the identity has ever delivered, the query itself
  fails with `ERROR_NOT_FOUND` (`0x80070490`) rather than reporting a value. The
  implementation therefore delivers first and only rejects a setting that was
  actually reported as something other than `Allowed`.
- Platform hosts share one process notification listener. Kirie routes each
  click to the host that published it.
- Elevated processes are not supported by this Windows API.
- A crash can leave the per-user registration behind until the next successful
  shutdown removes it. A later click can start the executable through
  `LocalServer32` with `-Embedding`. COM holds the activation until the process
  publishes its first notification and registers the class object.
  A fresh process has no route for the old native ID and ignores it.
- The implementation calls WinRT by vtable and does not take a dependency on
  the Windows App SDK, the archived toolkit, or MicroCom.

## Sources

- [Avalonia.Labs Windows notifications](https://github.com/AvaloniaUI/Avalonia.Labs/tree/main/src/Avalonia.Labs.Notifications/Windows)
- [ToastNotificationManager](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotificationmanager)
- [INotificationActivationCallback](https://learn.microsoft.com/en-us/windows/win32/api/notificationactivationcallback/nn-notificationactivationcallback-inotificationactivationcallback)
- [RoInitialize](https://learn.microsoft.com/en-us/windows/win32/api/roapi/nf-roapi-roinitialize)
- [CoRegisterClassObject](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coregisterclassobject)
- [Application User Model IDs](https://learn.microsoft.com/en-us/windows/win32/shell/appids)
- [WPF app notifications](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-wpf)
