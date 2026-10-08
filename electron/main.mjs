import { app, BrowserWindow, ipcMain, protocol, net, session, dialog, Menu, shell, powerMonitor, powerSaveBlocker, nativeTheme, Notification } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { Store } from '../backend/store.mjs';
import { RouteLibrary } from '../backend/library.mjs';
import { MAX_GPX_BYTES } from '../backend/gpx.mjs';
import { Controller } from '../backend/controller.mjs';
import { Geocoder } from '../backend/geocoder.mjs';
import { IosAdapter } from '../backend/ios.mjs';
import { AndroidAdapter } from '../backend/android.mjs';
import { run } from '../backend/process.mjs';
import { wifiStatus } from '../backend/network.mjs';

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devUrl = !app.isPackaged && process.env.WRAITH_DEV_URL === 'http://127.0.0.1:5173' ? process.env.WRAITH_DEV_URL : null;
if (!app.isPackaged) app.setPath('userData', process.env.WRAITH_TEST_DATA || path.join(rootPath, '.wraith-dev'));
app.setName('Wraith');
// Windows attributes notifications by app ID; the installer's shortcut uses the build appId.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'io.github.tootsalot.wraith' : process.execPath);
protocol.registerSchemesAsPrivileged([{ scheme: 'wraith', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let window, controller, poll, wakeLock, quitting = false, quitPending = false;
// Hold shown notifications so a click still reaches its handler after garbage collection.
const shownNotifications = new Set();
// Window chrome colours match the renderer's Spectral theme tokens.
const TITLEBAR_HEIGHT = 52;
const chrome = () => nativeTheme.shouldUseDarkColors
  ? { background: '#141126', color: '#1a1631', symbolColor: '#eeeaff' }
  : { background: '#f6f4fc', color: '#fdfcff', symbolColor: '#1d1838' };
// The renderer's prefers-color-scheme follows nativeTheme, so one setting drives both.
function syncTheme(preference) {
  const source = ['dark', 'light'].includes(preference) ? preference : 'system';
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
}
// Windows draws its caption buttons over the page only with titleBarStyle 'hidden';
// 'hiddenInset' is macOS-only and left Windows with a native title bar and no overlay.
const windowChrome = () => process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
  : process.platform === 'win32'
    ? { titleBarStyle: 'hidden', titleBarOverlay: { color: chrome().color, symbolColor: chrome().symbolColor, height: TITLEBAR_HEIGHT } }
    : {};
nativeTheme.on('updated', () => {
  if (!window || window.isDestroyed()) return;
  const colors = chrome();
  window.setBackgroundColor(colors.background);
  // A theme change must never crash the main process, even if the overlay is unavailable.
  if (process.platform === 'win32') {
    try { window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TITLEBAR_HEIGHT }); } catch {}
  }
});
const geocoder = new Geocoder();
const allowedExternal = new Set(['github.com', 'developer.android.com', 'developer.apple.com', 'support.apple.com', 'www.openstreetmap.org', 'openstreetmap.org', 'photon.komoot.io', 'doronz88.github.io']);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(boot).catch(error => { dialog.showErrorBox('Wraith could not start', error.message); app.exit(1); });
}

