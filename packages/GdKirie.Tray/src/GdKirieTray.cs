using Eventa;
using GdKirie.EventaAdapter;
using Godot;

namespace GdKirie.Tray;

/// <summary>Registers and attaches the Kirie system tray plugin.</summary>
public static class GdKirieTray
{
    /// <summary>Registers the Tray wire contracts in an application's Eventa JSON registry.</summary>
    public static KirieEventaJsonRegistry Register(KirieEventaJsonRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);

        return registry
            .RegisterInvoke(
                TrayEvents.Create,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.TrayIconPayload)
            .RegisterInvoke(
                TrayEvents.SetIcon,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.TrayIconPayload)
            .RegisterInvoke(
                TrayEvents.SetMenu,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.JsonElement)
            .RegisterInvoke(
                TrayEvents.SetTooltip,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.String)
            .RegisterInvoke(
                TrayEvents.SetVisible,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.Boolean)
            .RegisterInvoke(
                TrayEvents.Destroy,
                TrayJsonContext.Default.EmptyPayload,
                TrayJsonContext.Default.EmptyPayload)
            .RegisterEvent(
                TrayEvents.MenuItemActivated,
                TrayJsonContext.Default.String);
    }

    /// <summary>Attaches Tray handlers to an existing Eventa context and Godot window.</summary>
    public static IDisposable Attach(IEventContext context, Window hostWindow)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(hostWindow);
        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException("GdKirieTray.Attach must run on Godot's main thread.");
        }

        if (!OperatingSystem.IsMacOS() &&
            !OperatingSystem.IsWindows() &&
            !OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("System trays are supported only on desktop platforms.");
        }

        if (!hostWindow.IsInsideTree())
        {
            throw new ArgumentException("The host window must be inside the scene tree.", nameof(hostWindow));
        }

        return new GdKirieTrayHost(context, hostWindow);
    }
}
