using System.Text.Json;
using Eventa;
using Godot;

namespace GdKirie.Tray;

/// <summary>Owns the process tray icon and its Eventa registrations.</summary>
internal sealed class GdKirieTrayHost : IDisposable
{
    private readonly Window _window;
    private readonly SceneTree _sceneTree;
    private readonly IEventContext _context;
    private readonly IDisposable[] _registrations;
    private bool _disposed;

    internal GdKirieTrayHost(IEventContext context, Window window)
    {
        _window = window;
        _sceneTree = window.GetTree();
        _context = context;
        _registrations =
        [
            context.RegisterInvokeHandler(
                TrayEvents.Create,
                (options, _) => Complete(() => Create(options))),
            context.RegisterInvokeHandler(
                TrayEvents.SetIcon,
                (icon, _) => Complete(() => SetIcon(icon))),
            context.RegisterInvokeHandler(
                TrayEvents.SetMenu,
                (items, _) => Complete(() => SetMenu(items))),
            context.RegisterInvokeHandler(
                TrayEvents.SetTooltip,
                (tooltip, _) => Complete(() => SetTooltip(tooltip))),
            context.RegisterInvokeHandler(
                TrayEvents.SetVisible,
                (visible, _) => Complete(() => SetVisible(visible))),
            context.RegisterInvokeHandler(
                TrayEvents.Destroy,
                (EmptyPayload _, CancellationToken _) => Complete(Destroy)),
        ];
        _window.TreeExiting += Dispose;
        _sceneTree.ProcessFrame += DrainMenuEvents;
    }

    private void Create(TrayIconPayload icon)
    {
        ArgumentNullException.ThrowIfNull(icon);
        EnsureAvailable();

        var pixels = LoadIcon(icon.Icon);
        TrayNative.Create(pixels.Rgba, pixels.Width, pixels.Height, icon.IconAsTemplate);
    }

    private void SetIcon(TrayIconPayload icon)
    {
        ArgumentNullException.ThrowIfNull(icon);
        EnsureAvailable();

        var pixels = LoadIcon(icon.Icon);
        TrayNative.SetIcon(pixels.Rgba, pixels.Width, pixels.Height, icon.IconAsTemplate);
    }

    private void SetMenu(JsonElement menu)
    {
        EnsureAvailable();
        TrayNative.SetMenu(menu.GetRawText());
    }

    private void SetTooltip(string? tooltip)
    {
        EnsureAvailable();
        TrayNative.SetTooltip(tooltip);
    }

    private void SetVisible(bool visible)
    {
        EnsureAvailable();
        TrayNative.SetVisible(visible);
    }

    private void Destroy()
    {
        EnsureAvailable();
        TrayNative.Destroy();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        EnsureMainThread();
        _disposed = true;
        _window.TreeExiting -= Dispose;
        _sceneTree.ProcessFrame -= DrainMenuEvents;

        TrayNative.Destroy();
        foreach (var registration in _registrations)
        {
            registration.Dispose();
        }
    }

    private void DrainMenuEvents()
    {
        while (TrayNative.PollMenuEvent() is { } id)
        {
            _context.Emit(TrayEvents.MenuItemActivated, id);
        }
    }

    private static TrayIconPixels LoadIcon(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith("res://", StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "Tray texture paths must be non-empty res:// resources.",
                nameof(path));
        }

        var texture = GD.Load<Texture2D>(path)
            ?? throw new ArgumentException($"Tray texture '{path}' could not be loaded.", nameof(path));
        using var image = texture.GetImage();
        if (image.IsCompressed())
        {
            var error = image.Decompress();
            if (error != Error.Ok)
            {
                throw new InvalidOperationException($"Godot failed to decompress the tray icon image: {error}.");
            }
        }

        image.Convert(Image.Format.Rgba8);
        return new TrayIconPixels(image.GetData(), (uint)image.GetWidth(), (uint)image.GetHeight());
    }

    private void EnsureAvailable()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        EnsureMainThread();
    }

    private static void EnsureMainThread()
    {
        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException("System tray operations must run on Godot's main thread.");
        }
    }

    private static Task<EmptyPayload> Complete(Action action)
    {
        action();
        return Task.FromResult(new EmptyPayload());
    }

    private readonly record struct TrayIconPixels(byte[] Rgba, uint Width, uint Height);
}
