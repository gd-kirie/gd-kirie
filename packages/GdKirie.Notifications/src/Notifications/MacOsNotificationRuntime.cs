using System.Runtime.Versioning;
using RumpSharp;

namespace GdKirie.Notifications;

[SupportedOSPlatform("macos11.0")]
internal static class MacOsNotificationRuntime
{
    private static readonly object RuntimeLock = new();
    private static Action<string>? _listener;
    private static NotificationCenter? _center;

    public static void SetListener(Action<string> listener)
    {
        lock (RuntimeLock)
        {
            if (_listener is not null)
            {
                throw new InvalidOperationException("Only one Platform notification listener can be active per process.");
            }

            if (_center is null)
            {
                _center = new NotificationCenter(new NotificationCenterOptions
                {
                    Transport = NotificationTransport.InProcess,
                    BecomeAccessoryApplication = false,
                    PresentWhenForeground = true,
                    RequestAuthorizationOnDemand = false,
                });
                _center.Activated += OnActivated;
            }

            _listener = listener;
        }
    }

    public static void RemoveListener()
    {
        lock (RuntimeLock)
        {
            _listener = null;
            if (_center is null)
            {
                return;
            }

            _center.Activated -= OnActivated;
            _center.Dispose();
            _center = null;
        }
    }

    public static async Task ShowAsync(NotificationPayload notification)
    {
        var center = _center
            ?? throw new InvalidOperationException("macOS notifications require a registered listener.");

        var authorized = await Task.Run(() => center.RequestAuthorization(TimeSpan.FromMinutes(2)));
        if (!authorized)
        {
            throw new UnauthorizedAccessException(
                center.LastAuthorizationError
                ?? "macOS notification permission is not granted for this application.");
        }

        await center.ShowAsync(new Notification(notification.Title, body: notification.Body)
        {
            Identifier = notification.Id,
            PlaySound = false,
        }, CancellationToken.None);
    }

    private static void OnActivated(object? sender, NotificationResponse response)
    {
        if (response.Activation != NotificationActivation.Default)
        {
            return;
        }

        Action<string>? listener;
        lock (RuntimeLock)
        {
            listener = _listener;
        }

        listener?.Invoke(response.Identifier);
    }
}
