using System.Reflection;
using System.Runtime.InteropServices;
using Godot;

namespace GdKirie.Tray;

internal static partial class TrayNative
{
    private const string LibraryName = "kirie_tray_native";

    static TrayNative()
    {
        NativeLibrary.SetDllImportResolver(typeof(TrayNative).Assembly, ResolveLibrary);
    }

    public static unsafe void Create(byte[] rgba, uint width, uint height, bool iconAsTemplate)
    {
        fixed (byte* data = rgba)
        {
            ThrowIfFailed(CreateNative(data, (nuint)rgba.Length, width, height, iconAsTemplate));
        }
    }

    public static unsafe void SetIcon(byte[] rgba, uint width, uint height, bool iconAsTemplate)
    {
        fixed (byte* data = rgba)
        {
            ThrowIfFailed(SetIconNative(data, (nuint)rgba.Length, width, height, iconAsTemplate));
        }
    }

    public static void SetMenu(string menuJson) => ThrowIfFailed(SetMenuNative(menuJson));

    public static void SetTooltip(string? tooltip) =>
        ThrowIfFailed(SetTooltipNative(tooltip ?? string.Empty));

    public static void SetVisible(bool visible) => ThrowIfFailed(SetVisibleNative(visible));

    public static string? PollMenuEvent()
    {
        var eventId = PollMenuEventNative();
        if (eventId != nint.Zero)
        {
            return Marshal.PtrToStringUTF8(eventId);
        }

        var error = Marshal.PtrToStringUTF8(LastErrorNative());
        if (!string.IsNullOrEmpty(error))
        {
            throw new InvalidOperationException(error);
        }

        return null;
    }

    public static void Destroy() => ThrowIfFailed(DestroyNative());

    private static void ThrowIfFailed(bool succeeded)
    {
        if (succeeded)
        {
            return;
        }

        var error = LastErrorNative();
        throw new InvalidOperationException(
            error == nint.Zero
                ? "The native tray operation failed."
                : Marshal.PtrToStringUTF8(error));
    }

    private static nint ResolveLibrary(
        string libraryName,
        Assembly _,
        DllImportSearchPath? __)
    {
        if (libraryName != LibraryName)
        {
            return nint.Zero;
        }

        var fileName = "libkirie_tray_native.so";
        if (OperatingSystem.IsWindows())
        {
            fileName = "kirie_tray_native.dll";
        }
        else if (OperatingSystem.IsMacOS())
        {
            fileName = "libkirie_tray_native.dylib";
        }

        string[] candidates =
        [
            Path.Combine(AppContext.BaseDirectory, fileName),
            ProjectSettings.GlobalizePath($"res://.godot/mono/temp/bin/Debug/{fileName}"),
            ProjectSettings.GlobalizePath($"res://.godot/mono/temp/bin/Release/{fileName}"),
        ];

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return NativeLibrary.Load(candidate);
            }
        }

        throw new DllNotFoundException(
            $"The Tray native library '{fileName}' was not found in the application or Godot build directory.");
    }

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_create")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static unsafe partial bool CreateNative(
        byte* rgba,
        nuint rgbaLength,
        uint width,
        uint height,
        [MarshalAs(UnmanagedType.I1)] bool iconAsTemplate);

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_set_icon")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static unsafe partial bool SetIconNative(
        byte* rgba,
        nuint rgbaLength,
        uint width,
        uint height,
        [MarshalAs(UnmanagedType.I1)] bool iconAsTemplate);

    [LibraryImport(
        LibraryName,
        EntryPoint = "kirie_tray_set_menu",
        StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static partial bool SetMenuNative(string menuJson);

    [LibraryImport(
        LibraryName,
        EntryPoint = "kirie_tray_set_tooltip",
        StringMarshalling = StringMarshalling.Utf8)]
    [return: MarshalAs(UnmanagedType.I1)]
    private static partial bool SetTooltipNative(string tooltip);

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_set_visible")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static partial bool SetVisibleNative([MarshalAs(UnmanagedType.I1)] bool visible);

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_poll_menu_event")]
    private static partial nint PollMenuEventNative();

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_destroy")]
    [return: MarshalAs(UnmanagedType.I1)]
    private static partial bool DestroyNative();

    [LibraryImport(LibraryName, EntryPoint = "kirie_tray_last_error")]
    private static partial nint LastErrorNative();
}
