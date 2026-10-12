---
status: "proposed"
date: 2026-10-10
decision-makers: "LemonNeko"
consulted: "Codex"
informed: "Kirie contributors"
---

# Extract notifications into a Kirie plugin

## Context and Problem Statement

Kirie currently exposes notifications through `@gd-kirie/platform` and
implements them inside `GdKirie.Platform`. This makes an optional application
capability part of the core plugin even though notifications do not belong to
the low-level WebView and IPC stack. It also leaves Android and iOS without an
implementation.

[ADR-0010](0010-introduce-kirie-plugins-and-the-core-plugin.md) introduced
explicit Kirie plugins for capabilities with a browser API, Godot integration,
and an optional .NET host. Notifications are the first existing Platform
capability to move to that boundary.

The desktop implementation already has the required behavior on macOS and
Windows. For mobile, the MIT-licensed
[`godot-notification-scheduler`](https://github.com/godot-mobile-plugins/godot-notification-scheduler)
plugin provides maintained Android and iOS native implementations. Its release
archive assumes the conventional `res://ios/plugins/*.gdip` layout, where a
`.gdip` file is Godot's iOS plugin descriptor. Kirie keeps native artifacts
inside its public addon and injects them through an `EditorExportPlugin`, so
installing the upstream archive unchanged at the project root would violate
Kirie's addon packaging boundary.

How should Kirie separate its current notification API, retain the desktop
behavior, and reuse the upstream mobile implementation without making
notifications part of the core addon?

## Decision Drivers

* Keep the core plugin limited to the WebView, IPC, Eventa adapter, and current
  Platform host.
* Preserve the existing notification contract: show an immediate notification
  with string `id`, `title`, and `body`, then report activation with the same
  caller-owned `id` while the host is alive.
* Move the existing macOS and Windows code instead of rewriting it.
* Reuse the upstream Android and iOS implementation and track one pinned,
  integrity-checked release.
* Keep all installed mobile artifacts under `addons/kirie_notifications` and
  avoid project-local `ios/plugins` shims.
* Borrow the application's existing Eventa context and preserve TypeScript/C#
  wire alignment.
* Do not expand the public notification API as part of the extraction.

## Considered Options

* Create a dedicated Kirie plugin with a thin mobile export adapter.
* Keep notifications in Platform and add mobile branches there.
* Install and expose the upstream plugin unchanged.
* Implement new Kirie-owned Android and iOS notification backends.

## Decision Outcome

Chosen option: **Create a dedicated Kirie plugin with a thin mobile export
adapter**, because it gives notifications an explicit capability boundary,
preserves the proven desktop code, and reuses the upstream native code while
keeping Kirie's addon-centered packaging model.

### Public packages and contracts

Create these packages:

* `@gd-kirie/notifications`, containing the browser API and the default Kirie
  plugin descriptor with ID `notifications`;
* `GdKirie.Notifications`, containing Eventa registration, host lifecycle, and
  desktop/mobile runtime selection; and
* `addons/kirie_notifications`, containing only the Godot editor/export
  integration needed by the mobile native artifacts.

The TypeScript package exports `NotificationRequest`,
`NotificationActivated`, `NotificationsClient`, `createNotificationsClient`,
and `notificationActivated`. Its public behavior remains:

```ts
interface NotificationRequest {
  id: string;
  title: string;
  body: string;
}

interface NotificationActivated {
  id: string;
}

interface NotificationsClient {
  show(notification: NotificationRequest): Promise<void>;
}
```

`createNotificationsClient(context)` borrows a `KirieEventaContext`. It does
not create or own a second IPC or Eventa context. The fixed wire names are:

* `kirie:notifications:show`
* `kirie:notifications:activated`

The C# entry point follows the existing Platform registration and attachment
pattern:

```csharp
GdKirieNotifications.Register(registry);
using var notifications = GdKirieNotifications.Attach(context, owner);
```

`owner` is an in-tree Godot `Node`; passing the host `Window` is valid. Attach
and disposal run on Godot's main thread, and the returned host detaches when
the owner exits the tree. Multiple attached hosts share one native listener.
An activation is routed only to the live Eventa host that showed it.

The old `PlatformClient.notifications` member, Platform notification types,
Platform notification wires, and `GdKirie.Platform` notification registration
are removed in the same release. Kirie does not retain a compatibility shim or
serve both wire namespaces. Consumers install and configure the new plugin,
create its client, and subscribe to its exported activation contract.

### Desktop implementation

Move `Notifications`, `NotificationRouter`, `MacOsNotificationRuntime`,
`WindowsNotificationRuntime`, `WindowsToastApi`, and the notification-specific
WinRT interop from `GdKirie.Platform` to `GdKirie.Notifications`. Preserve the
current behavior and supported versions:

* macOS 11 or later uses RumpSharp, requests authorization on the first show,
  presents in the foreground, and does not play a sound;
* Windows 10 version 1607 or later uses the existing unpackaged WinRT toast and
  live COM activator implementation; and
* unsupported desktop systems continue to throw
  `PlatformNotSupportedException`.

Move the `RumpSharp` package reference to `GdKirie.Notifications`.
`Microsoft.Windows.CsWin32` remains in `GdKirie.Platform` for global shortcuts
and is also referenced by `GdKirie.Notifications` for the moved Windows code.

### Mobile implementation

Pin `godot-mobile-plugins/godot-notification-scheduler` v6.0. The plugin
descriptor downloads the
[`NotificationSchedulerPlugin-Multi-v6.0.zip`](https://github.com/godot-mobile-plugins/godot-notification-scheduler/releases/download/v6.0/NotificationSchedulerPlugin-Multi-v6.0.zip)
GitHub release asset and verifies SHA-256
`7446e9b1701b04a95106b731bc96dfcff6689c8482e8865866bd63453333f581`.
Its remote addon source uses archive path `res`. Doctor installs that tree under
`addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0` after it
installs the bundled Kirie adapter. The upstream files remain unmodified. The
package README and release notices retain the upstream attribution and MIT
license.

On Android and iOS, `GdKirie.Notifications` talks directly to the upstream
`NotificationSchedulerPlugin` engine singleton. It initializes the singleton
once per process, connects its permission and notification signals once, and
disconnects them after the last Kirie notification host detaches. Godot object
access and `schedule` calls stay on the main thread.

`show()` adapts the current contract to an immediate upstream schedule:

* request notification permission when it has not been granted; concurrent
  calls await one in-flight permission request;
* reject the invoke if permission is denied or initialization/scheduling fails;
* schedule with zero delay using the caller's title and body;
* allocate a process-local integer required by the upstream API; and
* store the live Kirie host ID and caller-owned string notification ID in
  reserved upstream custom-data fields so click events can restore the current
  `{ id }` activation payload.

Android uses one internal channel with ID `kirie.notifications.default`. Its
display name comes from `application/config/name`, falling back to `Kirie`, and
its importance is the upstream default. The channel is an implementation
detail because this ADR does not add channel configuration to the public API.

The adapter does not persist activation events for a future Eventa host. A
cold-start click that arrives before a notification host is attached is not
replayed. This preserves the current live-host activation model.

### Mobile export adapter

The bundled `addons/kirie_notifications` editor plugin registers a thin
`EditorExportPlugin`. It has no notification scheduling or activation logic.
It reads the pinned vendor files from fixed paths and reproduces only the
upstream release metadata needed for export:

* Android: select the upstream debug or release Android Archives (AARs), add
  its Maven dependencies, permissions, and manifest fragments, including
  Android 13+ notification permission declarations.
* iOS: select the matching upstream XCFrameworks, add required system
  frameworks and linker flags, and add initialization/deinitialization glue
  derived from the upstream `.gdip` metadata.

The iOS glue must compose with the existing `addons/kirie` initializer so both
native plugins register and deregister exactly once in the same exported app.
Each injected C++ fragment uses a unique continuation symbol and safely
redefines Godot's generated initializer macro, independent of addon load order.
Make the existing Kirie fragment use the same composable chaining rule; it must
not gain notification-specific symbols or paths.

The adapter must fail export with a path-specific error when a selected vendor
artifact is absent. It must not copy files to `res://ios/plugins`, enable the
vendored upstream editor addon, modify `export_presets.cfg`, or reimplement any
native notification behavior.

The notifications plugin is not included in `kirie/plugin/core`. A project
enables it explicitly:

```ts
import notifications from "@gd-kirie/notifications";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";

export default defineKirieConfig({
  plugins: [core, notifications],
});
```

### Notifications example

Create `examples/notifications` as a focused capability example, following the
project structure and presentation of `examples/tray`. Move the notification
form, `notificationActivated` subscription, activation result display, host
registration, platform-specific usage notes, and export instructions out of
`examples/basic-platform` into this project.

The example depends on `@gd-kirie/notifications`, configures both `core` and
`notifications`, and demonstrates only the current immediate show and live
activation flow. `examples/basic-platform` must no longer import notification
contracts, construct a notifications client, register its C# host, render
notification controls, or describe notification behavior in its README.

### Consequences

* Good, because projects that do not use notifications no longer receive its
  browser surface, NuGet dependency, desktop libraries, or mobile artifacts.
* Good, because desktop behavior remains based on the existing tested code.
* Good, because mobile behavior and OS compatibility remain owned upstream
  while Kirie owns only contract adaptation and export packaging.
* Good, because the same string ID and activation event work across supported
  desktop and mobile targets.
* Bad, because existing applications must change imports, configuration, host
  registration, and client construction in one breaking migration.
* Bad, because the export adapter must be checked whenever the pinned upstream
  release changes, especially its AAR dependencies, `.gdip` entry points, and
  iOS linker requirements.
* Neutral, because scheduling, cancellation, replacement, actions, icons,
  progress, badges, channels, sounds, and explicit permission APIs remain
  unavailable through Kirie even where the upstream plugin supports them.

## Implementation Plan

* **Affected paths**:
  * Add `packages/notifications/` with its package metadata, plugin descriptor,
    TypeScript API, tests, bundled `addons/kirie_notifications`, and README.
  * Add `packages/GdKirie.Notifications/` with its NuGet metadata, Eventa JSON
    contracts, notification host, moved desktop files, mobile adapter, and
    README; add it to `GdKirie.slnx`.
  * Remove notification types, events, client construction, handlers, source
    files, and notification-only dependencies from `packages/platform/` and
    `packages/GdKirie.Platform/`.
  * Add `examples/notifications/` by following `examples/tray/`, then move the
    notification UI, Eventa subscription, C# attachment, platform notes, and
    export instructions out of `examples/basic-platform/`.
  * Update `README.md`, `docs/architecture.md`, `docs/references.md`, package
    publishing documentation, and npm/NuGet release workflows for the new
    packages.
  * Let `kirie doctor` accept matching local `.csproj` references in repository
    examples while preserving exact version checks for NuGet references.
  * Update only the initializer-chain code in
    `packages/kirie/src-godot/export_plugin.ts` so independent addon export
    plugins can compose Apple native initialization in either load order.
* **Dependencies**:
  * `@gd-kirie/notifications` depends on `kirie`, `@gd-kirie/ipc-eventa`, and
    `@moeru/eventa` using the repository workspace/catalog conventions.
  * `GdKirie.Notifications` references `GdKirie.EventaAdapter`,
    `RumpSharp@1.0.1`, and `Microsoft.Windows.CsWin32@0.3.298`.
  * The plugin descriptor declares the bundled export adapter before the pinned
    remote v6.0 vendor tree so a parent-addon replacement cannot leave the
    vendor dependency missing.
* **Patterns to follow**:
  * Follow [ADR-0010](0010-introduce-kirie-plugins-and-the-core-plugin.md) for
    the default descriptor, remote archive digest verification, addon install,
    and NuGet doctor checks.
  * Follow `packages/platform/src/index.ts`, `GdKiriePlatform.Register`, and
    `GdKiriePlatform.Attach` for Eventa contract and host lifecycle shape.
  * Follow `packages/kirie/src-godot/export_plugin.ts` for addon-rooted Android
    libraries and Apple embedded-platform export hooks.
  * Preserve the existing notification router's per-host ownership and
    direction-aware Eventa emission.
* **Patterns to avoid**:
  * Do not add notification methods or signals to `addons/kirie`, Kirie IPC, or
    a GDScript application API.
  * Do not create a second Eventa context, retain the old Platform wires, add a
    project-local `.gdip`, patch Godot configuration files as text, or fork the
    upstream native notification implementation.
  * Do not expose other upstream scheduler features during this extraction.
* **Configuration**:
  * Add the notifications descriptor to `kirie.config.ts`; `kirie doctor --fix
    plugin:notifications` installs the addon/vendor tree and adds the exact
    `GdKirie.Notifications` package version to the selected Godot project.
  * `examples/notifications/kirie.config.ts` lists `[core, notifications]`; the
    basic Platform example continues to list only `core`.
  * The Android notification permission declaration remains an export concern
    of the adapter; no manual manifest edit or new Kirie configuration key is
    required.
* **Migration steps**:
  1. Publish the npm, NuGet, and addon integration under the new package names.
  2. Replace imports of `DesktopNotification`,
     `DesktopNotificationActivated`, and `notificationActivated` from
     `@gd-kirie/platform` with the new notification package types and event.
  3. Replace `platform.notifications.show(request)` with
     `notifications.show(request)` from `createNotificationsClient(context)`.
  4. Add the notification plugin descriptor, run its doctor fixer, register its
     JSON contracts, and attach its host to the same Eventa context and scene
     owner used by Platform.
  5. Remove notification registration from the Platform host and then remove
     the old wire contracts in the same coordinated release.

### Verification

- [ ] `mise run lint:eslint` passes after the TypeScript, JSON, and generated
      addon source changes.
- [ ] The new TypeScript tests send `kirie:notifications:show`, preserve all
      three request fields, and decode `kirie:notifications:activated` without
      creating another context.
- [ ] `GdKirie.slnx` restores and builds, and focused .NET tests cover invalid
      request validation, multiple live hosts, disposal, permission
      denial/failure, and mobile custom-data activation routing.
- [ ] `rg` finds no notification contract, wire, client member, runtime source,
      or RumpSharp reference in `packages/platform` or
      `packages/GdKirie.Platform`.
- [ ] `kirie doctor --fix plugin:notifications` installs the bundled adapter,
      the checksum-verified v6.0 vendor tree, and the exact NuGet reference; a
      second run reports no changes.
- [ ] A macOS 11+ integration run shows the same silent foreground notification
      and returns its caller ID on activation.
- [ ] A Windows 10 1607+ integration run shows the same unpackaged toast and
      returns its caller ID on activation without cold-launching a disposed
      host.
- [ ] An Android export contains the upstream AARs, dependencies, and required
      manifest entries; first show handles permission and activation returns
      the caller's string ID.
- [ ] An iOS export contains the upstream XCFrameworks and required link/input
      metadata, initializes both Kirie and the notification scheduler once,
      contains no project-root `ios/plugins` shim, and passes the same show and
      activation flow on device.
- [ ] The notifications example exercises one real request/response path and
      one activation event on desktop and on at least one mobile target.
- [ ] `rg -i notification examples/basic-platform/README.md
      examples/basic-platform/scripts examples/basic-platform/src-web
      examples/basic-platform/package.json examples/basic-platform/kirie.config.ts`
      returns no API usage, UI, host registration, dependency, or documentation
      left behind by the extraction.
- [ ] Package READMEs, architecture documentation, references, and release
      workflows describe the final package names and explicit plugin setup.

## Pros and Cons of the Options

### Create a dedicated Kirie plugin with a thin mobile export adapter

* Good, because capability installation and runtime ownership are explicit.
* Good, because Kirie reuses both its desktop code and upstream mobile code.
* Good, because native files remain under one addon root.
* Bad, because Kirie must maintain export metadata that upstream normally
  supplies through its editor plugin and `.gdip` file.

### Keep notifications in Platform and add mobile branches there

* Good, because existing browser and host call sites remain unchanged.
* Bad, because every core-plugin consumer keeps receiving an optional
  notification capability and its dependencies.
* Bad, because it works against the plugin boundary introduced by ADR-0010.

### Install and expose the upstream plugin unchanged

* Good, because Kirie would carry almost no mobile packaging code.
* Bad, because browser applications would need to depend on an upstream
  GDScript API instead of one cross-platform Eventa contract.
* Bad, because its iOS installation shape requires project-root
  `res://ios/plugins` files.

### Implement new Kirie-owned Android and iOS notification backends

* Good, because Kirie would control every native detail and artifact layout.
* Bad, because it duplicates an active upstream project and creates ongoing
  Android/iOS compatibility and permission maintenance.

## More Information

This decision deliberately retains the small current API. A later requirement
for scheduling or richer OS notification controls must be evaluated in a new
ADR against the upstream scheduler API and relevant platform specifications.

If this ADR is accepted, mark
[ADR-0004](0004-add-macos-desktop-notifications.md) and
[ADR-0007](0007-use-winrt-toasts-for-windows-desktop-notifications.md) as
superseded by ADR-0014. Their selected desktop backends and behavioral limits
are carried forward here; their Platform ownership is replaced.

Primary references:

* [`godot-notification-scheduler` repository](https://github.com/godot-mobile-plugins/godot-notification-scheduler)
* [`godot-notification-scheduler` v6.0 release](https://github.com/godot-mobile-plugins/godot-notification-scheduler/releases/tag/v6.0)
* [Godot Android plugin documentation](https://docs.godotengine.org/en/stable/tutorials/platform/android/android_plugin.html)
* [Godot iOS plugin documentation](https://docs.godotengine.org/en/stable/tutorials/platform/ios/ios_plugin.html)
* [Godot `EditorExportPlugin` documentation](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html)
