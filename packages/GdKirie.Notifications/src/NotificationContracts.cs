using System.Text.Json.Serialization;
using Eventa;

namespace GdKirie.Notifications;

internal sealed record EmptyPayload;
internal sealed record NotificationPayload(string Id, string Title, string Body);
internal sealed record NotificationActivatedPayload(string Id);

internal static class NotificationEvents
{
    public static readonly InvokeEventDefinition<EmptyPayload, NotificationPayload> Show =
        new("kirie:notifications:show");
    public static readonly EventDefinition<NotificationActivatedPayload> Activated =
        new("kirie:notifications:activated");
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(EmptyPayload))]
[JsonSerializable(typeof(NotificationPayload))]
[JsonSerializable(typeof(NotificationActivatedPayload))]
internal sealed partial class NotificationJsonContext : JsonSerializerContext;
