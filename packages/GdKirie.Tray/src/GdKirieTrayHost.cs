using System.Text.Json;
using Eventa;
using Godot;

namespace GdKirie.Tray;

/// <summary>Owns a native Tray object and its Eventa registrations.</summary>
internal sealed class GdKirieTrayHost : IDisposable
{
    private readonly Window _window;
    private readonly SceneTree _sceneTree;
    private readonly IEventContext _context;
    private readonly TrayNative _native;
    private readonly IDisposable[] _registrations;
    private bool _disposed;

    internal GdKirieTrayHost(IEventContext context, Window window)
    {
        _window = window;
        _sceneTree = window.GetTree();
        _context = context;
        _native = new TrayNative();
        var registrations = new List<IDisposable>();
        try
        {
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.Create,
                (options, _) => Complete(() => Create(options))));
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.SetIcon,
                (icon, _) => Complete(() => SetIcon(icon))));
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.SetMenu,
                (items, _) => Complete(() => _native.SetMenu(items.GetRawText()))));
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.SetTooltip,
                (tooltip, _) => Complete(() => _native.SetTooltip(tooltip))));
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.SetVisible,
                (visible, _) => Complete(() => _native.SetVisible(visible))));
            registrations.Add(context.RegisterInvokeHandler(
                TrayEvents.Destroy,
                (EmptyPayload _, CancellationToken _) => Complete(_native.Destroy)));

            _registrations = registrations.ToArray();
        }
        catch
        {
            foreach (var registration in registrations)
            {
                registration.Dispose();
            }

            _native.Dispose();
            throw;
        }

        _window.TreeExiting += Dispose;
        _sceneTree.ProcessFrame += DrainMenuEvents;
    }

    private void Create(TrayIconPayload icon)
    {
        ArgumentNullException.ThrowIfNull(icon);
        var pixels = LoadIcon(icon.Icon);
        _native.Create(pixels.Rgba, pixels.Width, pixels.Height, icon.IconAsTemplate);
    }

    private void SetIcon(TrayIconPayload icon)
    {
        ArgumentNullException.ThrowIfNull(icon);
        var pixels = LoadIcon(icon.Icon);
        _native.SetIcon(pixels.Rgba, pixels.Width, pixels.Height, icon.IconAsTemplate);
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

        try
        {
            _native.Destroy();
        }
        finally
        {
            _native.Dispose();
            foreach (var registration in _registrations)
            {
                registration.Dispose();
            }
        }
    }

    private void DrainMenuEvents()
    {
        foreach (var id in _native.PollMenuEvents())
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

    private Task<EmptyPayload> Complete(Action action)
    {
        EnsureAvailable();
        action();
        return Task.FromResult(new EmptyPayload());
    }

    private readonly record struct TrayIconPixels(byte[] Rgba, uint Width, uint Height);
}
