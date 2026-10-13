using Godot;

namespace GdKirie.Notifications;

/// <summary>
/// Shares one native listener across notification hosts and routes each activation
/// to the Eventa context that published the notification.
/// </summary>
internal static class Notifications
{
    private static readonly object Gate = new();
    private static readonly NotificationRouter Router = new();

    public static Guid Attach(
        Action<string> onActivated,
        SynchronizationContext? synchronizationContext)
    {
        // Attach and disposal run on Godot's main thread. Native callbacks can
        // arrive from another thread, so routing state also uses a lock.
        if (Router.OwnerCount == 0)
        {
            SetListener(Activate, synchronizationContext);
        }

        lock (Gate)
        {
            return Router.Add(onActivated);
        }
    }

    public static void Detach(Guid hostId)
    {
        bool removeListener;
        lock (Gate)
        {
            if (!Router.Remove(hostId))
            {
                return;
            }

            removeListener = Router.OwnerCount == 0;
        }

        // Do not hold the routing lock while a native runtime waits for its
        // callback thread to stop.
        if (removeListener)
        {
            RemoveListener();
        }
    }

    public static async Task<EmptyPayload> ShowAsync(
        Guid hostId,
        NotificationPayload notification,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(notification.Id);
        ArgumentException.ThrowIfNullOrWhiteSpace(notification.Title);
        ArgumentNullException.ThrowIfNull(notification.Body);
        cancellationToken.ThrowIfCancellationRequested();

        string nativeId;
        lock (Gate)
        {
            nativeId = Router.NativeId(hostId, notification.Id);
        }

        var nativeNotification = notification with { Id = nativeId };
        if (OperatingSystem.IsMacOSVersionAtLeast(11))
        {
            await MacOsNotificationRuntime.ShowAsync(nativeNotification);
            return new EmptyPayload();
        }

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 14393))
        {
            WindowsNotificationRuntime.Show(nativeNotification);
            return new EmptyPayload();
        }

        if (OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException(
                "Windows desktop notifications require Windows 10 version 1607 or later.");
        }

        if (OS.HasFeature("android") || OS.HasFeature("ios"))
        {
            await MobileNotificationRuntime.ShowAsync(nativeNotification, cancellationToken);
            return new EmptyPayload();
        }

        throw new PlatformNotSupportedException(
            "Notifications are implemented on Android, iOS, macOS 11 or later, and Windows 10 version 1607 or later.");
    }

    private static void Activate(string nativeId)
    {
        lock (Gate)
        {
            Router.Activate(nativeId);
        }
    }

    private static void SetListener(Action<string> onActivated, SynchronizationContext? synchronizationContext)
    {
        if (OperatingSystem.IsMacOSVersionAtLeast(11))
        {
            MacOsNotificationRuntime.SetListener(onActivated);
            return;
        }

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 14393))
        {
            WindowsNotificationRuntime.SetListener(
                onActivated,
                synchronizationContext
                    ?? throw new InvalidOperationException(
                        "Windows desktop notifications require Godot's main-thread synchronization context."));
            return;
        }

        if (OS.HasFeature("android") || OS.HasFeature("ios"))
        {
            MobileNotificationRuntime.SetListener(onActivated);
        }
    }

    private static void RemoveListener()
    {
        if (OperatingSystem.IsMacOSVersionAtLeast(11))
        {
            MacOsNotificationRuntime.RemoveListener();
            return;
        }

        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 14393))
        {
            WindowsNotificationRuntime.RemoveListener();
            return;
        }

        if (OS.HasFeature("android") || OS.HasFeature("ios"))
        {
            MobileNotificationRuntime.RemoveListener();
        }
    }
}