async function boot() {
  const dist = path.join(rootPath, 'dist');
  protocol.handle('wraith', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(`${dist}${path.sep}`)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });
  const csp = `default-src 'self'; script-src 'self'${devUrl ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'${devUrl ? ' ws://127.0.0.1:5173' : ''}; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const options = { rootPath, resourcesPath: app.isPackaged ? process.resourcesPath : path.join(rootPath, 'resources') };
  const callbacks = { onSessionEnd: event => controller?.sessionEnded(event), onLocationRefresh: event => controller?.locationRefreshed(event) };
  const ios = new IosAdapter({ ...options, ...callbacks });
  const android = new AndroidAdapter({ ...options, ...callbacks });
  controller = new Controller({ adapters: { ios, android }, network: wifiStatus, store: new Store(path.join(app.getPath('userData'), 'settings.json')), library: new RouteLibrary(path.join(app.getPath('userData'), 'routes.json')) });
  controller.on('state', state => {
    const active = state.session && ['active', 'applying', 'reconnecting'].includes(state.session.status);
    if (active && wakeLock == null) wakeLock = powerSaveBlocker.start('prevent-app-suspension');
    if (!active && wakeLock != null) { powerSaveBlocker.stop(wakeLock); wakeLock = null; }
    syncTheme(state.preferences.theme);
    if (window && !window.isDestroyed()) window.webContents.send('wraith:state', state);
  });
  controller.on('alert', ({ type, title, body }) => {
    const settings = controller.state.preferences.notifications || {};
    if (settings.enabled === false || settings[type] === false || !Notification.isSupported()) return;
    // While Wraith is in front, its own status bar already shows the change.
    if (window && !window.isDestroyed() && window.isFocused() && !window.isMinimized()) return;
    const notification = new Notification({ title, body });
    shownNotifications.add(notification);
    const release = () => shownNotifications.delete(notification);
    notification.on('click', () => {
      release();
      if (!window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    });
    notification.on('close', release);
    notification.show();
  });
  // Read settings before the window exists, so its first frame and first state
  // use real preferences (placeholder preferences used to reopen first-run setup).
  await controller.load();
  syncTheme(controller.state.preferences.theme);

  const handlers = {
    getState: () => controller.snapshot(),
    switchToWifi: id => controller.switchToWifi(id),
    setConnection: value => controller.setConnection(value),
    connectWifi: value => controller.connectWifi(value),
    scanDevices: () => controller.scanDevices(),
    prepareDevice: id => controller.prepareDevice(id),
    applyLocation: value => controller.applyLocation(value),
    stopLocation: () => controller.stopLocation(),
    getRoute: () => controller.getRoute(),
    planRoute: value => controller.planRoute(value),
    startRoute: value => controller.startRoute(value),
    pauseRoute: () => controller.pauseRoute(),
    resumeRoute: () => controller.resumeRoute(),
    startWander: value => controller.startWander(value),
    updateRouteOptions: value => controller.updateRouteOptions(value),
    saveRoute: value => controller.saveRoute(value),
    loadSavedRoute: id => controller.loadSavedRoute(id),
    renameSavedRoute: value => controller.renameSavedRoute(value),
    deleteSavedRoute: id => controller.deleteSavedRoute(id),
    importGpx: async value => {
      const result = await dialog.showOpenDialog(window, { title: 'Import GPX route', filters: [{ name: 'GPX routes and tracks', extensions: ['gpx'] }], properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      if ((await stat(result.filePaths[0])).size > MAX_GPX_BYTES) throw new Error('GPX files must be smaller than 25 MB.');
      return controller.importGpx(await readFile(result.filePaths[0], 'utf8'), { mode: value?.mode });
    },
    exportGpx: async () => {
      const { name, gpx } = controller.exportGpx();
      const fileName = `${name.replace(/[<>:"/\|?*\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Wraith route'}.gpx`;
      const result = await dialog.showSaveDialog(window, { title: 'Export GPX route', defaultPath: fileName, filters: [{ name: 'GPX', extensions: ['gpx'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await writeFile(result.filePath, gpx, 'utf8');
      return { saved: true, fileName: path.basename(result.filePath) };
    },
    searchPlaces: query => { geocoder.configure(controller.state.preferences.geocoderUrl || 'https://photon.komoot.io/api/'); return geocoder.search(query); },
    savePlace: value => controller.savePlace(value),
    deletePlace: id => controller.deletePlace(id),
    updatePreferences: value => controller.updatePreferences(value),
    installRuntime: () => controller.exclusive(async () => {
      if (controller.state.session) throw new Error('Restore the current phone session first.');
      if (app.isPackaged) throw new Error('The desktop release includes its device tools. If they are missing, reinstall a complete Wraith build.');
      const result = await run(process.execPath, [path.join(rootPath, 'scripts/prepare-runtime.mjs')], {
        cwd: rootPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 900000, maxOutputBytes: 8_000_000
      });
      if (result.code !== 0) throw new Error(`Could not prepare device tools. Run npm run runtime:prepare in the project terminal. ${result.stderr.slice(-500)}`);
      return controller.scan();
    })
  };
  for (const [method, handler] of Object.entries(handlers)) ipcMain.handle(`wraith:${method}`, async (event, value) => {
    const senderUrl = event.senderFrame?.url || '';
    const trusted = window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame &&
      (devUrl ? new URL(senderUrl).origin === devUrl : senderUrl.startsWith('wraith://app/'));
    if (!trusted) return { ok: false, error: 'Untrusted request.' };
    try { return { ok: true, data: await handler(value) }; }
    catch (error) { return { ok: false, error: error.message || 'Operation failed.' }; }
  });

  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 680, backgroundColor: chrome().background, show: false,
    title: 'Wraith', ...windowChrome(),
    webPreferences: { preload: path.join(rootPath, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} Wraith/${app.getVersion()}`);
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { const parsed = new URL(url); if (parsed.protocol === 'https:' && allowedExternal.has(parsed.hostname)) shell.openExternal(parsed.href); } catch {}
    return { action: 'deny' };
  });
  window.webContents.on('render-process-gone', () => {
    if (controller.state.session) controller.sessionEnded({ deviceId: controller.state.session.deviceId, retry: false, error: 'The interface stopped unexpectedly. Reopen Wraith and retry or restore the phone location.' });
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => { if (!quitting) { event.preventDefault(); app.quit(); } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Wraith', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
  // Device discovery must not hold the window hostage.
  if (devUrl) await window.loadURL(devUrl);
  else if (existsSync(path.join(dist, 'index.html'))) await window.loadURL('wraith://app/index.html');
  else throw new Error('Build the interface first with npm run build.');
  await controller.init();
  poll = setInterval(() => controller.scanDevices().catch(error => { controller.state.warning = error.message; controller.notify(); }), 2000);
  powerMonitor.on('suspend', () => controller.suspend().catch(() => {}));
  powerMonitor.on('resume', () => controller.resume().catch(() => {}));
}

app.on('before-quit', event => {
  if (quitting || !controller) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  finishQuit().finally(() => { quitPending = false; });
});

async function finishQuit() {
  if (controller.state.busy) {
    await dialog.showMessageBox(window, { type: 'info', message: 'A device operation is still running.', detail: 'Wait for it to finish before closing Wraith.', buttons: ['Keep Wraith open'] });
    return;
  }
  if (controller.state.session && controller.state.preferences.restoreOnQuit) {
    try { await controller.stopLocation(); }
    catch (error) {
      const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'The phone location has not been restored.', detail: `${error.message}\n\nReconnect your phone to restore it. Quitting now will keep this session marked for recovery.`, buttons: ['Keep Wraith open', 'Quit anyway'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return;
    }
  }
  if (controller.state.session) await controller.sessionEnded({ deviceId: controller.state.session.deviceId, retry: false, error: 'Wraith quit without confirming restoration. Reconnect this phone and choose Retry location or Restore.' });
  clearInterval(poll);
  if (wakeLock != null) { powerSaveBlocker.stop(wakeLock); wakeLock = null; }
  await Promise.race([controller.dispose({ restore: false }), new Promise(resolve => setTimeout(resolve, 6000))]);
  quitting = true; app.quit();
}
