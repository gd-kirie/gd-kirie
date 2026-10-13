using Eventa;
using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Owns the Platform Eventa registrations for one Godot host window.
/// </summary>
public sealed class GdKiriePlatformHost : IDisposable
{
    private readonly Window _window;
    private readonly SceneTree _sceneTree;
    private readonly Action<PointerPositionPayload> _emitPointerPositionChanged;
    private readonly Action<WindowStatePayload> _emitWindowStateChanged;
    private readonly Action _emitBackRequested;
    private readonly GlobalShortcutManager _globalShortcuts;
    private readonly List<IDisposable> _registrations = [];
    private PointerPositionPayload? _lastPointerPosition;
    private WindowStatePayload? _lastWindowState;
    private bool _windowsPointerPassthrough;
    private bool _disposed;

    internal GdKiriePlatformHost(IEventContext context, Window window)
    {
        _window = window;
        _sceneTree = window.GetTree();
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
                _window.StartDrag();
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.BeginResize,
            (edge, _) =>
            {
                _window.StartResize(ToGodotEdge(edge));
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.Center,
            (EmptyPayload _, CancellationToken _) =>
            {
                _window.MoveToCenter();
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetBounds,
            (EmptyPayload _, CancellationToken _) =>
            {
                var position = _window.Position;
                var size = _window.Size;
                return Task.FromResult(new BoundsPayload(position.X, position.Y, size.X, size.Y));
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.GetCurrentDisplayBounds,
            (EmptyPayload _, CancellationToken _) =>
            {
                var screen = _window.CurrentScreen;
                var position = DisplayServer.ScreenGetPosition(screen);
                var size = DisplayServer.ScreenGetSize(screen);
                return Task.FromResult(new BoundsPayload(position.X, position.Y, size.X, size.Y));
            }));
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
                _window.AlwaysOnTop = enabled;
                return Task.FromResult(new EmptyPayload());
            }));
        _registrations.Add(context.RegisterInvokeHandler(
            PlatformEvents.SetPointerPassthrough,
            (enabled, _) =>
            {
                SetPointerPassthrough(enabled);
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
        _window.FocusEntered += RefreshWindowState;
        _window.FocusExited += RefreshWindowState;
        _window.SizeChanged += RefreshWindowState;
        _window.VisibilityChanged += RefreshWindowState;
        _window.GoBackRequested += OnGoBackRequested;
        _sceneTree.ProcessFrame += RefreshObservedState;
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
        _window.FocusEntered -= RefreshWindowState;
        _window.FocusExited -= RefreshWindowState;
        _window.SizeChanged -= RefreshWindowState;
        _window.VisibilityChanged -= RefreshWindowState;
        _window.GoBackRequested -= OnGoBackRequested;
        _sceneTree.ProcessFrame -= RefreshObservedState;
        _window.TreeExiting -= Dispose;

        if (_windowsPointerPassthrough && OperatingSystem.IsWindowsVersionAtLeast(5))
        {
            WindowsMousePassthrough.Set(_window, false);
        }

        _globalShortcuts.Dispose();
        foreach (var registration in _registrations)
        {
            registration.Dispose();
        }

        _registrations.Clear();
    }

    private PointerPositionPayload CapturePointerPosition()
    {
        var relativePosition = DisplayServer.MouseGetPosition() - _window.Position;
        var size = _window.Size;
        return new PointerPositionPayload(
            relativePosition.X,
            relativePosition.Y,
            relativePosition.X >= 0
                && relativePosition.Y >= 0
                && relativePosition.X < size.X
                && relativePosition.Y < size.Y);
    }

    private PointerPositionPayload SnapshotPointerPosition()
    {
        _lastPointerPosition = CapturePointerPosition();
        return _lastPointerPosition;
    }

    private void RefreshPointerPosition()
    {
        if (_lastPointerPosition is null)
        {
            return;
        }

        var position = CapturePointerPosition();
        if (position == _lastPointerPosition)
        {
            return;
        }

        _lastPointerPosition = position;
        _emitPointerPositionChanged(position);
    }

    private WindowStatePayload CaptureWindowState()
    {
        return new WindowStatePayload(
            _window.HasFocus(),
            _window.Mode == Window.ModeEnum.Minimized,
            _window.Visible);
    }

    private WindowStatePayload SnapshotWindowState()
    {
        _lastWindowState = CaptureWindowState();
        return _lastWindowState;
    }

    private void RefreshWindowState()
    {
        if (_lastWindowState is null)
        {
            return;
        }

        var state = CaptureWindowState();
        if (state == _lastWindowState)
        {
            return;
        }

        _lastWindowState = state;
        _emitWindowStateChanged(state);
    }

    private void RefreshObservedState()
    {
        RefreshPointerPosition();
        RefreshWindowState();
    }

    private void OnGoBackRequested()
    {
        _emitBackRequested();
    }

    private void SetPointerPassthrough(bool enabled)
    {
        if (OperatingSystem.IsWindowsVersionAtLeast(5))
        {
            WindowsMousePassthrough.Set(_window, enabled);
            _windowsPointerPassthrough = enabled;
            return;
        }

        _window.MousePassthrough = enabled;
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
