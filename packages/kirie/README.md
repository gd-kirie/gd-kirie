# @gd-kirie/kirie

This package contains the Kirie Godot addon sources and native Android and iOS implementations. `@gd-kirie/kirie` is a private workspace package rather than a public npm package. TypeScript in `src-godot` generates the addon GDScript in `addon/addons/kirie/*.gd`, which Git ignores. Run `mise x -- pnpm -C packages/kirie run generate:godot` to regenerate GDScript, and run `mise x -- pnpm -C packages/kirie run typecheck` for TypeScript types. Repository mise tasks build the native artifacts and downloadable addon archive, as documented in [docs/addon-release.md](../../docs/addon-release.md).

The native iOS backend requires iOS 16 or later. Current package directories are:

- `src-godot`: TypeScript source for the Godot-facing scripts
- `addon/addons/kirie`: generated GDScript and Godot plugin metadata
- `addon/addons/kirie/csharp`: C# wrapper files for Godot .NET projects
- `native/android`: Android native implementation
- `native/ios`: iOS native implementation

Run `pnpm kirie doctor --fix plugin:webview` in a Kirie project to install `addons/kirie` and desktop `addons/godot_cef`. See [installation instructions](../../README.md#installation) for manual installation details.

## C# binding

`addon/addons/kirie/csharp/KirieClient.cs` exposes Kirie signals as idiomatic C# events while keeping Godot `Callable` usage internal. The wrapper derives from `RefCounted`. Calling `Dispose()` releases the native wrapper object and disconnects callbacks, while a borrowed `KirieNode` retains ownership of its WebView.

The default constructor connects directly to the platform singleton:

```csharp
private readonly KirieClient _kirie = new();

public override void _Ready()
{
    _kirie.WebViewReady += OnWebViewReady;
    _kirie.TextReceived += OnTextReceived;
    _kirie.BinaryReceived += OnBinaryReceived;
    _kirie.DataReceived += OnDataReceived;
    _kirie.IpcError += GD.PushError;

    if (_kirie.IsAvailable)
    {
        _kirie.CreateWebView("res://src-web/dist/index.html");
    }
}
```

When a scene `KirieNode` owns the WebView, C# can borrow that node with `KirieClient.FromNode(...)`. Set `auto_create = false` on the scene node so C# subscribes to events before starting the WebView:

```csharp
private KirieClient? _kirie;

public override void _Ready()
{
    _kirie = KirieClient.FromNode(GetNode<Node>("Kirie"));
    _kirie.TextReceived += OnTextReceived;
    _kirie.CreateWebView();
}

public override void _ExitTree()
{
    _kirie?.Dispose();
    _kirie = null;
}
```

Make sure that the borrowed node outlives the `KirieClient` instance. Disposing the client disconnects its C# callbacks without freeing the node or destroying its WebView. `KirieNode` remains the scene-tree lifecycle owner.

## WebView visibility

`KirieNode` uses its effective Godot visibility to show or hide its WebView. An initially hidden node or a hidden `CanvasItem` ancestor keeps the WebView hidden. Hiding and showing a node preserve the loaded page, readiness state, and IPC connection. A hidden WebView does not receive user input.

```csharp
var node = GetNode<Control>("Kirie");
node.Hide();
// Show another Godot view, then restore the existing web page.
node.Show();
```

This behavior follows [Godot CanvasItem visibility](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html#class-canvasitem-method-is-visible-in-tree). The direct `KirieClient()` constructor has no scene node and does not inherit scene visibility.

## Pointer input forwarding

`KirieNode.pointer_input_forwarding_enabled` enables browser pointer forwarding from `@gd-kirie/ipc` into the Godot input pipeline. Controls behind the native WebView then receive forwarded pointer events. Kirie resolves normalized browser coordinates against the active Godot `Viewport` so stretched `SubViewport` and embedded root `Window` targets receive local pointer coordinates. Browser code decides which events bubble to the forwarding listener and which interactive elements retain pointer input.

C# clients borrowed from `KirieNode` set this property before creating the WebView:

```csharp
var kirie = KirieClient.FromNode(GetNode<Node>("Kirie"));
kirie.PointerInputForwardingEnabled = true;
kirie.CreateWebView();
```

The direct `KirieClient()` constructor has no scene owner to receive synthetic input. Use `KirieClient.FromNode(...)` when pointer forwarding is required.

## WebView permission requests

Desktop Godot CEF projects can set `godot_cef/security/default_permission_policy` to `Signal` (`2`). Kirie then forwards each WebView permission request through `permission_requested`. Make sure that your application inspects the exact origin and permission type before resolving the request:

```csharp
var kirie = KirieClient.FromNode(GetNode<Node>("Kirie"));
kirie.PermissionRequested += (permissionType, origin, requestId) =>
{
    var trusted = permissionType == "microphone" && origin == "https://app.example";
    if (trusted)
    {
        kirie.GrantPermission(requestId);
        return;
    }

    kirie.DenyPermission(requestId);
};
```

Each request ID is single-use. Resolve every emitted request, even for unknown permission types. Kirie does not select trusted origins, display operating-system prompts, or grant permissions automatically. Android and iOS do not emit this signal, and their application manifests and operating-system permissions remain separate requirements. The [Godot CEF 1.15.3 permission API](https://github.com/dsh0416/godot-cef/blob/v1.15.3/docs/api/methods.md#permission-handling) defines the desktop request lifetime.
