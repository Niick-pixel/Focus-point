// Detects whether a fullscreen game, video or presentation is in front, so breaks can wait.
//
// Windows only (other platforms always report "not fullscreen"). Two checks:
//   1. SHQueryUserNotificationState – what Windows itself uses to hold back notifications.
//      Catches exclusive-fullscreen (Direct3D) games, presentation mode and fullscreen Store apps.
//   2. Foreground window covers its whole monitor – catches "borderless windowed" games and
//      fullscreen browser/video players, which check 1 misses.
// Native calls go through koffi (prebuilt FFI, no compiler needed).

// SHQueryUserNotificationState results that mean "don't disturb"
const QUNS_BUSY = 2;                // a fullscreen app is running
const QUNS_RUNNING_D3D_FULL_SCREEN = 3;
const QUNS_PRESENTATION_MODE = 4;
const QUNS_APP = 7;                 // fullscreen Windows Store app / game
const BUSY_STATES = new Set([QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE, QUNS_APP]);

// The desktop and taskbar are "full screen" windows too; never treat them as an app.
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

const MONITOR_DEFAULTTONEAREST = 2;

function defineTypes(koffi) {
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  koffi.alias('HWND', HANDLE);
  koffi.alias('HMONITOR', HANDLE);
  const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const MONITORINFO = koffi.struct('MONITORINFO', {
    cbSize: 'uint32_t',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32_t',
  });
  return { MONITORINFO };
}

const PROTOTYPES = {
  user32: {
    GetForegroundWindow: 'HWND __stdcall GetForegroundWindow()',
    GetWindowRect: 'int __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)',
    MonitorFromWindow: 'HMONITOR __stdcall MonitorFromWindow(HWND hwnd, uint32_t dwFlags)',
    GetMonitorInfoW: 'int __stdcall GetMonitorInfoW(HMONITOR hMonitor, _Inout_ MONITORINFO *lpmi)',
    GetClassNameW: 'int __stdcall GetClassNameW(HWND hWnd, uint16_t *lpClassName, int nMaxCount)',
    GetWindowThreadProcessId: 'uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *lpdwProcessId)',
  },
  shell32: {
    SHQueryUserNotificationState: 'int32_t __stdcall SHQueryUserNotificationState(_Out_ int *pquns)',
  },
};

function createDetector() {
  if (process.platform !== 'win32') return () => false;

  let api;
  try {
    const koffi = require('koffi');
    const { MONITORINFO } = defineTypes(koffi);
    api = { MONITORINFO_SIZE: koffi.sizeof(MONITORINFO) };
    for (const [dll, fns] of Object.entries(PROTOTYPES)) {
      const lib = koffi.load(`${dll}.dll`);
      for (const [name, proto] of Object.entries(fns)) api[name] = lib.func(proto);
    }
  } catch (err) {
    console.error('Fullscreen detection unavailable:', err);
    return () => false;
  }

  const classBuf = new Uint16Array(256);

  return function isFullscreenActive() {
    try {
      const state = [0];
      if (api.SHQueryUserNotificationState(state) === 0 && BUSY_STATES.has(state[0])) return true;

      const hwnd = api.GetForegroundWindow();
      if (!hwnd) return false;

      // Our own break overlays are fullscreen on purpose.
      const pid = [0];
      api.GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid) return false;

      const len = api.GetClassNameW(hwnd, classBuf, classBuf.length);
      const cls = String.fromCharCode(...classBuf.subarray(0, len));
      if (SHELL_CLASSES.has(cls)) return false;

      const win = {};
      if (!api.GetWindowRect(hwnd, win)) return false;
      const info = { cbSize: api.MONITORINFO_SIZE };
      if (!api.GetMonitorInfoW(api.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info)) return false;
      const mon = info.rcMonitor;
      return win.left <= mon.left && win.top <= mon.top && win.right >= mon.right && win.bottom >= mon.bottom;
    } catch {
      return false;
    }
  };
}

module.exports = { createDetector, PROTOTYPES, defineTypes };
