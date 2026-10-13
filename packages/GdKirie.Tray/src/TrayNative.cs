using Godot;

namespace GdKirie.Tray;

// See docs/decisions/0014-load-tray-through-a-gdextension.md.
internal sealed class TrayNative : IDisposable
{
    private readonly RefCounted _tray;

    internal TrayNative()
    {
        using var className = new StringName("KirieTrayNative");
        if (!ClassDB.ClassExists(className))
        {
            throw new InvalidOperationException(
                "The Kirie Tray GDExtension is not loaded. Install the @gd-kirie/tray plugin assets in this Godot project.");
        }

        using var instance = ClassDB.Instantiate(className);
        _tray = (RefCounted)instance.AsGodotObject();
    }

    internal void Create(byte[] rgba, uint width, uint height, bool iconAsTemplate) =>
        Execute("create", rgba, width, height, iconAsTemplate);

    internal void SetIcon(byte[] rgba, uint width, uint height, bool iconAsTemplate) =>
        Execute("set_icon", rgba, width, height, iconAsTemplate);

    internal void SetMenu(string menuJson) => Execute("set_menu", menuJson);

    internal void SetTooltip(string? tooltip) => Execute("set_tooltip", tooltip ?? string.Empty);

    internal void SetVisible(bool visible) => Execute("set_visible", visible);

    internal string[] PollMenuEvents()
    {
        using var method = new StringName("poll_menu_events");
        using var result = _tray.Call(method);
        return result.AsStringArray();
    }

    internal void Destroy() => Execute("destroy");

    public void Dispose() => _tray.Dispose();

    private void Execute(string method, params Variant[] arguments)
    {
        try
        {
            using var methodName = new StringName(method);
            using var result = _tray.Call(methodName, arguments);
            var error = result.AsString();
            if (!string.IsNullOrEmpty(error))
            {
                throw new InvalidOperationException(error);
            }
        }
        finally
        {
            foreach (var argument in arguments)
            {
                argument.Dispose();
            }
        }
    }
}
