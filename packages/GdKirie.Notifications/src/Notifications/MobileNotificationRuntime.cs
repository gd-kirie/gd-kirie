using Godot;
using Godot.Collections;

namespace GdKirie.Notifications;

internal static class MobileNotificationRuntime
{
    private const string SingletonName = "NotificationSchedulerPlugin";
    private const string ChannelId = "kirie.notifications.default";
    private const string NativeIdKey = "kirie_notification_id";
    private const int MinimumDelaySeconds = 1;
    private static GodotObject? _plugin;
    private static Action<string>? _listener;
    private static TaskCompletionSource<bool>? _initialized;
    private static TaskCompletionSource<bool>? _permission;
    private static Callable _onInitialized;
    private static Callable _onPermissionGranted;
    private static Callable _onPermissionDenied;
    private static Callable _onOpened;
    private static int _nextId;

    public static void SetListener(Action<string> listener)
    {
        _plugin = Engine.GetSingleton(SingletonName)
            ?? throw new InvalidOperationException($"Godot singleton {SingletonName} is unavailable.");
        _listener = listener;
        _initialized = Completion();
        _onInitialized = Callable.From(OnInitialized);
        _onPermissionGranted = Callable.From<string>(_ => _permission?.TrySetResult(true));
        _onPermissionDenied = Callable.From<string>(_ => _permission?.TrySetResult(false));
        _onOpened = Callable.From<Dictionary>(OnOpened);
        Connect("initialization_completed", _onInitialized);
        Connect("post_notifications_permission_granted", _onPermissionGranted);
        Connect("post_notifications_permission_denied", _onPermissionDenied);
        Connect("notification_opened", _onOpened);
        _plugin.Call("initialize");
    }

    public static void RemoveListener()
    {
        if (_plugin is not null)
        {
            Disconnect("initialization_completed", _onInitialized);
            Disconnect("post_notifications_permission_granted", _onPermissionGranted);
            Disconnect("post_notifications_permission_denied", _onPermissionDenied);
            Disconnect("notification_opened", _onOpened);
        }
        _initialized?.TrySetCanceled();
        _permission?.TrySetCanceled();
        _plugin = null;
        _listener = null;
    }

    public static async Task ShowAsync(NotificationPayload notification, CancellationToken cancellationToken)
    {
        EnsureMainThread();
        var plugin = _plugin ?? throw new InvalidOperationException("Mobile notifications are not attached.");
        await (_initialized?.Task ?? throw new InvalidOperationException("Mobile notifications are not initialized."))
            .WaitAsync(cancellationToken);
        EnsureMainThread();
        if (!plugin.Call("has_post_notifications_permission").AsBool())
        {
            _permission ??= Completion();
            EnsureOk(plugin.Call("request_post_notifications_permission").AsInt32(), "request permission");
            if (!await _permission.Task.WaitAsync(cancellationToken))
                throw new UnauthorizedAccessException("Notification permission is not granted for this application.");
            EnsureMainThread();
        }

        var customData = new Dictionary { [NativeIdKey] = notification.Id };
        var data = new Dictionary
        {
            ["notification_id"] = ++_nextId,
            ["channel_id"] = ChannelId,
            ["title"] = notification.Title,
            ["content"] = notification.Body,
            ["delay"] = MinimumDelaySeconds,
            ["small_icon_name"] = "abc_star_black_48dp",
            ["custom_data"] = customData,
        };
        EnsureOk(plugin.Call("schedule", data).AsInt32(), "schedule notification");
    }

    private static void OnInitialized()
    {
        try
        {
            if (OS.HasFeature("android"))
            {
                var channel = new Dictionary
                {
                    ["channel_id"] = ChannelId,
                    ["channel_name"] = ProjectSettings.GetSetting("application/config/name", "Kirie").AsString(),
                    ["channel_description"] = "",
                    ["channel_importance"] = 3,
                    ["badge_enabled"] = true,
                };
                var result = _plugin!.Call("create_notification_channel", channel).AsInt32();
                if (result != 32)
                    EnsureOk(result, "create notification channel");
            }
            _initialized!.TrySetResult(true);
        }
        catch (Exception error)
        {
            _initialized!.TrySetException(error);
        }
    }

    private static void OnOpened(Dictionary data)
    {
        if (!data.TryGetValue("custom_data", out var value))
            return;

        var customData = value.AsGodotDictionary();
        if (customData.TryGetValue(NativeIdKey, out var nativeId))
            _listener?.Invoke(nativeId.AsString());
    }

    private static TaskCompletionSource<bool> Completion() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static void EnsureMainThread()
    {
        if (!GodotThread.IsMainThread())
            throw new InvalidOperationException("Mobile notification calls must run on Godot's main thread.");
    }
    private static void EnsureOk(int result, string operation)
    {
        if (result != 0)
            throw new InvalidOperationException($"Notification scheduler failed to {operation}: {result}.");
    }
    private static void Connect(string signal, Callable callable) => _plugin!.Connect(signal, callable);
    private static void Disconnect(string signal, Callable callable)
    {
        if (_plugin!.IsConnected(signal, callable))
            _plugin.Disconnect(signal, callable);
    }
}
