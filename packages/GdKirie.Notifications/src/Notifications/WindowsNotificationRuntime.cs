using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.Win32;
using Windows.Win32;
using Windows.Win32.System.Com;
using Windows.Win32.System.WinRT;

namespace GdKirie.Notifications;

/// <summary>
/// One process-wide toast registration. The COM activator stays in this process
/// and the registry entries are removed once the last Platform host is gone, so
/// a click does not start the executable after that.
/// </summary>
[SupportedOSPlatform("windows10.0.14393.0")]
internal static unsafe class WindowsNotificationRuntime
{
    private const int ClassNotAggregatable = unchecked((int)0x80040110);
    private const int NoInterface = unchecked((int)0x80004002);

    private static readonly Guid ClassFactoryIid = new("00000001-0000-0000-C000-000000000046");
    private static readonly Guid UnknownIid = new("00000000-0000-0000-C000-000000000046");
    private static readonly Guid ActivationIid = new("53E31837-6600-4A81-9395-75CFFE746F94");
    private static readonly object Gate = new();

    private static Action<string>? _listener;
    private static SynchronizationContext? _listenerContext;
    private static nint* _factoryVtable;
    private static nint* _activatorVtable;
    private static void* _factory;
    private static void* _activator;
    private static Thread? _thread;
    private static ManualResetEventSlim? _ready;
    private static ManualResetEventSlim? _stop;
    private static Exception? _startError;
    private static uint _cookie;
    private static string? _applicationId;
    private static Guid _activatorId;

    public static void SetListener(Action<string> onActivated, SynchronizationContext synchronizationContext)
    {
        lock (Gate)
        {
            if (_listener is not null)
            {
                throw new InvalidOperationException("Only one Kirie notification listener can be active per process.");
            }

            _listener = onActivated;
            _listenerContext = synchronizationContext;
        }
    }

    public static void RemoveListener()
    {
        Exception? stopError;
        lock (Gate)
        {
            _listener = null;
            _listenerContext = null;
            if (_thread is null)
            {
                return;
            }

            _stop?.Set();
            _thread.Join();
            _thread = null;
            _stop?.Dispose();
            _stop = null;
            DeleteRegistry();
            stopError = _startError;
            _startError = null;
        }

        if (stopError is not null)
        {
            ExceptionDispatchInfo.Capture(stopError).Throw();
        }
    }

    public static void Show(NotificationPayload notification)
    {
        lock (Gate)
        {
            if (_listener is null)
            {
                throw new InvalidOperationException("Windows notifications require a registered listener.");
            }

            if (_thread is null)
            {
                Register();
            }

            WindowsToastApi.Show(_applicationId!, ToastXml(notification));
        }
    }

    private static void Register()
    {
        var identity = CreateIdentity();
        try
        {
            WriteRegistry(identity);
            StartActivator(identity.ActivatorId);
            _applicationId = identity.ApplicationId;
            _activatorId = identity.ActivatorId;
        }
        catch
        {
            DeleteRegistry(identity.ApplicationId, identity.ActivatorId);
            throw;
        }
    }

    private static NotificationIdentity CreateIdentity()
    {
        var executablePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("Windows notifications require the current executable path.");
        if (executablePath.Contains('"', StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Windows notifications cannot register an executable path that contains quotes.");
        }

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(executablePath));
        var applicationId = "GdKirie." + Convert.ToHexString(hash)[..32];
        var activatorId = new Guid(hash.AsSpan(0, 16));
        var displayName = Path.GetFileNameWithoutExtension(executablePath);
        if (string.IsNullOrWhiteSpace(displayName))
        {
            displayName = "Kirie";
        }

        return new NotificationIdentity(applicationId, activatorId, displayName, executablePath);
    }

