using Godot;

namespace GdKirie.Platform;

internal sealed class GodotWindowBackend : IKirieWindowBackend
{
    private readonly Window _window;
    private readonly SceneTree _sceneTree;
    private KiriePointerPosition? _lastPointerPosition;
    private KirieWindowState? _lastWindowState;
    private bool _windowsPointerPassthrough;
    private bool _disposed;

    public GodotWindowBackend(Window window)
    {
        _window = window;
        _sceneTree = window.GetTree();
        _window.FocusEntered += RefreshWindowState;
        _window.FocusExited += RefreshWindowState;
        _window.SizeChanged += RefreshWindowState;
        _window.VisibilityChanged += RefreshWindowState;
        _sceneTree.ProcessFrame += RefreshObservedState;
    }

    public event Action<KiriePointerPosition>? PointerPositionChanged;

    public event Action<KirieWindowState>? StateChanged;

    public void BeginMove()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _window.StartDrag();
    }

    public void BeginResize(DisplayServer.WindowResizeEdge edge)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _window.StartResize(edge);
    }

    public void Center()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _window.MoveToCenter();
    }

    public KirieWindowBounds GetBounds()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var position = _window.Position;
        var size = _window.Size;
        return new KirieWindowBounds(position.X, position.Y, size.X, size.Y);
    }

    public void SetBounds(KirieWindowBounds bounds)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _window.Position = new Vector2I(bounds.X, bounds.Y);
        _window.Size = new Vector2I(bounds.Width, bounds.Height);
    }

    public KirieWindowBounds GetCurrentDisplayBounds()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var screen = _window.CurrentScreen;
        var position = DisplayServer.ScreenGetPosition(screen);
        var size = DisplayServer.ScreenGetSize(screen);
        return new KirieWindowBounds(position.X, position.Y, size.X, size.Y);
    }

    public KiriePointerPosition GetPointerPosition()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var position = CapturePointerPosition();
        _lastPointerPosition = position;
        return position;
    }

    public KirieWindowState GetState()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var state = CaptureWindowState();
        _lastWindowState = state;
        return state;
    }

    public void SetAlwaysOnTop(bool enabled)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _window.AlwaysOnTop = enabled;
    }

    public void SetPointerPassthrough(bool enabled)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (OperatingSystem.IsWindowsVersionAtLeast(5))
        {
            WindowsMousePassthrough.Set(_window, enabled);
            _windowsPointerPassthrough = enabled;
            return;
        }

        _window.MousePassthrough = enabled;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _window.FocusEntered -= RefreshWindowState;
        _window.FocusExited -= RefreshWindowState;
        _window.SizeChanged -= RefreshWindowState;
        _window.VisibilityChanged -= RefreshWindowState;
        _sceneTree.ProcessFrame -= RefreshObservedState;

        if (_windowsPointerPassthrough
            && OperatingSystem.IsWindowsVersionAtLeast(5)
            && GodotObject.IsInstanceValid(_window))
        {
            WindowsMousePassthrough.Set(_window, false);
        }
    }

    private KiriePointerPosition CapturePointerPosition()
    {
        var relativePosition = DisplayServer.MouseGetPosition() - _window.Position;
        var size = _window.Size;
        return new KiriePointerPosition(
            relativePosition.X,
            relativePosition.Y,
            relativePosition.X >= 0
                && relativePosition.Y >= 0
                && relativePosition.X < size.X
                && relativePosition.Y < size.Y);
    }

    private KirieWindowState CaptureWindowState()
    {
        return new KirieWindowState(
            _window.HasFocus(),
            _window.Mode == Window.ModeEnum.Minimized,
            _window.Visible);
    }

    private void RefreshPointerPosition()
    {
        if (_disposed || _lastPointerPosition is null)
        {
            return;
        }

        var position = CapturePointerPosition();
        if (position == _lastPointerPosition.Value)
        {
            return;
        }

        _lastPointerPosition = position;
        PointerPositionChanged?.Invoke(position);
    }

    private void RefreshWindowState()
    {
        if (_disposed || _lastWindowState is null)
        {
            return;
        }

        var state = CaptureWindowState();
        if (state == _lastWindowState.Value)
        {
            return;
        }

        _lastWindowState = state;
        StateChanged?.Invoke(state);
    }

    private void RefreshObservedState()
    {
        RefreshPointerPosition();
        RefreshWindowState();
    }
}
