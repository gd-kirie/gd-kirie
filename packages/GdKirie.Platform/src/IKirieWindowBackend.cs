using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Screen-space window or display rectangle in pixels.
/// </summary>
/// <param name="X">Horizontal position in pixels.</param>
/// <param name="Y">Vertical position in pixels.</param>
/// <param name="Width">Rectangle width in pixels.</param>
/// <param name="Height">Rectangle height in pixels.</param>
public readonly record struct KirieWindowBounds(
    int X,
    int Y,
    int Width,
    int Height);

/// <summary>
/// Window-relative pointer coordinates and hit state.
/// </summary>
/// <param name="X">Horizontal pointer offset relative to the window origin.</param>
/// <param name="Y">Vertical pointer offset relative to the window origin.</param>
/// <param name="Inside">Whether the pointer lies within the window rectangle.</param>
public readonly record struct KiriePointerPosition(
    int X,
    int Y,
    bool Inside);

/// <summary>
/// Focus, minimize, and visibility state of a host window.
/// </summary>
/// <param name="Focused">Whether the window currently holds input focus.</param>
/// <param name="Minimized">Whether the window is currently minimized.</param>
/// <param name="Visible">Whether the window is currently visible.</param>
public readonly record struct KirieWindowState(
    bool Focused,
    bool Minimized,
    bool Visible);

/// <summary>
/// Backend for host-window operations owned by a desktop or native shell.
/// </summary>
public interface IKirieWindowBackend : IDisposable
{
    /// <summary>
    /// Raised when the window-relative pointer position or inside state changes.
    /// </summary>
    event Action<KiriePointerPosition>? PointerPositionChanged;

    /// <summary>
    /// Raised when the window focus, minimize, or visibility state changes.
    /// </summary>
    event Action<KirieWindowState>? StateChanged;

    /// <summary>
    /// Starts an interactive window drag operation.
    /// </summary>
    void BeginMove();

    /// <summary>
    /// Starts an interactive window resize operation from <paramref name="edge"/>.
    /// </summary>
    void BeginResize(DisplayServer.WindowResizeEdge edge);

    /// <summary>
    /// Centers the window on its current display.
    /// </summary>
    void Center();

    /// <summary>
    /// Gets the current window position and size.
    /// </summary>
    KirieWindowBounds GetBounds();

    /// <summary>
    /// Sets the window position and size.
    /// </summary>
    void SetBounds(KirieWindowBounds bounds);

    /// <summary>
    /// Gets the position and size of the display containing the window.
    /// </summary>
    KirieWindowBounds GetCurrentDisplayBounds();

    /// <summary>
    /// Captures the current window-relative pointer position.
    /// </summary>
    KiriePointerPosition GetPointerPosition();

    /// <summary>
    /// Captures the current window focus, minimize, and visibility state.
    /// </summary>
    KirieWindowState GetState();

    /// <summary>
    /// Enables or disables keeping the window above normal windows.
    /// </summary>
    void SetAlwaysOnTop(bool enabled);

    /// <summary>
    /// Enables or disables click-through pointer passthrough on the window.
    /// </summary>
    void SetPointerPassthrough(bool enabled);
}
