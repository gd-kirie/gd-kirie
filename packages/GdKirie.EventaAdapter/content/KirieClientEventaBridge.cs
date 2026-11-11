#nullable enable

using System;
using System.Threading;

namespace GdKirie.EventaAdapter;

/// <summary>
/// Source bridge from addon-shipped <c>KirieClient</c> to <c>GdKirie.EventaAdapter</c>.
/// </summary>
public sealed class KirieClientTextTransport : IKirieTextTransport, IDisposable
{
    private readonly global::KirieClient _client;
    private readonly SynchronizationContext? _synchronizationContext;
    private bool _disposed;

    /// <summary>
    /// Wraps an existing <c>KirieClient</c> text lane for Eventa transport.
    /// </summary>
    public KirieClientTextTransport(global::KirieClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _synchronizationContext = SynchronizationContext.Current;
        _client.TextReceived += OnTextReceived;
    }

    /// <inheritdoc />
    public event Action<string>? TextReceived;

    /// <inheritdoc />
    public void SendText(string message)
    {
        ArgumentNullException.ThrowIfNull(message);
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_synchronizationContext is null
            || ReferenceEquals(SynchronizationContext.Current, _synchronizationContext))
        {
            _client.SendText(message);
            return;
        }

        _synchronizationContext.Post(_ => _client.SendText(message), null);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _client.TextReceived -= OnTextReceived;
    }

    private void OnTextReceived(string message)
    {
        if (_disposed)
        {
            return;
        }

        TextReceived?.Invoke(message);
    }
}

/// <summary>
/// Extension methods connecting addon-shipped <c>KirieClient</c> to Eventa.
/// </summary>
public static class KirieClientEventaExtensions
{
    /// <summary>
    /// Creates an Eventa context over <paramref name="client"/>'s text IPC lane.
    /// </summary>
    public static KirieEventaContextHandle CreateEventaContext(
        this global::KirieClient client,
        KirieEventaJsonRegistry registry)
    {
        return KirieEventa.CreateContext(new KirieClientTextTransport(client), registry, disposeTransport: true);
    }
}
