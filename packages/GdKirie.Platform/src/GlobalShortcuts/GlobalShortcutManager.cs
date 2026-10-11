namespace GdKirie.Platform;

internal sealed class GlobalShortcutManager(
    Action<GlobalShortcutKeyEventPayload> onKeyEvent,
    SynchronizationContext? synchronizationContext) : IDisposable
{
    private readonly Action<GlobalShortcutKeyEventPayload> _onKeyEvent = onKeyEvent;
    private readonly SynchronizationContext? _synchronizationContext = synchronizationContext;
    private readonly Dictionary<GlobalShortcut, IDisposable> _registrations = [];
    private IGlobalShortcutBackend? _backend;
    private bool _disposed;

    public void Register(GlobalShortcutPayload payload)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var shortcut = GlobalShortcut.FromPayload(payload);
        if (_registrations.ContainsKey(shortcut))
        {
            throw new InvalidOperationException("The global shortcut is already registered by this Platform host.");
        }

        var backend = GetBackend();
        var nativeRegistration = backend.Register(
            shortcut,
            state => _onKeyEvent(new GlobalShortcutKeyEventPayload(payload, state)));
        _registrations.Add(shortcut, nativeRegistration);
    }

    public void Unregister(GlobalShortcutPayload payload)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var shortcut = GlobalShortcut.FromPayload(payload);
        if (!_registrations.TryGetValue(shortcut, out var registration))
        {
            throw new InvalidOperationException("The global shortcut is not registered by this Platform host.");
        }

        registration.Dispose();
        _registrations.Remove(shortcut);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        foreach (var nativeRegistration in _registrations.Values)
        {
            nativeRegistration.Dispose();
        }

        _registrations.Clear();
        _backend?.Dispose();
    }

    private IGlobalShortcutBackend GetBackend()
    {
        if (_backend is not null)
        {
            return _backend;
        }

        if (OperatingSystem.IsMacOS())
        {
            _backend = new MacOsGlobalShortcutBackend();
            return _backend;
        }

        if (OperatingSystem.IsWindowsVersionAtLeast(10))
        {
            _backend = new WindowsGlobalShortcutBackend(
                _synchronizationContext
                    ?? throw new InvalidOperationException(
                        "Windows global shortcuts require Godot's main-thread synchronization context."));
            return _backend;
        }

        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException(
                "Global shortcuts have not been implemented for this desktop platform yet.");
        }

        throw new PlatformNotSupportedException("Windows global shortcuts require Windows 10 or later.");
    }
}
