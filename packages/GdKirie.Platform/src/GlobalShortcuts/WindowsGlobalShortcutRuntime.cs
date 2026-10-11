using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Input.KeyboardAndMouse;
using Windows.Win32.UI.WindowsAndMessaging;

namespace GdKirie.Platform;

// ADR-0003: Windows uses one lazy process-wide low-level keyboard hook while
// keeping registration callbacks scoped to their owning Platform hosts.
[SupportedOSPlatform("windows10.0")]
internal sealed class WindowsGlobalShortcutRuntime
{
    private const uint RightShiftScanCode = 0x36;

    private static readonly HOOKPROC HookProcedure = LowLevelKeyboardCallback;

    public static WindowsGlobalShortcutRuntime Shared { get; } = new();

    private readonly object _lifecycleGate = new();
    private readonly object _registrationsGate = new();
    private readonly object _failureGate = new();
    private readonly Dictionary<long, Registration> _registrations = [];
    private readonly WindowsShortcutMatcher _matcher = new();
    private Thread? _hookThread;
    private uint _hookThreadId;
    private Exception? _hookFailure;
    private long _nextRegistrationId;

    private WindowsGlobalShortcutRuntime()
    {
    }

    public IDisposable Register(
        WindowsKeycode keycode,
        GlobalShortcut shortcut,
        SynchronizationContext synchronizationContext,
        Action<string> callback)
    {
        ArgumentNullException.ThrowIfNull(synchronizationContext);
        ArgumentNullException.ThrowIfNull(callback);

        lock (_lifecycleGate)
        {
            if (RegistrationCount == 0)
            {
                StartHook();
            }

            if (GetHookFailure() is { } hookFailure)
            {
                throw new InvalidOperationException("The Windows keyboard hook is not running.", hookFailure);
            }

            var id = ++_nextRegistrationId;
            var registration = new Registration(this, id, synchronizationContext, callback);
            lock (_registrationsGate)
            {
                _registrations.Add(id, registration);
                _matcher.Register(id, keycode, shortcut);
            }

            return registration;
        }
    }

    private int RegistrationCount
    {
        get
        {
            lock (_registrationsGate)
            {
                return _registrations.Count;
            }
        }
    }

    private void StartHook()
    {
        if (_hookThread is not null)
        {
            if (_hookThread.IsAlive)
            {
                return;
            }

            _hookThread.Join();
            _hookThread = null;
            _hookThreadId = 0;
            RethrowHookFailure();
        }

        ClearHookFailure();
        using var ready = new ManualResetEventSlim();
        var thread = new Thread(() => RunHookThread(ready))
        {
            IsBackground = true,
            Name = "GdKirie Windows global shortcuts",
        };
        _hookThread = thread;
        thread.Start();
        ready.Wait();

        if (GetHookFailure() is not { } failure)
        {
            return;
        }

        thread.Join();
        _hookThread = null;
        _hookThreadId = 0;
        ClearHookFailure();
        throw new InvalidOperationException("Failed to start the Windows keyboard hook.", failure);
    }

    private void StopHook()
    {
        var thread = _hookThread;
        if (thread is null)
        {
            RethrowHookFailure();
            return;
        }

        if (thread.IsAlive
            && !PInvoke.PostThreadMessage(_hookThreadId, PInvoke.WM_QUIT, default, default))
        {
            var error = Marshal.GetLastPInvokeError();
            if (thread.IsAlive)
            {
                throw new Win32Exception(error, "PostThreadMessageW failed while stopping the Windows keyboard hook.");
            }
        }

        thread.Join();
        _hookThread = null;
        _hookThreadId = 0;
        lock (_registrationsGate)
        {
            _matcher.Clear();
        }

        RethrowHookFailure();
    }

