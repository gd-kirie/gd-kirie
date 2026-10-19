# @gd-kirie/kirie

This package contains the Kirie plugin sources and platform-specific native
implementations.

`@gd-kirie/kirie` is a private workspace container for the Godot addon and
native plugin sources. It is not a public npm package. TypeScript in
`src-godot` is the source for the addon GDScript; `addon/addons/kirie/*.gd` is
generated locally and ignored by Git. Generate
it with `mise x -- pnpm -C packages/kirie run generate:godot`, and check the
TypeScript with `mise x -- pnpm -C packages/kirie run typecheck`. Native
artifacts and the downloadable addon zip are built by the repository-level
mise tasks documented in
[docs/addon-release.md](../../docs/addon-release.md).

Current layout:

- `src-godot`: TypeScript source for the Godot-facing scripts
- `addon/addons/kirie`: generated GDScript and other Godot-facing plugin files
- `addon/addons/kirie/csharp`: C# wrapper files for Godot .NET projects
- `native/android`: Android implementation
- `native/ios`: iOS implementation

The goal of this package is to keep the Godot addon tree and native sources
close together while package-published JavaScript lives in the sibling
workspace packages.

Run `pnpm kirie doctor --fix` to install Kirie and Godot CEF. Select
`kirie-addon` or `godot-cef` to repair only that addon. See
[installation instructions](../../README.md#installation).

## C# binding

`addon/addons/kirie/csharp/KirieClient.cs` exposes Kirie signals as idiomatic
C# events while keeping Godot `Callable` usage internal.

The wrapper derives from `RefCounted`. `Dispose()` releases its native wrapper
object and disconnects callbacks. A borrowed `KirieNode` keeps ownership of its WebView.

Its default constructor talks directly to the platform singleton:

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

When a scene `KirieNode` owns the WebView, C# can borrow that existing node
without creating another owner or duplicating dynamic signal plumbing. This
example configures the scene node with `auto_create = false`, then lets C# start
the borrowed node's WebView after subscribing to its signals:

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

The borrowed node must outlive the client. Disposing the client disconnects its
C# callbacks but does not free the node or destroy its WebView; `KirieNode`
remains the scene-tree lifecycle owner.

## WebView visibility

`KirieNode` uses its effective Godot visibility to show or hide its WebView.
An initially hidden node or a hidden CanvasItem ancestor keeps the WebView hidden.
Hide and show preserve the loaded page, readiness, and IPC connection.
A hidden WebView does not receive user input.

```csharp
var node = GetNode<Control>("Kirie");
node.Hide();
// Show another Godot view, then restore the existing web page.
node.Show();
```

This behavior follows [Godot CanvasItem visibility](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html#class-canvasitem-method-is-visible-in-tree).
The direct `KirieClient()` constructor has no scene node or visibility inheritance.

## Pointer input forwarding

`KirieNode.pointer_input_forwarding_enabled` is an opt-in policy for pages that
forward browser pointer events through `@gd-kirie/ipc`. Forwarded events are
injected through Godot's input pipeline so controls behind the native WebView
can receive them. The WebView remains a full native surface; browser code
decides which events bubble to the forwarding listener and which interactive
regions retain their input.

C# uses the same scene-owned path. A client borrowed from `KirieNode` can set
the policy before creating its WebView:

```csharp
var kirie = KirieClient.FromNode(GetNode<Node>("Kirie"));
kirie.PointerInputForwardingEnabled = true;
kirie.CreateWebView();
```

The direct platform-singleton `KirieClient()` constructor has no scene owner to
receive synthetic input, so its `PointerInputForwardingEnabled` property is not
available. Use `FromNode` when pointer forwarding is required.

## WebView permission requests

Desktop Godot CEF projects can set
`godot_cef/security/default_permission_policy` to `Signal` (`2`). Kirie then
forwards each WebView request through `permission_requested`. The application
must check the exact origin and permission type before it resolves the request:

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

Each request ID is single-use. Resolve every emitted request, including unknown
permission types. Kirie does not select trusted origins, show operating-system
prompts, or grant permissions automatically. Android and iOS do not yet emit
this signal; their application manifests and operating-system permission flows
remain separate requirements.

The [Godot CEF 1.15.3 permission API](https://github.com/dsh0416/godot-cef/blob/v1.15.3/docs/api/methods.md#permission-handling)
defines the underlying desktop request lifetime and resolver behavior.
