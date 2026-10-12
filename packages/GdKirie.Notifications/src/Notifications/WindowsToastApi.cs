using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32.Foundation;

namespace GdKirie.Notifications;

[SupportedOSPlatform("windows10.0.14393.0")]
internal static unsafe class WindowsToastApi
{
    private static readonly Guid XmlDocumentIid = new("F7F3A506-1E87-42D6-BCFB-B8C809FA5494");
    private static readonly Guid XmlDocumentIoIid = new("6CD0E74E-EE65-4489-9EBF-CA43E87BA637");
    private static readonly Guid ToastFactoryIid = new("04124B20-82C6-4229-B109-FD9ED4662B53");
    private static readonly Guid ToastManagerIid = new("50AC103F-D235-4598-BBEF-98FE4D1A3AD4");

    public static void Show(string applicationId, string xml)
    {
        var apartment = Thread.CurrentThread.GetApartmentState() == ApartmentState.STA
            ? RoInitType.SingleThreaded
            : RoInitType.MultiThreaded;
        var initialization = WinRtInterop.RoInitialize(apartment);
        if (initialization.Value < 0 && (uint)initialization.Value != 0x80010106)
        {
            ThrowIfFailed(initialization.Value);
        }

        var document = IntPtr.Zero;
        var documentIo = IntPtr.Zero;
        var documentInterface = IntPtr.Zero;
        var factory = IntPtr.Zero;
        var toast = IntPtr.Zero;
        var manager = IntPtr.Zero;
        var notifier = IntPtr.Zero;
        try
        {
            document = Activate("Windows.Data.Xml.Dom.XmlDocument");
            documentIo = QueryInterface(document, XmlDocumentIoIid);
            using (var xmlString = new WinRtString(xml))
            {
                ThrowIfFailed(LoadXml(documentIo, xmlString.Value));
            }

            documentInterface = QueryInterface(document, XmlDocumentIid);
            factory = GetActivationFactory("Windows.UI.Notifications.ToastNotification", ToastFactoryIid);
            toast = CreateToast(factory, documentInterface);
            manager = GetActivationFactory("Windows.UI.Notifications.ToastNotificationManager", ToastManagerIid);
            using (var applicationIdString = new WinRtString(applicationId))
            {
                notifier = CreateNotifier(manager, applicationIdString.Value);
            }

            ThrowIfFailed(ShowToast(notifier, toast));

            // Read the setting after the call above: before a notifier has ever
            // delivered, IToastNotifier::get_Setting fails with ERROR_NOT_FOUND
            // (0x80070490) instead of reporting a value. Only a reported value
            // that is not Allowed means the user or policy blocked this app.
            var setting = GetSetting(notifier);
            if (setting is > 0)
            {
                throw new UnauthorizedAccessException(
                    $"Windows notification permission is not granted for this application ({DescribeSetting(setting.Value)}).");
            }
        }
        finally
        {
            Release(notifier);
            Release(manager);
            Release(toast);
            Release(factory);
            Release(documentInterface);
            Release(documentIo);
            Release(document);
            if (initialization.Value >= 0)
            {
                WinRtInterop.RoUninitialize();
            }
        }
    }

    private static nint Activate(string className)
    {
        using var name = new WinRtString(className);
        void* instance;
        ThrowIfFailed(WinRtInterop.RoActivateInstance(name.Value, out instance));
        return (nint)instance;
    }

    private static nint GetActivationFactory(string className, Guid iid)
    {
        using var name = new WinRtString(className);
        void* factory;
        ThrowIfFailed(WinRtInterop.RoGetActivationFactory(name.Value, &iid, &factory));
        return (nint)factory;
    }

    private static nint QueryInterface(nint instance, Guid iid)
    {
        var queryInterface = (delegate* unmanaged[Stdcall]<nint, Guid*, nint*, int>)Vtable(instance)[0];
        nint result;
        ThrowIfFailed(queryInterface(instance, &iid, &result));
        return result;
    }

    private static int LoadXml(nint documentIo, HSTRING xml)
    {
        // IXmlDocumentIO: IInspectable — LoadXml is 6.
        var loadXml = (delegate* unmanaged[Stdcall]<nint, HSTRING, int>)Vtable(documentIo)[6];
        return loadXml(documentIo, xml);
    }

    private static nint CreateToast(nint factory, nint document)
    {
        // IToastNotificationFactory: IInspectable — CreateToastNotification is 6.
        var create = (delegate* unmanaged[Stdcall]<nint, nint, nint*, int>)Vtable(factory)[6];
        nint toast;
        ThrowIfFailed(create(factory, document, &toast));
        return toast;
    }

    private static nint CreateNotifier(nint manager, HSTRING applicationId)
    {
        // IToastNotificationManagerStatics: IInspectable — CreateToastNotifierWithId is 7.
        var create = (delegate* unmanaged[Stdcall]<nint, HSTRING, nint*, int>)Vtable(manager)[7];
        nint notifier;
        ThrowIfFailed(create(manager, applicationId, &notifier));
        return notifier;
    }

    private static int? GetSetting(nint notifier)
    {
        // IToastNotifier: IInspectable — Show is 6, Hide is 7, get_Setting is 8,
        // AddToHistory 9, RemoveFromHistory 10.
        var getSetting = (delegate* unmanaged[Stdcall]<nint, int*, int>)Vtable(notifier)[8];
        int setting;
        var result = getSetting(notifier, &setting);
        if ((uint)result == 0x80070490)
        {
            // The query itself can fail (ERROR_NOT_FOUND before the notifier has
            // ever delivered). That is not a report that notifications are off.
            return null;
        }

        ThrowIfFailed(result);
        return setting;
    }

    private static int ShowToast(nint notifier, nint toast)
    {
        var show = (delegate* unmanaged[Stdcall]<nint, nint, int>)Vtable(notifier)[6];
        return show(notifier, toast);
    }

    private static void Release(nint instance)
    {
        if (instance == 0)
        {
            return;
        }

        var release = (delegate* unmanaged[Stdcall]<nint, uint>)Vtable(instance)[2];
        release(instance);
    }

    private static nint* Vtable(nint instance) => *(nint**)instance;

    private static void ThrowIfFailed(int result)
    {
        if (result < 0)
        {
            Marshal.ThrowExceptionForHR(result);
        }
    }

    private static void ThrowIfFailed(HRESULT result) => ThrowIfFailed(result.Value);

    private static string DescribeSetting(int setting) => setting switch
    {
        1 => "disabled for this application",
        2 => "disabled for this user",
        3 => "disabled by group policy",
        4 => "disabled because the application has no notification identity",
        _ => $"disabled ({setting})",
    };

    private readonly struct WinRtString : IDisposable
    {
        private readonly HSTRING _value;

        public WinRtString(string value)
        {
            fixed (char* characters = value)
            {
                HSTRING created;
                ThrowIfFailed(WinRtInterop.WindowsCreateString(characters, (uint)value.Length, &created));
                _value = created;
            }
        }

        public HSTRING Value => _value;

        public void Dispose()
        {
            if (_value.Value != null)
            {
                WinRtInterop.WindowsDeleteString(_value);
            }
        }
    }
}