    private void RethrowHookFailure()
    {
        var failure = TakeHookFailure();
        if (failure is null)
        {
            return;
        }

        System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private void RecordHookFailure(Exception error)
    {
        lock (_failureGate)
        {
            _hookFailure ??= error;
        }
    }

    private Exception? GetHookFailure()
    {
        lock (_failureGate)
        {
            return _hookFailure;
        }
    }

    private Exception? TakeHookFailure()
    {
        lock (_failureGate)
        {
            var failure = _hookFailure;
            _hookFailure = null;
            return failure;
        }
    }

    private void ClearHookFailure()
    {
        lock (_failureGate)
        {
            _hookFailure = null;
        }
    }

    private unsafe void RunHookThread(ManualResetEventSlim ready)
    {
        HHOOK hook = default;
        try
        {
            _hookThreadId = PInvoke.GetCurrentThreadId();
            _ = PInvoke.PeekMessage(
                out _,
                default,
                0,
                0,
                PEEK_MESSAGE_REMOVE_TYPE.PM_NOREMOVE);

            var module = PInvoke.GetModuleHandle(default(PCWSTR));
            if (module.IsNull)
            {
                throw new Win32Exception(Marshal.GetLastPInvokeError(), "GetModuleHandleW failed.");
            }

            hook = PInvoke.SetWindowsHookEx(
                WINDOWS_HOOK_ID.WH_KEYBOARD_LL,
                HookProcedure,
                module,
                0);
            if (hook.IsNull)
            {
                throw new Win32Exception(Marshal.GetLastPInvokeError(), "SetWindowsHookExW failed.");
            }

            SeedPressedModifiers();
            ready.Set();

            while (true)
            {
                var result = PInvoke.GetMessage(out _, default, 0, 0).Value;
                if (result > 0)
                {
                    continue;
                }

                if (result == 0)
                {
                    break;
                }

                throw new Win32Exception(Marshal.GetLastPInvokeError(), "GetMessageW failed.");
            }
        }
        catch (Exception error)
        {
            RecordHookFailure(error);
        }
        finally
        {
            ready.Set();

            if (!hook.IsNull && !PInvoke.UnhookWindowsHookEx(hook))
            {
                RecordHookFailure(new Win32Exception(
                    Marshal.GetLastPInvokeError(),
                    "UnhookWindowsHookEx failed."));
            }
        }
    }

    private void SeedPressedModifiers()
    {
        lock (_registrationsGate)
        {
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyLeftShift);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyRightShift);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyLeftControl);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyRightControl);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyLeftAlt);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyRightAlt);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyLeftMeta);
            SeedPressedModifier(WindowsShortcutMatcher.VirtualKeyRightMeta);
        }
    }

    private void SeedPressedModifier(uint virtualKey)
    {
        if ((PInvoke.GetAsyncKeyState((int)virtualKey) & 0x8000) != 0)
        {
            _matcher.SeedPressedModifier(virtualKey);
        }
    }

    private static unsafe LRESULT LowLevelKeyboardCallback(int code, WPARAM message, LPARAM eventData)
    {
        if (code < 0)
        {
            return PInvoke.CallNextHookEx(default(HHOOK), code, message, eventData);
        }

        try
        {
            var messageId = (uint)message.Value;
            if (code == PInvoke.HC_ACTION
                && messageId is PInvoke.WM_KEYDOWN
                    or PInvoke.WM_KEYUP
                    or PInvoke.WM_SYSKEYDOWN
                    or PInvoke.WM_SYSKEYUP)
            {
                var keyboardEvent = *(KBDLLHOOKSTRUCT*)eventData.Value;
                var extended = (keyboardEvent.flags & KBDLLHOOKSTRUCT_FLAGS.LLKHF_EXTENDED) != 0;
                var keycode = new WindowsKeycode(
                    keyboardEvent.scanCode,
                    extended);
                Shared.DispatchKeyEvent(
                    keycode,
                    NormalizeVirtualKey(keyboardEvent.vkCode, keyboardEvent.scanCode, extended),
                    messageId is PInvoke.WM_KEYDOWN or PInvoke.WM_SYSKEYDOWN);
            }
        }
        catch (Exception error)
        {
            Shared.RecordHookFailure(error);
        }

        return PInvoke.CallNextHookEx(default(HHOOK), code, message, eventData);
    }

    private static uint NormalizeVirtualKey(uint virtualKey, uint scanCode, bool extended)
    {
        return virtualKey switch
        {
            (uint)VIRTUAL_KEY.VK_SHIFT => scanCode == RightShiftScanCode
                ? WindowsShortcutMatcher.VirtualKeyRightShift
                : WindowsShortcutMatcher.VirtualKeyLeftShift,
            (uint)VIRTUAL_KEY.VK_CONTROL => extended
                ? WindowsShortcutMatcher.VirtualKeyRightControl
                : WindowsShortcutMatcher.VirtualKeyLeftControl,
            (uint)VIRTUAL_KEY.VK_MENU => extended
                ? WindowsShortcutMatcher.VirtualKeyRightAlt
                : WindowsShortcutMatcher.VirtualKeyLeftAlt,
            _ => virtualKey,
        };
    }

    private void DispatchKeyEvent(WindowsKeycode keycode, uint virtualKey, bool pressed)
    {
        List<(Registration Registration, string State)>? deliveries = null;
        lock (_registrationsGate)
        {
            foreach (var transition in _matcher.Handle(keycode, virtualKey, pressed))
            {
                if (_registrations.TryGetValue(transition.RegistrationId, out var registration)
                    && registration.Active)
                {
                    deliveries ??= [];
                    deliveries.Add((registration, transition.State));
                }
            }
        }

        if (deliveries is null)
        {
            return;
        }

        foreach (var (registration, state) in deliveries)
        {
            registration.SynchronizationContext?.Post(_ => Deliver(registration, state), null);
        }
    }

    private void Deliver(Registration registration, string state)
    {
        Action<string>? callback;
        lock (_registrationsGate)
        {
            if (!registration.Active
                || !_registrations.TryGetValue(registration.Id, out var current)
                || !ReferenceEquals(current, registration))
            {
                return;
            }

            callback = registration.Callback;
        }

        callback?.Invoke(state);
    }

    private void Unregister(Registration registration)
    {
        lock (_lifecycleGate)
        {
            lock (_registrationsGate)
            {
                if (registration.Active)
                {
                    registration.Active = false;
                    registration.Callback = null;
                    registration.SynchronizationContext = null;
                    _registrations.Remove(registration.Id);
                    _matcher.Unregister(registration.Id);
                }
            }

            if (RegistrationCount == 0)
            {
                StopHook();
            }
        }
    }

    private sealed class Registration(
        WindowsGlobalShortcutRuntime owner,
        long id,
        SynchronizationContext synchronizationContext,
        Action<string> callback) : IDisposable
    {
        private bool _disposed;

        public long Id { get; } = id;

        public bool Active { get; set; } = true;

        public SynchronizationContext? SynchronizationContext { get; set; } = synchronizationContext;

        public Action<string>? Callback { get; set; } = callback;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            owner.Unregister(this);
            _disposed = true;
        }
    }
}
