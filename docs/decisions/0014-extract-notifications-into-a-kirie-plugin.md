---
status: "proposed"
date: 2026-10-10
decision-makers: "LemonNeko"
consulted: "Codex"
informed: "Kirie contributors"
---

# Extract notifications into a Kirie plugin

## Context

Notifications currently belong to `@gd-kirie/platform` and
`GdKirie.Platform`. They are an optional application capability, so this
ownership conflicts with the plugin boundary established by
[ADR-0010](0010-introduce-kirie-plugins-and-the-core-plugin.md). Android and iOS
also have no implementation.

The macOS and Windows implementations already provide the required behavior.
For mobile, the MIT-licensed
[`godot-notification-scheduler`](https://github.com/godot-mobile-plugins/godot-notification-scheduler)
provides maintained Android and iOS implementations. Its release layout expects
project-level iOS plugin files, while Kirie keeps native artifacts under the
owning addon.

## Decision

Create an opt-in notification plugin consisting of:

- `@gd-kirie/notifications` for the browser API and plugin descriptor;
- `GdKirie.Notifications` for Eventa registration, host lifecycle, and native
  runtime selection; and
- `addons/kirie_notifications` for mobile export integration.

The plugin borrows the application's `KirieEventaContext`. Its public API stays
limited to immediate `show({ id, title, body })` and a live
`notificationActivated` event carrying the caller-owned string `id`. The wire
names are `kirie:notifications:show` and `kirie:notifications:activated`.

Remove notification contracts, dependencies, and native code from the Platform
packages without a compatibility shim. The plugin is not included in `core`.

Move the existing macOS RumpSharp and Windows WinRT implementations into
`GdKirie.Notifications` without changing their behavior or supported OS
versions.

On Android and iOS, bridge directly to the upstream
`NotificationSchedulerPlugin` Godot singleton. Pin
`godot-mobile-plugins/godot-notification-scheduler` v6.0 and verify the
`NotificationSchedulerPlugin-Multi-v6.0.zip` asset with SHA-256
`7446e9b1701b04a95106b731bc96dfcff6689c8482e8865866bd63453333f581`.
The bridge requests permission when required, maps `show()` to the upstream
scheduler's shortest supported delay of one second, and uses reserved custom
data to recover the Kirie host and string ID.
Android uses one internal default channel. Activation is not persisted for
cold-start replay.

Install the unmodified upstream tree below
`addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0`. A thin
`EditorExportPlugin` injects its Android AAR, dependencies, and manifest
components or its iOS XCFramework, system frameworks, linker flags, and
initialization glue. The iOS glue composes with the core Kirie initializer.

The export adapter contains no notification behavior. Its maintained source is
TypeScript under `packages/notifications/src-godot`; package builds generate the
GDScript required by Godot, and generated `.gd` files remain outside Git. The
adapter does not create project-level `ios/plugins` files, enable the upstream
editor addon, or modify `export_presets.cfg`.

`kirie doctor --fix plugin:notifications` installs the addon, verified upstream
tree, and matching NuGet package. A focused `examples/notifications` project
replaces the notification UI and host setup previously in
`examples/basic-platform`.

This decision supersedes the ownership boundary in
[ADR-0004](0004-add-macos-desktop-notifications.md) and
[ADR-0007](0007-use-winrt-toasts-for-windows-desktop-notifications.md). Their
selected desktop backends and behavioral limits remain in effect.

## Consequences

- Projects without notifications no longer receive its APIs, dependencies, or
  native artifacts.
- Desktop behavior continues to use the existing implementations.
- Mobile OS integration remains maintained upstream; Kirie owns contract
  adaptation and export metadata.
- Existing applications must migrate imports, plugin configuration, client
  construction, and host registration in one release.
- Updating the pinned upstream release requires reviewing the export adapter.
- Scheduling, cancellation, actions, icons, badges, channels, sounds, and other
  richer features remain outside the Kirie API.

## Rejected Alternatives

- Keeping notifications in Platform would retain an optional capability and its
  dependencies in the core plugin.
- Installing the upstream plugin unchanged would expose a separate GDScript API
  and require project-level iOS plugin files.
- Implementing Kirie-owned mobile backends would duplicate an active upstream
  project and its platform maintenance.

## References

- [`godot-notification-scheduler` v6.0](https://github.com/godot-mobile-plugins/godot-notification-scheduler/releases/tag/v6.0)
- [Godot Android plugins](https://docs.godotengine.org/en/stable/tutorials/platform/android/android_plugin.html)
- [Godot iOS plugins](https://docs.godotengine.org/en/stable/tutorials/platform/ios/ios_plugin.html)
- [Godot `EditorExportPlugin`](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html)
