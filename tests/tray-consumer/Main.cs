using System.Text.Json;
using GdKirie.EventaAdapter;
using GdKirie.Tray;
using Godot;

public partial class Main : Node
{
    public override async void _Ready()
    {
        try
        {
            await RunAsync();
            GD.Print("[Tray consumer] PASS");
            GetTree().Quit();
        }
        catch (Exception exception)
        {
            GD.PushError(exception.ToString());
            GetTree().Quit(1);
        }
    }

    private async Task RunAsync()
    {
        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);

        var transport = new ConsumerTransport();
        using var eventa = KirieEventa.CreateContext(
            transport,
            GdKirieTray.Register(new KirieEventaJsonRegistry()));
        eventa.Adapter.Error += transport.Fail;
        using var tray = GdKirieTray.Attach(eventa.Context, GetWindow());

        var icon = OperatingSystem.IsMacOS()
            ? """{"icon":"res://tray-icon.svg","iconAsTemplate":true}"""
            : """{"icon":"res://tray-icon.svg","iconAsTemplate":false}""";

        await transport.InvokeAsync("create", icon);
        await transport.InvokeAsync("set-icon", icon);
        await transport.InvokeAsync("set-tooltip", "\"Installed consumer test\"");
        await transport.InvokeAsync("set-tooltip", "null");
        await transport.InvokeAsync("set-visible", "false");
        await transport.InvokeAsync("set-visible", "true");
        await transport.InvokeAsync(
            "set-menu",
            """
            [
              {"type":"item","id":"consumer-activate","text":"Complete consumer test"},
              {"type":"check","id":"consumer-check","text":"Checked item","checked":true},
              {"type":"separator"},
              {"type":"submenu","text":"Submenu","children":[
                {"type":"item","id":"consumer-child","text":"Child item"}
              ]}
            ]
            """);
        await transport.InvokeAsync("set-menu", """[{"type":"unsupported"}]""", "unknown variant");

        if (OS.GetCmdlineUserArgs().Contains("--wait-menu"))
        {
            GetNode<Label>("Status").Text = "Click the tray icon, then ‘Complete consumer test’.";
            GD.Print("[Tray consumer] Waiting for native menu activation: consumer-activate");
            var activated = await transport.MenuActivated.Task.WaitAsync(TimeSpan.FromMinutes(3));
            if (activated != "consumer-activate")
            {
                throw new InvalidOperationException($"Unexpected menu activation: {activated}");
            }

            GD.Print($"[Tray consumer] Native menu activation received: {activated}");
        }

        await transport.InvokeAsync("destroy", "{}");
        await transport.InvokeAsync("set-visible", "true", "does not exist");
        await transport.InvokeAsync("destroy", "{}");
        await transport.InvokeAsync("create", icon);
        await transport.InvokeAsync("destroy", "{}");
    }

    private sealed class ConsumerTransport : IKirieTextTransport
    {
        private int _sequence;
        private string? _responseType;
        private string? _errorType;
        private TaskCompletionSource<JsonElement>? _response;

        public event Action<string>? TextReceived;

        public TaskCompletionSource<string> MenuActivated { get; } = new();

        public void SendText(string message)
        {
            using var document = JsonDocument.Parse(message);
            var root = document.RootElement;
            var type = root.GetProperty("type").GetString();
            if (type == "kirie:tray:menu-item-activated")
            {
                MenuActivated.TrySetResult(root.GetProperty("payload").GetProperty("body").GetString()!);
                return;
            }

            if (type != _responseType && type != _errorType)
            {
                throw new InvalidOperationException($"Unexpected Eventa response: {message}");
            }

            _response!.SetResult(root.Clone());
        }

        public void Fail(KirieEventaError error)
        {
            var exception = new InvalidOperationException(error.Message, error.Exception);
            _response?.TrySetException(exception);
            MenuActivated.TrySetException(exception);
        }

        public async Task InvokeAsync(string action, string content, string? expectedError = null)
        {
            var invokeId = $"consumer-{++_sequence}";
            _responseType = $"kirie:tray:{action}-receive-{invokeId}";
            _errorType = $"kirie:tray:{action}-receive-error-{invokeId}";
            _response = new TaskCompletionSource<JsonElement>();

            TextReceived?.Invoke($$"""
                {"type":"kirie:tray:{{action}}-send","payload":{"body":{"invokeId":"{{invokeId}}","content":{{content}}}}}
                """);

            var response = await _response.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var failed = response.GetProperty("type").GetString() == _errorType;
            var body = response.GetProperty("payload").GetProperty("body");
            if (body.GetProperty("invokeId").GetString() != invokeId)
            {
                throw new InvalidOperationException($"Eventa response has an incorrect request ID: {response}");
            }

            if (expectedError is null && !failed)
            {
                return;
            }

            if (!failed)
            {
                throw new InvalidOperationException($"{action} unexpectedly succeeded; expected {expectedError}.");
            }

            var error = body.GetProperty("content").GetProperty("error").GetProperty("message").GetString()!;
            if (expectedError is null || !error.Contains(expectedError, StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"{action} returned an unexpected error: {error}");
            }

            GD.Print($"[Tray consumer] Expected {action} error: {error}");
        }
    }
}
