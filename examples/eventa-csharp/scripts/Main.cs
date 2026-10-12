using System.Text.Json.Serialization;
using Eventa;
using GdKirie.EventaAdapter;
using Godot;

public partial class Main : Control
{
    private const string PageUrl = "res://src-web/dist/index.html";

    private readonly EventDefinition<WebReadyPayload> _webReady = new("web:ready");
    private readonly InvokeEventDefinition<EchoResponse, EchoRequest> _godotEcho = new("godot:echo");
    private readonly InvokeEventDefinition<EchoResponse, EchoRequest> _webEcho = new("web:echo");
    private readonly Godot.Collections.Array<string> _logLines = [];
    private KirieClient _kirie = null!;
    private KirieEventaContextHandle? _eventa;
    private InvokeClient<EchoResponse, EchoRequest>? _webEchoClient;
    private bool _webViewIsReady;

    private Label _statusLabel = null!;
    private Label _logLabel = null!;
    private Button _invokeButton = null!;

    public override void _Ready()
    {
        _kirie = KirieClient.FromNode(GetNode<Node>("KirieNode"));
        _statusLabel = GetNode<Label>("VBoxContainer/StatusLabel");
        _logLabel = GetNode<Label>("VBoxContainer/LogLabel");
        var createButton = GetNode<Button>("VBoxContainer/CreateButton");
        _invokeButton = GetNode<Button>("VBoxContainer/InvokeButton");

        createButton.Pressed += OnCreateButtonPressed;
        _invokeButton.Pressed += OnInvokeButtonPressed;

        _kirie.WebViewReady += OnWebViewReady;
        _kirie.IpcError += OnIpcError;

        if (!_kirie.IsAvailable)
        {
            SetStatus("Status: Kirie singleton not available on this platform");
            AppendLog("Kirie singleton is not available");
            return;
        }

        var registry = new KirieEventaJsonRegistry()
            .RegisterEvent(_webReady, EventaExampleJsonContext.Default.WebReadyPayload)
            .RegisterInvoke(_godotEcho, EventaExampleJsonContext.Default.EchoResponse, EventaExampleJsonContext.Default.EchoRequest)
            .RegisterInvoke(_webEcho, EventaExampleJsonContext.Default.EchoResponse, EventaExampleJsonContext.Default.EchoRequest);
        _eventa = _kirie.CreateEventaContext(registry);
        _eventa.Adapter.Error += error => AppendLog($"eventa_error {error.Message}");
        _eventa.Context.Subscribe(_webReady, envelope =>
        {
            CallDeferred(MethodName.HandleWebReady, envelope.Body.UserAgent);
        });
        _eventa.Context.RegisterInvokeHandler(
            _godotEcho,
            (request, _) => Task.FromResult(new EchoResponse($"Godot received: {request.Message}")));
        _webEchoClient = _eventa.Context.CreateInvokeClient(_webEcho);

        SetStatus("Status: Kirie singleton available");
        AppendLog("Kirie singleton detected");
    }

    public override void _ExitTree()
    {
        _eventa?.Dispose();
        _kirie.Dispose();
    }

    private void OnCreateButtonPressed()
    {
        if (!_kirie.IsAvailable)
        {
            return;
        }

        SetStatus("Status: creating WebView");
        AppendLog("create_webview");
        var devPageUrl = _kirie.GetLaunchOption("kirie-web-url").Trim();
        _kirie.CreateWebView(devPageUrl.Length == 0 ? PageUrl : devPageUrl);
    }

    private async void OnInvokeButtonPressed()
    {
        if (_webEchoClient is null)
        {
            return;
        }

        try
        {
            var response = await _webEchoClient.InvokeAsync(new EchoRequest("Hello from Godot"));
            AppendLog($"web_echo response={response.Reply}");
        }
        catch (Exception error)
        {
            AppendLog($"web_echo failed={error.Message}");
        }
    }

    private void OnWebViewReady()
    {
        _webViewIsReady = true;
        SetStatus("Status: WebView ready");
        AppendLog("signal webview_ready");
    }

    private void OnIpcError(string error)
    {
        SetStatus("Status: IPC error");
        AppendLog($"signal ipc_error {error}");
    }

    private void HandleWebReady(string userAgent)
    {
        SetStatus("Status: received Eventa web:ready");
        AppendLog($"event web:ready user_agent={userAgent}");
        _invokeButton.Disabled = !_webViewIsReady;
    }

    private void AppendLog(string line)
    {
        _logLines.Add(line);
        while (_logLines.Count > 10)
        {
            _logLines.RemoveAt(0);
        }

        _logLabel.Text = $"Log:\n{string.Join("\n", _logLines)}";
        GD.Print(line);
    }

    private void SetStatus(string text)
    {
        _statusLabel.Text = text;
    }

    private sealed record WebReadyPayload(string UserAgent);

    private sealed record EchoRequest(string Message);

    private sealed record EchoResponse(string Reply);

    [JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
    [JsonSerializable(typeof(WebReadyPayload))]
    [JsonSerializable(typeof(EchoRequest))]
    [JsonSerializable(typeof(EchoResponse))]
    private sealed partial class EventaExampleJsonContext : JsonSerializerContext;
}
