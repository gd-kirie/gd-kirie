# GdKirie.Platform

`GdKirie.Platform` registers the Godot side of `@gd-kirie/platform` on an application-owned Kirie Eventa context and exposes host capabilities. `Register` must run before you create the Eventa context. `Attach` borrows the context and an explicit Godot `Window`. Disposing the returned host removes Platform handlers and disposes any attached `IKirieWindowBackend`, without disposing the context or `Window`.

```csharp
var registry = new KirieEventaJsonRegistry();
GdKiriePlatform.Register(registry);

var eventa = kirie.CreateEventaContext(registry);
var platform = GdKiriePlatform.Attach(eventa.Context, GetWindow());
```

`Attach` and `Dispose` must run on the Godot main thread. Make sure that the bound window is already inside the scene tree. When the bound window exits the scene tree, the host disposes automatically.

`GdKiriePlatform.Attach(context, hostWindow, windowBackend)` separates window operations behind `IKirieWindowBackend`. When `windowBackend` is `null` and `!hostWindow.IsEmbedded()`, `Attach` uses the built-in Godot `Window` backend. When `hostWindow.IsEmbedded()` is `true` and `windowBackend` is `null`, `Attach` still registers operating-system, Back, and shortcut capabilities. Window-owned invokes throw `PlatformNotSupportedException` unless you supply a custom `IKirieWindowBackend`.

`openExternalUrl()` accepts only absolute HTTP and HTTPS URLs and passes them to [`OS.shell_open()`](https://docs.godotengine.org/en/4.7/classes/class_os.html#class-os-method-shell-open). `openApplicationDataDirectory()` opens and returns the user data directory from [`OS.get_user_data_dir()`](https://docs.godotengine.org/en/4.7/classes/class_os.html#class-os-method-get-user-data-dir) for the active project. It does not accept an arbitrary path.

Host-window state reads `Window.Visible`, `Window.HasFocus()`, and `Window.Mode` on the Godot `Window`. Platform emits a state event when the window backend reports a focus, visibility, or mode change. The peer must request the first state snapshot before the host emits change events. The host does not emit duplicate snapshots.

Pointer observation uses a snapshot-first lifecycle. The peer subscribes to the change event and then calls `getPointerPosition()` once. The default Godot backend samples [`DisplayServer.mouse_get_position()`](https://docs.godotengine.org/en/4.7/classes/class_displayserver.html#class-displayserver-method-mouse-get-position) on `SceneTree.ProcessFrame`. It emits `kirie:platform:host-window:pointer-position-changed` only when the pointer position or inside state changes. Observation continues while the WebView is unfocused or the native window is click-through.

## Native host text transport

Host-owned mobile shells can run Godot without a WebView. These shells create an Eventa context over the native `KirieHost` Godot singleton with `KirieHostTextTransport`:

```csharp
if (KirieHostTextTransport.IsAvailable)
{
    var eventa = KirieEventa.CreateContext(
        new KirieHostTextTransport(),
        registry,
        disposeTransport: true);
}
```

Make sure that `KirieHostTextTransport.IsAvailable` is `true` before you create the transport. `KirieHostTextTransport` connects to the `host_message_received` signal on the `KirieHost` singleton. It sends outbound text messages through `send_to_host` on the Godot main thread. Disposing the transport disconnects the signal idempotently.

## Global shortcuts

Global shortcuts work on macOS and Windows. macOS uses Carbon hot-key registration. Windows uses one lazy process-wide low-level keyboard hook and filters events to shortcuts owned by attached Platform hosts. Windows registrations are non-exclusive and do not detect shortcuts registered by another process.

Both backends emit one `pressed` state and one `released` state without keyboard auto-repeat. Native events run on the Godot main thread, and disposing the host removes its registrations. After you dispose the final Windows registration, Platform removes the Windows keyboard hook. Platform does not yet implement a Linux global-shortcut backend.

## System back

Android forwards the system Back button through the `Window.GoBackRequested` signal on the bound window. The host emits that signal as the Platform `kirie:platform:back:requested` event. Browser code subscribes through the `backRequested` contract exported by `@gd-kirie/platform`.

The host does not quit the application. If the application handles Back, set [`SceneTree.quit_on_go_back`](https://docs.godotengine.org/en/4.7/classes/class_scenetree.html#class-scenetree-property-quit-on-go-back) to `false`. Godot emits this signal only on platforms with a system Back button.
