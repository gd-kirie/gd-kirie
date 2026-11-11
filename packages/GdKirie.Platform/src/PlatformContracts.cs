using System.Text.Json.Serialization;
using Eventa;

namespace GdKirie.Platform;

internal sealed record EmptyPayload;

internal sealed record GlobalShortcutPayload(
    long Keycode,
    bool ShiftPressed,
    bool AltPressed,
    bool CtrlPressed,
    bool MetaPressed,
    bool CommandOrControlAutoremap);

internal sealed record GlobalShortcutKeyEventPayload(
    GlobalShortcutPayload Shortcut,
    string State);

internal static class PlatformEvents
{
    private const string HostWindowPrefix = "kirie:platform:host-window";
    private const string GlobalShortcutPrefix = "kirie:platform:global-shortcut";
    private const string BackPrefix = "kirie:platform:back";

    public static readonly InvokeEventDefinition<EmptyPayload, EmptyPayload> BeginMove =
        new($"{HostWindowPrefix}:begin-move");

    public static readonly InvokeEventDefinition<EmptyPayload, string> BeginResize =
        new($"{HostWindowPrefix}:begin-resize");

    public static readonly InvokeEventDefinition<EmptyPayload, EmptyPayload> Center =
        new($"{HostWindowPrefix}:center");

    public static readonly InvokeEventDefinition<KirieWindowBounds, EmptyPayload> GetBounds =
        new($"{HostWindowPrefix}:get-bounds");

    public static readonly InvokeEventDefinition<KirieWindowBounds, EmptyPayload> GetCurrentDisplayBounds =
        new($"{HostWindowPrefix}:get-current-display-bounds");

    public static readonly InvokeEventDefinition<KiriePointerPosition, EmptyPayload> GetPointerPosition =
        new($"{HostWindowPrefix}:get-pointer-position");

    public static readonly EventDefinition<KiriePointerPosition> PointerPositionChanged =
        new($"{HostWindowPrefix}:pointer-position-changed");

    public static readonly InvokeEventDefinition<KirieWindowState, EmptyPayload> GetState =
        new($"{HostWindowPrefix}:get-state");

    public static readonly EventDefinition<KirieWindowState> StateChanged =
        new($"{HostWindowPrefix}:state-changed");

    public static readonly InvokeEventDefinition<EmptyPayload, bool> SetAlwaysOnTop =
        new($"{HostWindowPrefix}:set-always-on-top");

    public static readonly InvokeEventDefinition<EmptyPayload, bool> SetPointerPassthrough =
        new($"{HostWindowPrefix}:set-pointer-passthrough");

    public static readonly InvokeEventDefinition<EmptyPayload, GlobalShortcutPayload> RegisterGlobalShortcut =
        new($"{GlobalShortcutPrefix}:register");

    public static readonly InvokeEventDefinition<EmptyPayload, GlobalShortcutPayload> UnregisterGlobalShortcut =
        new($"{GlobalShortcutPrefix}:unregister");

    public static readonly EventDefinition<GlobalShortcutKeyEventPayload> GlobalShortcutStateChanged =
        new($"{GlobalShortcutPrefix}:state-changed");

    public static readonly EventDefinition<EmptyPayload> BackRequested =
        new($"{BackPrefix}:requested");

    public static readonly InvokeEventDefinition<EmptyPayload, string> OpenExternalUrl =
        new("kirie:platform:open-external-url");

    public static readonly InvokeEventDefinition<string, EmptyPayload> OpenApplicationDataDirectory =
        new("kirie:platform:open-application-data-directory");
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(EmptyPayload))]
[JsonSerializable(typeof(bool))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(KiriePointerPosition))]
[JsonSerializable(typeof(KirieWindowBounds))]
[JsonSerializable(typeof(KirieWindowState))]
[JsonSerializable(typeof(GlobalShortcutPayload))]
[JsonSerializable(typeof(GlobalShortcutKeyEventPayload))]
internal sealed partial class PlatformJsonContext : JsonSerializerContext;
