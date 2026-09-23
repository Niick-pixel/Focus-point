// Strict mode: swallow the shortcuts that let you escape a break (Windows only).
//
// Uses a low-level keyboard hook (SetWindowsHookEx WH_KEYBOARD_LL), which sees keys
// before Windows acts on them, so it can stop Alt+Tab and the Windows key. The hook
// runs on Electron's main thread (which pumps Windows messages) and must answer fast,
// so the decision below is a tiny pure function.
//
// Deliberately NOT blocked:
//   Ctrl+Alt+Del     – Windows' secure attention sequence; no app can (or should) block it
//   Ctrl+Shift+Esc   – Task Manager stays available as a safety net
//   Esc on its own   – used for the break screen's "hold Esc to exit" emergency exit

const VK = {
  TAB: 0x09, CONTROL: 0x11, SHIFT: 0x10, ESCAPE: 0x1b, SPACE: 0x20,
  LWIN: 0x5b, RWIN: 0x5c, F4: 0x73,
};
const LLKHF_ALTDOWN = 0x20;
const WH_KEYBOARD_LL = 13;
const HC_ACTION = 0;
const MAX_HOOK_MS = 2 * 60 * 60 * 1000; // failsafe: never hold the keyboard longer than 2 h

/**
 * @param {{ vk: number, alt: boolean, ctrl: boolean, shift: boolean }} key
 * @returns {boolean} true to swallow the key event
 */
function shouldBlock({ vk, alt, ctrl, shift }) {
  if (vk === VK.LWIN || vk === VK.RWIN) return true;        // Start menu, Win+D, Win+Tab, ...
  if (alt && (vk === VK.TAB || vk === VK.ESCAPE || vk === VK.F4 || vk === VK.SPACE)) return true;
  if (ctrl && !shift && vk === VK.ESCAPE) return true;      // Ctrl+Esc opens Start
  return false;
}

const PROTOTYPES = {
  user32: {
    SetWindowsHookExW: 'HHOOK __stdcall SetWindowsHookExW(int idHook, LowLevelKeyboardProc *lpfn, HMODULE hmod, uint32_t dwThreadId)',
    UnhookWindowsHookEx: 'int __stdcall UnhookWindowsHookEx(HHOOK hhk)',
    CallNextHookEx: 'intptr_t __stdcall CallNextHookEx(HHOOK hhk, int nCode, uintptr_t wParam, void *lParam)',
    GetAsyncKeyState: 'int16_t __stdcall GetAsyncKeyState(int vKey)',
  },
  kernel32: {
    GetModuleHandleW: 'HMODULE __stdcall GetModuleHandleW(void *lpModuleName)',
  },
};

function defineTypes(koffi) {
  koffi.pointer('HHOOK', koffi.opaque());
  koffi.pointer('HMODULE', koffi.opaque());
  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32_t',
    scanCode: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  });
  const LowLevelKeyboardProc = koffi.proto('intptr_t __stdcall LowLevelKeyboardProc(int nCode, uintptr_t wParam, void *lParam)');
  return { KBDLLHOOKSTRUCT, LowLevelKeyboardProc };
}

/** Returns { start(), stop(), active } — no-ops where unsupported. */
function createKeyBlocker() {
  const noop = { start() { return false; }, stop() {}, get active() { return false; } };
  if (process.platform !== 'win32') return noop;

  let koffi, api, types;
  try {
    koffi = require('koffi');
    types = defineTypes(koffi);
    api = {};
    for (const [dll, fns] of Object.entries(PROTOTYPES)) {
      const lib = koffi.load(`${dll}.dll`);
      for (const [name, proto] of Object.entries(fns)) api[name] = lib.func(proto);
    }
  } catch (err) {
    console.error('Strict mode keyboard blocking unavailable:', err);
    return noop;
  }

  let hook = null;
  let callback = null;
  let failsafe = null;
  const down = (vk) => (api.GetAsyncKeyState(vk) & 0x8000) !== 0;

  function proc(nCode, wParam, lParam) {
    try {
      if (nCode === HC_ACTION) {
        const k = koffi.decode(lParam, types.KBDLLHOOKSTRUCT);
        const alt = (k.flags & LLKHF_ALTDOWN) !== 0;
        if (shouldBlock({ vk: k.vkCode, alt, ctrl: down(VK.CONTROL), shift: down(VK.SHIFT) })) return 1;
      }
    } catch { /* never let an error break the keyboard */ }
    return api.CallNextHookEx(hook, nCode, wParam, lParam);
  }

  function stop() {
    clearTimeout(failsafe);
    failsafe = null;
    if (hook) api.UnhookWindowsHookEx(hook);
    hook = null;
    if (callback) koffi.unregister(callback);
    callback = null;
  }

  function start() {
    if (hook) return true;
    try {
      callback = koffi.register(proc, koffi.pointer(types.LowLevelKeyboardProc));
      hook = api.SetWindowsHookExW(WH_KEYBOARD_LL, callback, api.GetModuleHandleW(null), 0);
      if (!hook) throw new Error('SetWindowsHookExW failed');
      failsafe = setTimeout(stop, MAX_HOOK_MS);
      return true;
    } catch (err) {
      console.error('Could not block shortcuts:', err);
      stop();
      return false;
    }
  }

  return { start, stop, get active() { return !!hook; } };
}

module.exports = { createKeyBlocker, shouldBlock, defineTypes, PROTOTYPES, VK };
