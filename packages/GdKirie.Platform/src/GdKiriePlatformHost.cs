using Eventa;
using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Owns the Platform Eventa registrations for one Godot host window.
/// </summary>
public sealed class GdKiriePlatformHost : IDisposable
{
    private readonly Window _window;
    private readonly IKirieWindowBackend? _windowBackend;
    private readonly Action<KiriePointerPosition> _emitPointerPositionChanged;
    private readonly Action<KirieWindowState> _emitWindowStateChanged;
    private readonly Action _emitBackRequested;
    private readonly GlobalShortcutManager _globalShortcuts;
    private readonly List<IDisposable> _registrations = [];
    private KiriePointerPosition? _lastPointerPosition;
    private KirieWindowState? _lastWindowState;
    private bool _disposed;

    internal GdKiriePlatformHost(
        IEventContext context,
        Window window,
        IKirieWindowBackend? windowBackend)
    {
        _window = window;
        _windowBackend = windowBackend;
        _emitPointerPositionChanged = position =>
            context.Emit(PlatformEvents.PointerPositionChanged, position);
        _emitWindowStateChanged = state => context.Emit(PlatformEvents.StateChanged, state);
        _emitBackRequested = () => context.Emit(PlatformEvents.BackRequested, new EmptyPayload());
        _globalShortcuts = new GlobalShortcutManager(
            payload => context.Emit(PlatformEvents.GlobalShortcutStateChanged, payload),
            SynchronizationContext.Current);
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.BeginMove,
            (EmptyPayload _, CancellationToken _) =>
            {
                RequireWindowBackend().BeginMove();
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.BeginResize,
            (edge, _) =>
            {
                RequireWindowBackend().BeginResize(ToGodotEdge(edge));
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.Center,
            (EmptyPayload _, CancellationToken _) =>
            {
                RequireWindowBackend().Center();
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetBounds,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(RequireWindowBackend().GetBounds())));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetCurrentDisplayBounds,
            (EmptyPayload _, CancellationToken _) =>
                Task.FromResult(RequireWindowBackend().GetCurrentDisplayBounds())));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetPointerPosition,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(SnapshotPointerPosition())));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetState,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(SnapshotWindowState())));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.SetAlwaysOnTop,
            (enabled, _) =>
            {
                RequireWindowBackend().SetAlwaysOnTop(enabled);
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.SetPointerPassthrough,
            (enabled, _) =>
            {
                RequireWindowBackend().SetPointerPassthrough(enabled);
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.RegisterGlobalShortcut,
            (shortcut, _) =>
            {
                _globalShortcuts.Register(shortcut);
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.UnregisterGlobalShortcut,
            (shortcut, _) =>
            {
                _globalShortcuts.Unregister(shortcut);
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.OpenExternalUrl,
            (url, _) => Task.FromResult(OpenExternalUrl(url))));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.OpenApplicationDataDirectory,
            (EmptyPayload _, CancellationToken _) => Task.FromResult(OpenApplicationDataDirectory())));

        if (_windowBackend is not null)
        {
            _windowBackend.PointerPositionChanged += OnPointerPositionChanged;
            _windowBackend.StateChanged += OnWindowStateChanged;
        }

        _window.GoBackRequested += OnGoBackRequested;
        _window.TreeExiting += Dispose;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException("GdKiriePlatformHost.Dispose must run on Godot's main thread.");
        }

        _disposed = true;
        _window.GoBackRequested -= OnGoBackRequested;
        _window.TreeExiting -= Dispose;

        if (_windowBackend is not null)
        {
            _windowBackend.PointerPositionChanged -= OnPointerPositionChanged;
            _windowBackend.StateChanged -= OnWindowStateChanged;
            _windowBackend.Dispose();
        }

        _globalShortcuts.Dispose();
        foreach (var registration in _registrations)
        {
            registration.Dispose();
        }

        _registrations.Clear();
    }

    private IKirieWindowBackend RequireWindowBackend()
    {
        return _windowBackend
            ?? throw new PlatformNotSupportedException(
                "Platform host-window capabilities require a native, non-embedded Godot Window or an explicit IKirieWindowBackend.");
    }

    private KiriePointerPosition SnapshotPointerPosition()
    {
        var position = RequireWindowBackend().GetPointerPosition();
        _lastPointerPosition = position;
        return position;
    }

    private void OnPointerPositionChanged(KiriePointerPosition position)
    {
        if (_disposed || _lastPointerPosition is null || position == _lastPointerPosition.Value)
        {
            return;
        }

        _lastPointerPosition = position;
        _emitPointerPositionChanged(position);
    }

    private KirieWindowState SnapshotWindowState()
    {
        var state = RequireWindowBackend().GetState();
        _lastWindowState = state;
        return state;
    }

    private void OnWindowStateChanged(KirieWindowState state)
    {
        if (_disposed || _lastWindowState is null || state == _lastWindowState.Value)
        {
            return;
        }

        _lastWindowState = state;
        _emitWindowStateChanged(state);
    }

    private void OnGoBackRequested()
    {
        _emitBackRequested();
    }

    private static EmptyPayload OpenExternalUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("External URLs must use an absolute HTTP or HTTPS URL.", nameof(url));
        }

        var result = OS.ShellOpen(uri.AbsoluteUri);
        if (result != Error.Ok)
        {
            throw new InvalidOperationException($"The operating system could not open the external URL: {result}.");
        }

        return new EmptyPayload();
    }

    private static string OpenApplicationDataDirectory()
    {
        var path = OS.GetUserDataDir();
        var result = OS.ShellOpen(path);
        if (result != Error.Ok)
        {
            throw new InvalidOperationException(
                $"The operating system could not open the application data directory: {result}.");
        }

        return path;
    }

    private static DisplayServer.WindowResizeEdge ToGodotEdge(string edge)
    {
        return edge switch
        {
            "top" => DisplayServer.WindowResizeEdge.Top,
            "right" => DisplayServer.WindowResizeEdge.Right,
            "bottom" => DisplayServer.WindowResizeEdge.Bottom,
            "left" => DisplayServer.WindowResizeEdge.Left,
            "top-left" => DisplayServer.WindowResizeEdge.TopLeft,
            "top-right" => DisplayServer.WindowResizeEdge.TopRight,
            "bottom-left" => DisplayServer.WindowResizeEdge.BottomLeft,
            "bottom-right" => DisplayServer.WindowResizeEdge.BottomRight,
            _ => throw new ArgumentOutOfRangeException(nameof(edge), edge, "Unknown host-window resize edge."),
        };
    }
}
