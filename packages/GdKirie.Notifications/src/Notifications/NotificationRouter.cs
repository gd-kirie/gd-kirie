namespace GdKirie.Notifications;

/// <summary>
/// Routes a process notification back to the Notifications host that published it.
/// Native identifiers include a host ID and preserve the caller-owned ID.
/// </summary>
internal sealed class NotificationRouter
{
    private const int HostKeyLength = 32;
    private readonly Dictionary<Guid, Action<string>> _handlers = [];

    public int OwnerCount => _handlers.Count;

    public Guid Add(Action<string> onActivated)
    {
        var hostId = Guid.NewGuid();
        _handlers.Add(hostId, onActivated);
        return hostId;
    }

    public string NativeId(Guid hostId, string callerId)
    {
        if (!_handlers.ContainsKey(hostId))
        {
            throw new ObjectDisposedException("Kirie notification host");
        }

        return $"{hostId:N}:{callerId}";
    }

    public void Activate(string nativeId)
    {
        if (nativeId.Length <= HostKeyLength + 1
            || nativeId[HostKeyLength] != ':'
            || !Guid.TryParseExact(nativeId.AsSpan(0, HostKeyLength), "N", out var hostId))
        {
            return;
        }

        if (_handlers.TryGetValue(hostId, out var onActivated))
        {
            onActivated(nativeId[(HostKeyLength + 1)..]);
        }
    }

    public bool Remove(Guid hostId) => _handlers.Remove(hostId);
}
