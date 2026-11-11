using GdKirie.EventaAdapter;
using Godot;

namespace GdKirie.Platform;

/// <summary>
/// Text IPC transport backed by the native <c>KirieHost</c> Godot singleton for host-owned shells.
/// </summary>
public sealed class KirieHostTextTransport : IKirieTextTransport, IDisposable
{
    /// <summary>
    /// Engine singleton name registered by the native host bridge.
    /// </summary>
    public const string SingletonName = "KirieHost";

    private const string HostMessageReceivedSignal = "host_message_received";
    private const string SendToHostMethod = "send_to_host";

    private readonly GodotObject _singleton;
    private readonly Callable _messageReceivedCallable;
    private bool _disposed;

    /// <summary>
    /// Connects to the native <c>KirieHost</c> singleton on Godot's main thread.
    /// </summary>
    public KirieHostTextTransport()
    {
        if (!GodotThread.IsMainThread())
        {
            throw new InvalidOperationException(
                "KirieHostTextTransport must be created on Godot's main thread.");
        }

        if (!Engine.HasSingleton(SingletonName))
        {
            throw new PlatformNotSupportedException(
                $"Godot native singleton '{SingletonName}' is not available in this host.");
        }

        _singleton = Engine.GetSingleton(SingletonName)
            ?? throw new PlatformNotSupportedException(
                $"Godot native singleton '{SingletonName}' returned null.");
        if (!_singleton.HasSignal(HostMessageReceivedSignal))
        {
            throw new InvalidOperationException(
                $"Godot native singleton '{SingletonName}' does not expose signal '{HostMessageReceivedSignal}'.");
        }

        _messageReceivedCallable = Callable.From<string>(OnHostMessageReceived);
        _singleton.Connect(HostMessageReceivedSignal, _messageReceivedCallable);
    }

    /// <summary>
    /// Indicates whether the native <c>KirieHost</c> singleton is registered in the current Godot runtime.
    /// </summary>
    public static bool IsAvailable => Engine.HasSingleton(SingletonName);

    /// <inheritdoc />
    public event Action<string>? TextReceived;

    /// <inheritdoc />
    public void SendText(string packet)
    {
        ArgumentNullException.ThrowIfNull(packet);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);

        if (GodotThread.IsMainThread())
        {
            SendOnMainThread(packet);
            return;
        }

        Callable.From(() => SendOnMainThread(packet)).CallDeferred();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, true))
        {
            return;
        }

        if (GodotThread.IsMainThread())
        {
            DisconnectSignal();
            return;
        }

        Callable.From(DisconnectSignal).CallDeferred();
    }

    private void SendOnMainThread(string packet)
    {
        if (Volatile.Read(ref _disposed) || !GodotObject.IsInstanceValid(_singleton))
        {
            return;
        }

        _singleton.Call(SendToHostMethod, packet);
    }

    private void DisconnectSignal()
    {
        if (GodotObject.IsInstanceValid(_singleton)
            && _singleton.IsConnected(HostMessageReceivedSignal, _messageReceivedCallable))
        {
            _singleton.Disconnect(HostMessageReceivedSignal, _messageReceivedCallable);
        }
    }

    private void OnHostMessageReceived(string message)
    {
        if (Volatile.Read(ref _disposed))
        {
            return;
        }

        TextReceived?.Invoke(message);
    }
}
