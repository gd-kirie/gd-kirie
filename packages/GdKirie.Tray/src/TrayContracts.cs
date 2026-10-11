using System.Text.Json;
using System.Text.Json.Serialization;
using Eventa;

namespace GdKirie.Tray;

internal sealed record EmptyPayload;

/// <summary>Godot texture passed to the native Tray library.</summary>
/// <param name="Icon">Imported Godot texture resource path.</param>
internal sealed record TrayIconPayload(string Icon)
{
    /// <summary>Whether macOS renders the icon as a template image.</summary>
    public bool IconAsTemplate { get; init; }
}

internal static class TrayEvents
{
    private const string Prefix = "kirie:tray";

    public static readonly InvokeEventDefinition<EmptyPayload, TrayIconPayload> Create =
        new($"{Prefix}:create");

    public static readonly InvokeEventDefinition<EmptyPayload, TrayIconPayload> SetIcon =
        new($"{Prefix}:set-icon");

    public static readonly InvokeEventDefinition<EmptyPayload, JsonElement> SetMenu =
        new($"{Prefix}:set-menu");

    public static readonly InvokeEventDefinition<EmptyPayload, string?> SetTooltip =
        new($"{Prefix}:set-tooltip");

    public static readonly InvokeEventDefinition<EmptyPayload, bool> SetVisible =
        new($"{Prefix}:set-visible");

    public static readonly InvokeEventDefinition<EmptyPayload, EmptyPayload> Destroy =
        new($"{Prefix}:destroy");

    public static readonly EventDefinition<string> MenuItemActivated =
        new($"{Prefix}:menu-item-activated");
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(EmptyPayload))]
[JsonSerializable(typeof(TrayIconPayload))]
[JsonSerializable(typeof(JsonElement))]
[JsonSerializable(typeof(bool))]
[JsonSerializable(typeof(string))]
internal sealed partial class TrayJsonContext : JsonSerializerContext;