    private static void WriteRegistry(NotificationIdentity identity)
    {
        using var applicationKey = Registry.CurrentUser.CreateSubKey(
            $@"Software\Classes\AppUserModelId\{identity.ApplicationId}");
        applicationKey.SetValue("DisplayName", identity.DisplayName);
        applicationKey.SetValue("IconBackgroundColor", "FFDDDDDD");
        applicationKey.SetValue("CustomActivator", identity.ActivatorId.ToString("B"));

        using var serverKey = Registry.CurrentUser.CreateSubKey(
            $@"Software\Classes\CLSID\{identity.ActivatorId:B}\LocalServer32");
        serverKey.SetValue(null, '"' + identity.ExecutablePath + '"');
    }

    private static void DeleteRegistry()
    {
        if (_applicationId is null)
        {
            return;
        }

        var applicationId = _applicationId;
        DeleteRegistry(applicationId, _activatorId);
        _applicationId = null;
    }

    private static void DeleteRegistry(string applicationId, Guid activatorId)
    {
        DeleteTree($@"Software\Classes\CLSID\{activatorId:B}");
        DeleteTree($@"Software\Classes\AppUserModelId\{applicationId}");
    }

    private static void DeleteTree(string name)
    {
        Registry.CurrentUser.DeleteSubKeyTree(name, throwOnMissingSubKey: false);
    }

    private static void StartActivator(Guid activatorId)
    {
        _startError = null;
        _ready = new ManualResetEventSlim(false);
        _stop = new ManualResetEventSlim(false);
        _thread = new Thread(() => ActivatorThread(activatorId))
        {
            IsBackground = true,
            Name = "Kirie Windows notifications",
        };
        _thread.Start();
        _ready.Wait();
        _ready.Dispose();
        _ready = null;
        if (_startError is not null)
        {
            _thread.Join();
            _thread = null;
            _stop.Dispose();
            _stop = null;
            ExceptionDispatchInfo.Capture(_startError).Throw();
        }
    }

    private static void ActivatorThread(Guid activatorId)
    {
        var initialized = false;
        try
        {
            var initialization = WinRtInterop.RoInitialize(RoInitType.MultiThreaded);
            if (initialization.Value < 0 && (uint)initialization.Value != 0x80010106)
            {
                Marshal.ThrowExceptionForHR(initialization.Value);
            }

            initialized = initialization.Value >= 0;
            EnsureVtables();
            _factory = Allocate(_factoryVtable);
            _activator = Allocate(_activatorVtable);
            WinRtInterop.CoRegisterClassObject(
                &activatorId,
                _factory,
                (uint)CLSCTX.CLSCTX_LOCAL_SERVER,
                (uint)REGCLS.REGCLS_MULTIPLEUSE,
                out _cookie).ThrowOnFailure();
            _ready!.Set();
            _stop!.Wait();
            if (_cookie != 0)
            {
                WinRtInterop.CoRevokeClassObject(_cookie).ThrowOnFailure();
                _cookie = 0;
            }
        }
        catch (Exception error)
        {
            _startError = error;
            _ready?.Set();
        }
        finally
        {
            if (_cookie == 0)
            {
                ReleaseReference(_factory);
                ReleaseReference(_activator);
                _factory = null;
                _activator = null;
            }

            if (initialized)
            {
                WinRtInterop.RoUninitialize();
            }
        }
    }

    private static void OnActivated(char* invokedArgs)
    {
        if (invokedArgs is null)
        {
            return;
        }

        var listener = Volatile.Read(ref _listener);
        var context = Volatile.Read(ref _listenerContext);
        if (listener is null || context is null)
        {
            return;
        }

        // The launch argument is Kirie's native ID. The Platform router restores
        // the caller-owned ID after this callback reaches Godot's main thread.
        var notificationId = new string(invokedArgs);
        context.Post(_ =>
        {
            if (ReferenceEquals(Volatile.Read(ref _listener), listener))
            {
                listener(notificationId);
            }
        }, null);
    }

    private static string ToastXml(NotificationPayload notification)
    {
        return new XElement("toast",
            new XAttribute("launch", notification.Id),
            new XElement("visual",
                new XElement("binding",
                    new XAttribute("template", "ToastGeneric"),
                    new XElement("text", notification.Title),
                    new XElement("text", notification.Body))),
            new XElement("audio", new XAttribute("silent", true)))
            .ToString(SaveOptions.DisableFormatting);
    }

