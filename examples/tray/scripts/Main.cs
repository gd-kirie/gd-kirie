using GdKirie.EventaAdapter;
using GdKirie.Tray;
using Godot;

public partial class Main : Node
{
    private KirieClient? _kirie;
    private KirieEventaContextHandle? _eventa;
    private IDisposable? _tray;

    public override void _Ready()
    {
        _kirie = KirieClient.FromNode(GetNode("KirieNode"));
        if (!_kirie.IsAvailable)
        {
            GD.PushError("Kirie is unavailable on this platform.");
            return;
        }

        var registry = GdKirieTray.Register(new KirieEventaJsonRegistry());
        _eventa = _kirie.CreateEventaContext(registry);
        _tray = GdKirieTray.Attach(_eventa.Context, GetWindow());
        _kirie.IpcError += GD.PushError;

        var initialUrl = _kirie.GetLaunchOption("kirie-web-url").Trim();
        _kirie.CreateWebView(initialUrl.Length == 0 ? "res://src-web/dist/index.html" : initialUrl);
    }

    public override void _ExitTree()
    {
        _tray?.Dispose();
        _eventa?.Dispose();
        _kirie?.Dispose();
    }
}
