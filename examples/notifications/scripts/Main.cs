using GdKirie.EventaAdapter;
using GdKirie.Notifications;
using Godot;

public partial class Main : Node
{
    private KirieClient? _kirie;
    private KirieEventaContextHandle? _eventa;
    private GdKirieNotificationsHost? _notifications;

    public override void _Ready()
    {
        _kirie = KirieClient.FromNode(GetNode("KirieNode"));
        if (!_kirie.IsAvailable)
        {
            GD.PushError("Kirie is unavailable on this platform.");
            return;
        }
        _eventa = _kirie.CreateEventaContext(
            GdKirieNotifications.Register(new KirieEventaJsonRegistry()));
        _notifications = GdKirieNotifications.Attach(_eventa.Context, this);
        _kirie.IpcError += GD.PushError;
        var url = _kirie.GetLaunchOption("kirie-web-url").Trim();
        _kirie.CreateWebView(url.Length == 0 ? "res://src-web/dist/index.html" : url);
    }

    public override void _ExitTree()
    {
        _notifications?.Dispose();
        _eventa?.Dispose();
        _kirie?.Dispose();
    }
}