    private static void EnsureVtables()
    {
        if (_factoryVtable is not null)
        {
            return;
        }

        _factoryVtable = (nint*)NativeMemory.Alloc(5, (nuint)sizeof(nint));
        _factoryVtable[0] = (nint)(delegate* unmanaged[Stdcall]<void*, Guid*, void**, int>)&FactoryQueryInterface;
        _factoryVtable[1] = (nint)(delegate* unmanaged[Stdcall]<void*, uint>)&AddRef;
        _factoryVtable[2] = (nint)(delegate* unmanaged[Stdcall]<void*, uint>)&Release;
        _factoryVtable[3] = (nint)(delegate* unmanaged[Stdcall]<void*, void*, Guid*, void**, int>)&CreateInstance;
        _factoryVtable[4] = (nint)(delegate* unmanaged[Stdcall]<void*, int, int>)&LockServer;

        _activatorVtable = (nint*)NativeMemory.Alloc(4, (nuint)sizeof(nint));
        _activatorVtable[0] = (nint)(delegate* unmanaged[Stdcall]<void*, Guid*, void**, int>)&ActivatorQueryInterface;
        _activatorVtable[1] = (nint)(delegate* unmanaged[Stdcall]<void*, uint>)&AddRef;
        _activatorVtable[2] = (nint)(delegate* unmanaged[Stdcall]<void*, uint>)&Release;
        _activatorVtable[3] = (nint)(delegate* unmanaged[Stdcall]<void*, char*, char*, void*, uint, int>)&Activate;
    }

    private static void* Allocate(nint* vtable)
    {
        var instance = (void**)NativeMemory.Alloc(2, (nuint)sizeof(nint));
        instance[0] = vtable;
        *(int*)(instance + 1) = 1;
        return instance;
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static int FactoryQueryInterface(void* self, Guid* iid, void** result) =>
        HandleQueryInterface(self, iid, result, ClassFactoryIid);

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static int ActivatorQueryInterface(void* self, Guid* iid, void** result) =>
        HandleQueryInterface(self, iid, result, ActivationIid);

    private static int HandleQueryInterface(void* self, Guid* iid, void** result, Guid interfaceId)
    {
        if (result is null)
        {
            return NoInterface;
        }

        if (iid is null || (*iid != interfaceId && *iid != UnknownIid))
        {
            *result = null;
            return NoInterface;
        }

        AddReference(self);
        *result = self;
        return 0;
    }

    private static uint AddReference(void* self)
    {
        var count = Interlocked.Increment(ref *(int*)((byte*)self + sizeof(nint)));
        return (uint)count;
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static uint AddRef(void* self) => AddReference(self);

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static uint Release(void* self) => ReleaseReference(self);

    private static uint ReleaseReference(void* self)
    {
        if (self is null)
        {
            return 0;
        }

        var count = Interlocked.Decrement(ref *(int*)((byte*)self + sizeof(nint)));
        if (count == 0)
        {
            NativeMemory.Free(self);
        }

        return (uint)count;
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static int CreateInstance(void* self, void* outer, Guid* iid, void** result)
    {
        if (outer is not null)
        {
            return ClassNotAggregatable;
        }

        if (_activator is null)
        {
            return NoInterface;
        }

        return HandleQueryInterface(_activator, iid, result, ActivationIid);
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static int LockServer(void* self, int @lock) => 0;

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static int Activate(void* self, char* applicationId, char* invokedArgs, void* data, uint dataCount)
    {
        try
        {
            OnActivated(invokedArgs);
            return 0;
        }
        catch
        {
            return unchecked((int)0x80004005);
        }
    }

    private readonly record struct NotificationIdentity(
        string ApplicationId,
        Guid ActivatorId,
        string DisplayName,
        string ExecutablePath);
}
