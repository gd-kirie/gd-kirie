using Eventa;
using GdKirie.EventaAdapter;
using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Registers and attaches Kirie Platform capabilities.
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
                PlatformJsonContext.Default.KirieWindowBounds,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.GetCurrentDisplayBounds,
                PlatformJsonContext.Default.KirieWindowBounds,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterInvoke(
                PlatformEvents.GetPointerPosition,
                PlatformJsonContext.Default.KiriePointerPosition,
                PlatformJsonContext.Default.EmptyPayload)
            .RegisterEvent(
                PlatformEvents.PointerPositionChanged,
                PlatformJsonContext.Default.KiriePointerPosition)
            .RegisterInvoke(
                PlatformEvents.GetState,
                PlatformJsonContext.Default.KirieWindowState,
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
                PlatformJsonContext.Default.KirieWindowState);
    }

    /// <summary>
    /// Attaches Platform handlers to an existing Eventa context and explicit host window.
    /// </summary>
    public static GdKiriePlatformHost Attach(IEventContext context, Window hostWindow)
    {
        return Attach(context, hostWindow, windowBackend: null);
    }

    /// <summary>
    /// Attaches Platform handlers to an existing Eventa context, host window, and optional window backend.
    /// When <paramref name="windowBackend"/> is omitted on an embedded window, OS and scene capabilities attach
    /// while window-owned operations throw <see cref="PlatformNotSupportedException"/> when invoked.
    /// </summary>
    public static GdKiriePlatformHost Attach(
        IEventContext context,
        Window hostWindow,
        IKirieWindowBackend? windowBackend = null)
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

        var effectiveWindowBackend = windowBackend
            ?? (hostWindow.IsEmbedded() ? null : new GodotWindowBackend(hostWindow));
        return new GdKiriePlatformHost(context, hostWindow, effectiveWindowBackend);
    }
}
