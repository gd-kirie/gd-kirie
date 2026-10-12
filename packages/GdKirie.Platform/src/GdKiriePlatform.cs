using Eventa;
using GdKirie.EventaAdapter;
using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Registers and attaches Kirie's desktop Platform capabilities.
/// </summary>
public static class GdKiriePlatform
{
    /// <summary>
    /// Registers the fixed Platform wire contracts in an application's Eventa JSON registry.
    /// </summary>
    public static KirieEventaJsonRegistry Register(KirieEventaJsonRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);

        return registry
            .RegisterInvoke(
                PlatformEvents.BeginMove,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.BeginResize,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.String)
            .RegisterInvoke(
                PlatformEvents.Center,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.GetBounds,
                PlatformJsonContext.Default.BoundsPayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.GetCurrentDisplayBounds,
                PlatformJsonContext.Default.BoundsPayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.GetPointerPosition,
                PlatformJsonContext.Default.PointerPositionPayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterEvent(
                PlatformEvents.PointerPositionChanged,
                PlatformJsonContext.Default.PointerPositionPayload)
            .RegisterInvoke(
                PlatformEvents.GetState,
                PlatformJsonContext.Default.WindowStatePayload,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.SetAlwaysOnTop,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.Boolean)
            .RegisterInvoke(
                PlatformEvents.SetPointerPassthrough,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.Boolean)
            .RegisterInvoke(
                PlatformEvents.RegisterGlobalShortcut,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.GlobalShortcutPayload)
            .RegisterInvoke(
                PlatformEvents.UnregisterGlobalShortcut,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.GlobalShortcutPayload)
            .RegisterInvoke(
                PlatformEvents.OpenExternalUrl,
                PlatformJsonContext.Default.EmptyPayload,
                PlatformJsonContext.Default.String)
            .RegisterInvoke(
                PlatformEvents.OpenApplicationDataDirectory,
                PlatformJsonContext.Default.String,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterEvent(
                PlatformEvents.GlobalShortcutStateChanged,
                PlatformJsonContext.Default.GlobalShortcutKeyEventPayload)
            .RegisterEvent(
                PlatformEvents.BackRequested,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterEvent(
                PlatformEvents.StateChanged,
                PlatformJsonContext.Default.WindowStatePayload);
    }

    /// <summary>
    /// Attaches Platform handlers to an existing Eventa context and explicit host window.
    /// </summary>
    public static GdKiriePlatformHost Attach(IEventContext context, Window hostWindow)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(hostWindow);
        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException("GdKiriePlatform.Attach must run on Godot's main thread.");
        }

        if (!hostWindow.IsInsideTree())
        {
            throw new ArgumentException("The host window must be inside the scene tree.", nameof(hostWindow));
        }

        if (hostWindow.IsEmbedded())
        {
            throw new PlatformNotSupportedException(
                "Platform host-window capabilities require a native, non-embedded Godot Window.");
        }

        return new GdKiriePlatformHost(context, hostWindow);
    }
}
