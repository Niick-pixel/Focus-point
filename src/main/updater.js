// Auto-updates from GitHub Releases (electron-updater).
//
// The Windows build workflow attaches the installer plus latest.yml to each release;
// electron-updater reads latest.yml, downloads the new installer in the background and
// installs it when the app quits (or right away, if the user clicks "Restart to update").
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 30 * 1000;

/**
 * @param {{ app: Electron.App, getSettings: () => object, onChange: (state: object) => void }} deps
 */
function createUpdater({ app, getSettings, onChange }) {
  let state = { status: app.isPackaged ? 'idle' : 'dev', version: null, progress: 0, error: null };
  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  if (!app.isPackaged) {
    // Running from source: there's nothing to update.
    return { state: () => state, check() {}, install() {}, start() {} };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err?.message || err).split('\n')[0] }));

  const check = () => {
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => { /* reported through the 'error' event */ });
  };

  let timer = null;
  const start = () => {
    setTimeout(() => getSettings().autoUpdate && check(), FIRST_CHECK_MS);
    timer = setInterval(() => getSettings().autoUpdate && check(), CHECK_EVERY_MS);
  };

  return {
    state: () => state,
    check,
    start,
    /** Quit and run the downloaded installer silently, then relaunch. */
    install() {
      if (state.status !== 'ready') return;
      clearInterval(timer);
      autoUpdater.quitAndInstall(true, true);
    },
  };
}

module.exports = { createUpdater };
