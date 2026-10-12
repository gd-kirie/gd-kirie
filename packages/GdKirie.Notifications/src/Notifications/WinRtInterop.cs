using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32.Foundation;

namespace GdKirie.Notifications;

/// <summary>
/// A counted WinRT string handle. The raw entry points below exchange it as a
/// pointer, so the generated CsWin32 projections do not apply.
/// </summary>
internal readonly unsafe struct HSTRING
{
    public readonly void* Value;
}

/// <summary>
/// Raw, blittable WinRT and COM entry points shared by the Windows notification
/// types. The generated CsWin32 marshalling overloads for these take handles and
/// managed objects, which do not fit a pointer-and-vtable design.
/// </summary>
[SupportedOSPlatform("windows10.0.14393.0")]
internal static unsafe class WinRtInterop
{
    [DllImport("api-ms-win-core-winrt-l1-1-0.dll", EntryPoint = "RoInitialize")]
    public static extern HRESULT RoInitialize(RoInitType apartment);

    [DllImport("api-ms-win-core-winrt-l1-1-0.dll", EntryPoint = "RoUninitialize")]
    public static extern void RoUninitialize();

    [DllImport("api-ms-win-core-winrt-l1-1-0.dll", EntryPoint = "RoActivateInstance")]
    public static extern HRESULT RoActivateInstance(HSTRING className, out void* instance);

    [DllImport("api-ms-win-core-winrt-l1-1-0.dll", EntryPoint = "RoGetActivationFactory")]
    public static extern HRESULT RoGetActivationFactory(HSTRING className, Guid* iid, void** factory);

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll", EntryPoint = "WindowsCreateString")]
    public static extern HRESULT WindowsCreateString(char* value, uint length, HSTRING* created);

    [DllImport("api-ms-win-core-winrt-string-l1-1-0.dll", EntryPoint = "WindowsDeleteString")]
    public static extern HRESULT WindowsDeleteString(HSTRING value);

    [DllImport("ole32.dll", EntryPoint = "CoRegisterClassObject")]
    public static extern HRESULT CoRegisterClassObject(
        Guid* classId,
        void* classObject,
        uint context,
        uint flags,
        out uint cookie);

    [DllImport("ole32.dll", EntryPoint = "CoRevokeClassObject")]
    public static extern HRESULT CoRevokeClassObject(uint cookie);
}

/// <summary>
/// <c>RO_INIT_TYPE</c> for <see cref="WinRtInterop.RoInitialize"/>.
/// </summary>
internal enum RoInitType
{
    SingleThreaded = 0,
    MultiThreaded = 1,
}
