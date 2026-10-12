using Eventa;
using GdKirie.EventaAdapter;
using Godot;

namespace GdKirie.Notifications;

/// <summary>Registers and attaches Kirie's notification capability.</summary>
public static class GdKirieNotifications
{
    /// <summary>Registers the fixed notification wire contracts.</summary>
    public static KirieEventaJsonRegistry Register(KirieEventaJsonRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);
        return registry
            .RegisterInvoke(NotificationEvents.Show, NotificationJsonContext.Default.EmptyPayload,
                NotificationJsonContext.Default.NotificationPayload)
            .RegisterEvent(NotificationEvents.Activated,
                NotificationJsonContext.Default.NotificationActivatedPayload);
    }

    /// <summary>Attaches notification handlers to an existing Eventa context.</summary>
    public static GdKirieNotificationsHost Attach(IEventContext context, Node owner)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(owner);
        if (!GodotThread.IsMainThread())
            throw new InvalidOperationException("GdKirieNotifications.Attach must run on Godot's main thread.");
        if (!owner.IsInsideTree())
            throw new ArgumentException("The owner must be inside the scene tree.", nameof(owner));
        return new GdKirieNotificationsHost(context, owner);
    }
}

/// <summary>Owns notification handlers for one scene-tree owner.</summary>
public sealed class GdKirieNotificationsHost : IDisposable
{
    private readonly Node _owner;
    private readonly Guid _hostId;
    private readonly IDisposable _registration;
    private bool _disposed;

    internal GdKirieNotificationsHost(IEventContext context, Node owner)
    {
        _owner = owner;
        _hostId = Notifications.Attach(
            id => context.Emit(NotificationEvents.Activated, new NotificationActivatedPayload(id)),
            SynchronizationContext.Current);
        _registration = context.RegisterInvokeHandler(NotificationEvents.Show,
            (notification, cancellationToken) => Notifications.ShowAsync(_hostId, notification, cancellationToken));
        _owner.TreeExiting += Dispose;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
            return;
        if (!GodotThread.IsMainThread())
            throw new InvalidOperationException("GdKirieNotificationsHost.Dispose must run on Godot's main thread.");
        _disposed = true;
        _owner.TreeExiting -= Dispose;
        _registration.Dispose();
        Notifications.Detach(_hostId);
    }
}
