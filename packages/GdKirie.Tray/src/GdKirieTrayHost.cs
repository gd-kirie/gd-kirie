using Eventa;
using Godot;

namespace GdKirie.Tray;

/// <summary>Owns one tray controller and its Eventa registrations.</summary>
public sealed class GdKirieTrayHost : IDisposable
{
    private readonly Window _window;
    private readonly List<IDisposable> _registrations = [];
    private bool _disposed;

    internal GdKirieTrayHost(IEventContext context, Window window)
    {
        _window = window;
        Tray = new TrayController(window);
        Tray.ItemActivated += id =>
            context.Emit(TrayEvents.MenuItemActivated, new TrayMenuItemActivatedPayload(id));
        _registrations.Add(context.RegisterInvokeHandler(
            TrayEvents.Configure,
            (configuration, _) => Complete(() => Tray.Configure(configuration))));
        _registrations.Add(context.RegisterInvokeHandler(
            TrayEvents.SetMenu,
            (items, _) => Complete(() => Tray.SetMenu(items))));
        _registrations.Add(context.RegisterInvokeHandler(
            TrayEvents.UpdateItem,
            (update, _) => Complete(() => Tray.UpdateItem(update))));
        _registrations.Add(context.RegisterInvokeHandler(
            TrayEvents.Destroy,
            (EmptyPayload _, CancellationToken _) => Complete(Tray.Destroy)));
        _window.TreeExiting += Dispose;
    }

    /// <summary>Gets the host-owned system tray controller.</summary>
    public TrayController Tray { get; }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException("GdKirieTrayHost.Dispose must run on Godot's main thread.");
        }

        _disposed = true;
        _window.TreeExiting -= Dispose;

        Tray.Dispose();
        foreach (var registration in _registrations)
        {
            registration.Dispose();
        }

        _registrations.Clear();
    }

    private static Task<EmptyPayload> Complete(Action action)
    {
        action();
        return Task.FromResult(new EmptyPayload());
    }
}
