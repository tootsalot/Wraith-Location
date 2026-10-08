import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource-variable/geologica';
import './style.css';
import {
  createIcons, MapPin, Bookmark, Settings2, HelpCircle, ArrowUpRight, ArrowRight,
  Search, Plus, Minus, Crosshair, Smartphone, RefreshCw, ChevronDown, X, Check,
  Circle, Download, Pencil, Trash2, RotateCcw, LoaderCircle, Cable, Laptop, Monitor,
  ChevronLeft, Car, Bike, Footprints, GripVertical, Upload, Navigation, Pause, Play, Library, Wifi,
} from 'lucide';
import { createPreviewBridge } from './preview.js';
import { measurePath } from '../backend/geo.mjs';
import { MODES, clampSpeedMph, estimateSeconds } from '../backend/motion.mjs';
import { version } from '../package.json';

const isPreview = !window.wraith;
// The desktop app reports its real platform; the browser preview falls back to the user agent.
const detectedHost = { darwin: 'mac', win32: 'windows', linux: 'linux' }[window.wraith?.platform]
  || (/Windows/i.test(navigator.userAgent) ? 'windows' : /Macintosh|Mac OS X/i.test(navigator.userAgent) ? 'mac' : /Linux|X11/i.test(navigator.userAgent) ? 'linux' : 'mac');
const hostName = { mac: 'Mac', windows: 'Windows PC', linux: 'Linux computer' }[detectedHost];
document.documentElement.classList.toggle('host-windows', detectedHost === 'windows');
document.documentElement.classList.toggle('host-linux', detectedHost === 'linux');
// Only macOS draws window buttons inside the title bar area.
document.documentElement.classList.toggle('host-mac', detectedHost === 'mac');
document.documentElement.classList.toggle('desktop-app', !isPreview);
const api = window.wraith || createPreviewBridge();
const dismissedWifi = new Set();
const icons = { MapPin, Bookmark, Settings2, HelpCircle, ArrowUpRight, ArrowRight, Search, Plus, Minus, Crosshair, Smartphone, RefreshCw, ChevronDown, X, Check, Circle, Download, Pencil, Trash2, RotateCcw, LoaderCircle, Cable, Laptop, Monitor, ChevronLeft, Car, Bike, Footprints, GripVertical, Upload, Navigation, Pause, Play, Library, Wifi };
const modeIcons = { drive: 'car', bike: 'bike', walk: 'footprints' };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;
// Lucide scans the whole document, so only repaint when new placeholders were rendered.
let iconsDirty = true;
const paintIcons = (force = false) => {
  if (!force && !iconsDirty) return;
  iconsDirty = false;
  createIcons({ icons, attrs: { 'stroke-width': 1.8 } });
  document.querySelectorAll('svg[data-lucide]').forEach((element) => element.removeAttribute('data-lucide'));
};
const renderedContent = new WeakMap();
function setContent(selector, html) {
  const element = $(selector);
  if (renderedContent.get(element) === html) return false;
  element.innerHTML = html;
  renderedContent.set(element, html);
  if (html.includes('data-lucide')) iconsDirty = true;
  return true;
}
const formatCoordinate = (value, latitude = true) => `${Math.abs(value).toFixed(5)}° ${latitude ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E')}`;
const brandMark = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M300 768V500C300 368 392 258 512 184c120 74 212 184 212 316v268l-60-50-50 74-52-68-50 80-50-80-52 68-50-74z" fill="none" stroke="currentColor" stroke-width="64" stroke-linejoin="round"/><path d="M432 486c18-16 46-16 64 0-18 16-46 16-64 0zm96 0c18-16 46-16 64 0-18 16-46 16-64 0z" fill="currentColor"/></svg>';

const setupGuides = {
  'mac:ios': {
    title: 'Mac and iPhone',
    intro: 'One cable, one trust prompt, and Developer Mode.',
    steps: [
      ['Connect and trust', 'Unlock your iPhone, connect it to your Mac with a USB data cable, then tap Trust on the iPhone if prompted.'],
      ['Turn on Developer Mode', 'On iPhone, open Settings → Privacy & Security → Developer Mode. Turn it on, restart, then confirm with your passcode.'],
      ['Prepare the device tools', 'Keep the Mac online for the first setup. In Wraith, select the iPhone and choose Prepare so Wraith can mount the matching developer support image.'],
      ['Keep the cable connected', 'Leave the iPhone connected while a location is active. Use Restore real location before unplugging when possible.'],
    ],
  },
  'windows:ios': {
    title: 'Windows and iPhone',
    intro: 'Install Apple’s USB support, then trust and prepare the iPhone.',
    steps: [
      ['Install Apple Devices', 'Install or update the Apple Devices app from the Microsoft Store. Open it once so Windows can load Apple’s USB services.'],
      ['Connect and trust', 'Unlock your iPhone, connect it with a USB data cable, select it in Apple Devices, then confirm Trust on both the PC and iPhone if prompted.'],
      ['Turn on Developer Mode', 'On iPhone, open Settings → Privacy & Security → Developer Mode. Turn it on, restart, then confirm with your passcode.'],
      ['Prepare in Wraith', 'Return to Wraith, select the iPhone, and choose Prepare. Keep the PC online during the first preparation.'],
    ],
  },
  'mac:android': {
    title: 'Mac and Android',
    intro: 'Enable Android’s developer settings and authorize this Mac.',
    steps: [
      ['Unlock Developer options', 'On Android, open Settings → About phone and tap Build number seven times. Enter your screen lock if asked.'],
      ['Enable USB debugging', 'Open Settings → System → Developer options and turn on USB debugging. Menu names can vary by phone maker.'],
      ['Connect and authorize', 'Use a USB data cable, keep the phone unlocked, and accept the Allow USB debugging prompt for this Mac. No Mac USB driver is normally needed.'],
      ['Prepare the location helper', 'In Wraith, select the phone and choose Prepare. If Android asks for a mock location app, choose Appium Settings.'],
    ],
  },
  'windows:android': {
    title: 'Windows and Android',
    intro: 'Set up the USB driver, then enable and authorize debugging.',
    steps: [
      ['Check the USB driver', 'Connect with a USB data cable. If Windows does not detect the phone, install the ADB USB driver from your phone manufacturer.'],
      ['Unlock Developer options', 'On Android, open Settings → About phone and tap Build number seven times. Enter your screen lock if asked.'],
      ['Enable and authorize debugging', 'Turn on USB debugging in Developer options, reconnect the cable, and accept the computer’s RSA authorization prompt.'],
      ['Prepare the location helper', 'In Wraith, select the phone and choose Prepare. If Android asks for a mock location app, choose Appium Settings.'],
    ],
  },
  'linux:ios': {
    title: 'Linux and iPhone',
    intro: 'Install Apple’s USB service, then trust and prepare the iPhone.',
    steps: [
      ['Install usbmuxd', 'Wraith reaches the iPhone through usbmuxd. On Ubuntu or Debian run sudo apt install usbmuxd; other distributions use the same package name.'],
      ['Connect and trust', 'Unlock your iPhone, connect it with a USB data cable, then tap Trust on the iPhone if prompted.'],
      ['Turn on Developer Mode', 'On iPhone, open Settings → Privacy & Security → Developer Mode. Turn it on, restart, then confirm with your passcode.'],
      ['Prepare in Wraith', 'Select the iPhone and choose Prepare. Keep the computer online during the first preparation. No administrator password is needed.'],
    ],
  },
  'linux:android': {
    title: 'Linux and Android',
    intro: 'Allow USB access, then enable and authorize debugging.',
    steps: [
      ['Allow USB access', 'On Ubuntu or Debian run sudo apt install android-sdk-platform-tools-common to add Android’s USB rules, then reconnect the phone.'],
      ['Unlock Developer options', 'On Android, open Settings → About phone and tap Build number seven times. Enter your screen lock if asked.'],
      ['Enable and authorize debugging', 'Turn on USB debugging in Developer options, keep the phone unlocked, and accept the Allow USB debugging prompt for this computer.'],
      ['Prepare the location helper', 'In Wraith, select the phone and choose Prepare. If Android asks for a mock location app, choose Appium Settings.'],
    ],
  },
};

let state = { devices: [], savedPlaces: [], recentPlaces: [], runtime: {}, session: null, preferences: {}, busy: false };
let selectedDeviceId = null;
let selectedPlace = null;
let currentView = 'map';
let libraryTab = 'places';
let locationMode = 'fixed';
let routeStops = [], routePlan = null;
let routeLine = null, routeCasing = null, routeDot = null;
const routeMarkers = [];
let routeMode = 'drive', realisticMotion = true, routeSpeeds = { drive: 70, bike: 14, walk: 3.2 };
let wanderRadius = 300, wanderCircle = null;
let preferencesApplied = false, lastRouteId = null, lastLocked = false, draggedStop = null;
let planPath = null, estimateCache = null, tickCache = null;
let autoOnboarding = false;
let routeBeingNamed = null;
let setupPlatform = 'ios';
let surveyPhone = null;
let onboardingStep = 'survey';
let onboardingShown = false;
const onboardingChecks = new Set();
let pending = false;
let pendingAction = null;
let searchNumber = 0;
let toastTimer;
let lastWarning = null;

$('#app').innerHTML = `
  <header class="titlebar">
    <div class="window-inset" aria-hidden="true"></div>
    <a class="wordmark" href="#" aria-label="Wraith map"><span class="rail-emblem">${brandMark}</span><span>Wraith</span></a>
    <div class="search-wrapper">
      <form id="search-form" role="search" class="search-box">${icon('search')}<input id="search-input" placeholder="Search places or coordinates" autocomplete="off" aria-label="Search places or coordinates" /><kbd id="search-key">${detectedHost === 'mac' ? '⌘K' : 'Ctrl K'}</kbd><button id="search-submit" type="submit" aria-label="Search">${icon('arrow-right')}</button></form>
      <div id="search-results" class="search-results" hidden></div>
    </div>
    <div class="titlebar-right">
      <span class="preview-label" ${isPreview ? '' : 'hidden'}>Preview</span>
      <button id="phone-chip" class="phone-chip" aria-haspopup="dialog" aria-expanded="false" aria-controls="phone-popover"><span class="status-dot"></span><span class="phone-chip-text"><span id="phone-chip-name">No phone</span><small id="phone-chip-detail">Connect a phone</small></span>${icon('chevron-down')}</button>
      <button id="help-button" class="toolbar-icon" aria-label="Device setup" title="Device setup">${icon('help-circle')}</button>
      <button id="settings-button" class="toolbar-icon" aria-label="Settings" title="Settings">${icon('settings-2')}</button>
    </div>
  </header>

  <section id="phone-popover" class="phone-popover" aria-labelledby="device-label" hidden>
    <div class="section-heading"><h2 id="device-label">Phone</h2><button id="scan-button" class="icon-button" aria-label="Refresh connected phones" title="Refresh connected phones">${icon('refresh-cw')}</button></div>
    <div id="device-area"></div>
    <button id="connection-options" class="setup-link">Connection: USB. Change</button>
  </section>

  <div class="workspace">
    <aside class="control-panel">
      <div class="panel-scroll">
        <div id="wifi-prompt" class="wifi-prompt" hidden><strong>Switch to Wi-Fi?</strong><p>Your phone is working over USB and this computer has Wi-Fi. Keep both on the same network and leave the cable connected until Wraith confirms.</p><p id="wifi-prompt-android" hidden>This enables network debugging on Android. Use a trusted network; restart the phone to turn it off.</p><div><button id="wifi-prompt-switch" class="secondary-button compact">Switch to Wi-Fi</button><button id="wifi-prompt-dismiss" class="text-button">Stay on USB</button></div></div>
        <div class="location-modes" role="group" aria-label="Location type"><button data-location-mode="fixed" aria-pressed="true">Place</button><button data-location-mode="route" aria-pressed="false">Route</button><button data-location-mode="wander" aria-pressed="false">Wander</button></div>

        <section id="place-section" class="panel-section" aria-labelledby="destination-label">
          <div class="section-heading"><h2 id="destination-label">Location</h2><button id="save-button" class="icon-button" aria-label="Save selected place" title="Save place" disabled>${icon('bookmark')}</button></div>
          <div id="destination-summary"></div>
          <div id="place-pin-slot"><form id="coordinate-form" class="coordinate-form"><label><span>Latitude</span><input id="latitude" type="number" min="-90" max="90" step="any" placeholder="41.88270" required aria-label="Latitude" /></label><label><span>Longitude</span><input id="longitude" type="number" min="-180" max="180" step="any" placeholder="−87.62330" required aria-label="Longitude" /></label><button type="submit" class="coordinate-submit" aria-label="Select these coordinates" title="Select these coordinates">${icon('arrow-right')}</button></form></div>
          <p class="coordinate-hint">Search, type coordinates, or click the map.</p>
          <div id="fixed-actions"><button id="apply-button" class="primary-button" disabled><span>Set location</span>${icon('arrow-up-right')}</button><p id="apply-hint" class="action-hint">Connect a phone to get started.</p></div>
          <div id="recent-section" class="recent-section" hidden><h2>Recent</h2><div id="recent-list"></div></div>
        </section>

        <section id="route-controls" class="panel-section" hidden>
          <div class="travel-modes" role="group" aria-label="Travel mode">${Object.entries(MODES).map(([mode, spec]) => `<button data-travel-mode="${mode}" aria-pressed="false">${icon(modeIcons[mode])}<span>${spec.label}</span></button>`).join('')}</div>
          <div class="section-heading"><h2>Stops</h2><button id="clear-route" class="text-button">Clear</button></div>
          <ol id="route-stops" class="route-stops"></ol>
          <p class="route-tip">Click the map to add a stop, or search or type coordinates and add the pin. Drag stops to reorder or move them.</p>
          <div id="route-pin-slot"></div>
          <button id="add-route-stop" class="secondary-button">${icon('plus')} Add selected pin</button>
          <div id="route-summary" class="route-summary" hidden></div>
          <div class="route-plan-actions"><button id="plan-route" class="secondary-button">Plan route</button></div>
          <p class="route-provider">Planning sends your stops to the public Valhalla service (FOSSGIS), or OSRM if it is unavailable. Roads by OpenStreetMap.</p>
          <div class="motion-settings">
            <label class="setting-row"><span><strong>Realistic motion</strong><small>Speed limits, corners, traffic lights and GPS drift.</small></span><input id="realistic-toggle" type="checkbox" class="switch" /></label>
            <div class="speed-row"><label for="speed-slider" id="speed-label">Top speed</label><output id="speed-value" for="speed-slider"></output></div>
            <input id="speed-slider" class="speed-slider" type="range" />
            <p id="speed-note" class="settings-note"></p>
          </div>
          <button id="route-play" class="primary-button" disabled>Start route</button>
          <p id="route-hint" class="action-hint">Add a start and destination, in order.</p>
        </section>

        <section id="wander-section" class="panel-section" aria-labelledby="wander-label" hidden>
          <div class="section-heading"><h2 id="wander-label">Area</h2></div>
          <div id="wander-center"></div>
          <div id="wander-pin-slot"></div>
          <p class="route-tip">Click the map, search or type coordinates to set the centre. Wraith walks real footpaths between random spots inside the circle and lingers a little at each.</p>
          <div class="wander-settings">
            <div class="speed-row"><label for="wander-radius">Radius</label><output id="wander-radius-value" for="wander-radius"></output></div>
            <input id="wander-radius" class="speed-slider" type="range" min="50" max="2000" step="25" value="300" />
            <div class="speed-row"><label for="wander-speed">Walking pace</label><output id="wander-speed-value" for="wander-speed"></output></div>
            <input id="wander-speed" class="speed-slider" type="range" min="1" max="8" step="0.1" />
          </div>
          <button id="wander-start" class="primary-button" disabled>Start wandering</button>
          <p id="wander-hint" class="action-hint">Choose a centre on the map.</p>
          <p class="route-provider">Each walk asks the public routing service for a footpath. Without internet, Wraith walks in straight lines inside the circle.</p>
        </section>

        <section id="library-view" class="library-view" aria-labelledby="library-title">
          <div class="library-head"><button id="library-back" class="icon-button" aria-label="Back to map controls">${icon('chevron-left')}</button><h2 id="library-title">Library</h2></div>
          <div class="location-modes" role="tablist" aria-label="Library"><button role="tab" data-library-tab="places" aria-selected="true">Places <span id="saved-count" class="count">0</span></button><button role="tab" data-library-tab="routes" aria-selected="false">Routes <span id="saved-routes-count" class="count">0</span></button></div>
          <div id="library-places" role="tabpanel"><div id="saved-list"></div></div>
          <div id="library-routes" role="tabpanel" hidden>
            <div class="library-actions"><button id="save-route" class="secondary-button compact">${icon('bookmark')} Save current</button><button id="import-gpx" class="secondary-button compact">${icon('upload')} Import GPX</button><button id="export-gpx" class="icon-button" aria-label="Export GPX" title="Export GPX">${icon('download')}</button></div>
            <div id="saved-routes"></div>
          </div>
        </section>
      </div>
      <div class="panel-foot"><button id="saved-nav-button" class="library-button" aria-pressed="false">${icon('library')}<span>Library</span><span class="count" id="saved-dot">0</span></button></div>
    </aside>

    <main class="map-workspace" aria-label="Location map">
      <div id="map" aria-label="Interactive map. Click to select a location. You can also use the coordinate fields." tabindex="0"></div>
      <div id="map-error" class="map-error" hidden>${icon('help-circle')}<span>Map tiles could not load. Coordinates still work.</span><button id="retry-map" class="text-button">Retry</button></div>
      <div class="map-controls"><button id="recenter-button" class="map-button" aria-label="Center map" title="Center map">${icon('crosshair')}</button><div class="zoom-buttons"><button id="zoom-in" class="map-button" aria-label="Zoom in" title="Zoom in">${icon('plus')}</button><button id="zoom-out" class="map-button" aria-label="Zoom out" title="Zoom out">${icon('minus')}</button></div></div>
      <div id="session-dock" class="session-dock" hidden>
        <button id="dock-play" class="dock-play" hidden aria-label="Pause route">${icon('pause')}</button>
        <div id="route-telemetry" class="route-telemetry" hidden>
          <div class="speedo"><div><span id="speed-now" class="speed-now">0</span><span class="speed-unit">mph</span></div><span id="speed-limit" class="speed-limit" hidden></span></div>
          <div class="timeline"><div class="timeline-meta"><span id="timeline-start"></span><strong id="timeline-state"></strong><span id="timeline-end"></span></div><div class="timeline-track"><div id="timeline-fill" class="timeline-fill"></div><div id="timeline-ticks"></div><div id="timeline-head" class="timeline-head"></div></div></div>
          <div class="eta"><strong id="eta-time"></strong><span id="eta-distance"></span></div>
        </div>
        <div id="session-status" class="session-status" role="status"></div>
        <div class="dock-actions"><button id="route-from-here" class="secondary-button compact" hidden>${icon('navigation')} New route from here</button><button id="restore-button" class="restore-button" disabled>${icon('rotate-ccw')} Restore real location</button></div>
      </div>
      <div class="map-footer"><span id="map-coordinates">41.88270° N, 87.62330° W</span></div>
    </main>
  </div>

  <dialog id="onboarding-dialog" class="onboarding-dialog" aria-labelledby="onboarding-title"><div class="onboarding-chrome"><span class="onboarding-brand">${brandMark} Wraith</span><span id="onboarding-progress">1 of 2</span></div><div id="onboarding-content"></div></dialog>

  <dialog id="setup-dialog" class="sheet-dialog" aria-labelledby="setup-title">
    <div class="sheet-heading"><div><span class="eyebrow">Device setup</span><h2 id="setup-title">Setup guide</h2></div><button class="icon-button" data-close="setup-dialog" aria-label="Close setup guide">${icon('x')}</button></div><p id="setup-intro" class="sheet-intro"></p><div id="setup-content"></div>
    <div class="setup-note">${icon('cable')}<span>Keep the cable connected while a location is active. Restore real location before unplugging when possible.</span></div><div class="dialog-actions"><button id="change-configuration" class="secondary-button">Change setup</button><button id="setup-scan" class="primary-button inline"><span>Check for my phone</span>${icon('refresh-cw')}</button></div><div id="setup-detection" class="setup-detection" role="status"></div>
  </dialog>

  <dialog id="wifi-dialog" class="sheet-dialog" aria-labelledby="wifi-title">
    <div class="sheet-heading"><div><span class="eyebrow">Phone connection</span><h2 id="wifi-title">Connect over Wi-Fi</h2></div><button class="icon-button" data-close="wifi-dialog" aria-label="Close connection settings">${icon('x')}</button></div>
    <p class="sheet-intro">Keep your phone and computer on the same Wi-Fi network. Leave the cable connected until Wraith confirms the switch.</p>
    <div class="location-modes" role="group" aria-label="Connection method"><button data-connection="usb">USB cable</button><button data-connection="wifi">Wi-Fi</button></div>
    <p id="wifi-status" class="settings-note" role="status"></p>
    <div id="wifi-handoff" class="settings-group" hidden><button id="switch-to-wifi" class="primary-button">Switch to Wi-Fi</button><p class="settings-note">Your current location carries over. A running route pauses during the switch and continues once connected.</p><p id="wifi-android-note" class="settings-note" hidden>This enables Android network debugging on port 5555. Use a trusted network; restart the phone to turn it off.</p></div>
    <details id="wifi-manual"><summary>Manual setup and troubleshooting</summary>
    <label class="field-label" for="wifi-phone">Your phone</label><select id="wifi-phone" class="text-input"><option value="ios">iPhone (iOS 17.4 or later)</option><option value="android">Android (Android 11 or later)</option></select>
    <div id="wifi-ios" class="settings-group">
      <h3>Pair once by cable</h3>
      <ol class="wifi-steps"><li>Choose USB cable above. Connect and unlock your iPhone, trust this computer and enable Developer Mode. On Windows, install Apple Devices first.</li><li>Select your iPhone in the Phone menu, then choose Switch to Wi-Fi above.</li><li>Choose Wi-Fi above. Wait for the phone to appear, then unplug the cable. You can now set a location or start a route.</li></ol>
      <button id="enable-iphone-wifi" class="secondary-button">Enable Wi-Fi for selected iPhone</button>
      <p class="settings-note">If discovery fails, enable “Show this iPhone when on Wi-Fi” in Finder on Mac, or “Show this device when on Wi-Fi” in Apple Devices on Windows, and apply. Unlock the phone and refresh.</p>
    </div>
    <div id="wifi-android" class="settings-group" hidden>
      <h3>Pair with Wireless debugging</h3>
      <p class="settings-note">Choose Wi-Fi above. On Android 11 or later, enable Developer options (tap Build number seven times), then open Wireless debugging → Pair device with pairing code. Keep this screen open. No USB cable is needed.</p>
      <form id="wifi-pair-form" class="wifi-form">
        <label class="field-label" for="wifi-pair-address">Pairing IP address and port</label><input id="wifi-pair-address" class="text-input" placeholder="192.168.1.20:37123" autocomplete="off" required />
        <label class="field-label" for="wifi-pair-code">Six-digit pairing code</label><input id="wifi-pair-code" class="text-input" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" required />
        <button id="wifi-pair-button" type="submit" class="secondary-button">Pair phone</button>
      </form>
      <form id="wifi-connect-form" class="wifi-form">
        <label class="field-label" for="wifi-connect-address">Connection IP address and port</label><input id="wifi-connect-address" class="text-input" placeholder="192.168.1.20:40567" autocomplete="off" required />
        <p class="settings-note">After pairing, go back to the main Wireless debugging screen and use its IP address and port here. This port is different from the pairing port and may change after reconnecting.</p>
        <button id="wifi-connect-button" type="submit" class="secondary-button">Connect paired phone</button>
      </form>
      <p class="settings-note">Once connected, close this panel and choose Prepare if needed. Keep Location on and select Appium Settings as the mock location app. Android 8–10 can switch from an authorized USB connection.</p>
    </div>
    </details>
    <p class="settings-note">Allow Wraith and its device tools through your computer’s local-network and firewall prompts. Guest Wi-Fi, client isolation and some VPNs can stop devices finding each other. Keep Wraith open, and restore real location before disconnecting.</p>
    <div class="dialog-actions"><button id="wifi-refresh" class="primary-button inline">Refresh phones</button></div>
  </dialog>

  <dialog id="settings-dialog" class="sheet-dialog" aria-labelledby="settings-title">
    <div class="sheet-heading"><div><span class="eyebrow">Wraith</span><h2 id="settings-title">Settings</h2></div><button class="icon-button" data-close="settings-dialog" aria-label="Close settings">${icon('x')}</button></div>
    <div class="settings-group"><h3>Appearance</h3><div class="location-modes" role="group" aria-label="Theme"><button data-theme-choice="system">Match system</button><button data-theme-choice="dark">Dark</button><button data-theme-choice="light">Light</button></div></div>
    <div class="settings-group"><h3>Device setup</h3><div class="configuration-row"><div><strong id="settings-configuration">No setup selected</strong><small>Wraith uses this to show the right connection steps.</small></div><button id="rerun-onboarding" class="secondary-button compact">Change</button></div></div>
    <div class="settings-group"><h3>Natural drift</h3><div class="location-modes" role="group" aria-label="Natural drift"><button data-drift-choice="off">Off</button><button data-drift-choice="subtle">Subtle</button><button data-drift-choice="normal">Normal</button></div><p class="settings-note">A held place moves a few metres, like real GPS on a phone that isn't moving: about 2–3 m when subtle, about 5 m when normal.</p></div>
    <div class="settings-group"><h3>Notifications</h3>
      <label class="setting-row"><span><strong>Desktop notifications</strong><small>Shown when Wraith isn't the active window.</small></span><input type="checkbox" class="switch" data-notify="enabled" /></label>
      <div class="notify-events">
        <label class="setting-row"><span><strong>Route arrived</strong></span><input type="checkbox" class="switch" data-notify="arrived" /></label>
        <label class="setting-row"><span><strong>Phone needs attention</strong><small>Disconnected, or the location couldn't be confirmed.</small></span><input type="checkbox" class="switch" data-notify="attention" /></label>
        <label class="setting-row"><span><strong>Route paused itself</strong><small>Updates fell behind or the connection was slow.</small></span><input type="checkbox" class="switch" data-notify="autoPaused" /></label>
        <label class="setting-row"><span><strong>Phone reconnected</strong></span><input type="checkbox" class="switch" data-notify="reconnected" /></label>
      </div>
    </div>
    <div class="settings-group"><h3>Location sessions</h3><label class="setting-row"><span><strong>Restore on quit</strong><small>Wraith tries to stop location simulation before it closes. Keep the phone connected.</small></span><input id="restore-preference" type="checkbox" class="switch" /></label></div>
    <div class="settings-group"><h3>Device tools</h3><div id="runtime-status"></div><button id="install-runtime" class="secondary-button">${icon('download')} Prepare device tools</button><p class="settings-note">First-time preparation may need an internet connection.</p></div>
    <form id="provider-form" class="settings-group"><h3>Place search</h3><label class="field-label" for="provider-url">Photon-compatible endpoint</label><input id="provider-url" class="text-input" type="url" required placeholder="https://photon.komoot.io/api/" /><p class="settings-note">Search runs only when you submit. Map tiles come from OpenStreetMap.</p><div class="button-row"><button type="submit" class="secondary-button compact">Save endpoint</button><button id="reset-provider" type="button" class="text-button">Reset</button></div></form><div class="settings-footer">Wraith ${version}. Free and open source under GPL-3.0.</div>
  </dialog>

  <dialog id="save-dialog" class="small-dialog" aria-labelledby="save-title"><div class="sheet-heading"><div><span class="eyebrow">Saved place</span><h2 id="save-title">Save this place</h2></div><button class="icon-button" data-close="save-dialog" aria-label="Close save place">${icon('x')}</button></div><form id="save-form"><label class="field-label" for="place-name">Name</label><input id="place-name" class="text-input" maxlength="120" required placeholder="Place name" /><input id="place-id" type="hidden" /><p id="save-coordinates" class="settings-note"></p><button class="primary-button" type="submit"><span>Save place</span>${icon('bookmark')}</button></form></dialog>
  <dialog id="route-name-dialog" class="small-dialog" aria-labelledby="route-name-title"><div class="sheet-heading"><div><span class="eyebrow">Saved route</span><h2 id="route-name-title">Save this route</h2></div><button class="icon-button" data-close="route-name-dialog" aria-label="Close save route">${icon('x')}</button></div><form id="route-name-form"><label class="field-label" for="route-name">Name</label><input id="route-name" class="text-input" maxlength="120" required placeholder="Route name" /><p class="settings-note">Saved routes keep the full path, so they replay without planning again.</p><button class="primary-button" type="submit"><span id="route-name-submit">Save route</span>${icon('bookmark')}</button></form></dialog>
  <div id="toast" class="toast" role="status" hidden><span id="toast-icon"></span><span id="toast-message"></span><button id="toast-close" class="icon-button" aria-label="Dismiss notification">${icon('x')}</button></div>
`;

const map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 2, maxZoom: 19, worldCopyJump: true }).setView([41.8827, -87.6233], 13);
map.attributionControl.setPrefix(false);
const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors', keepBuffer: 1, updateWhenIdle: true }).addTo(map);
let tileErrors = 0;
tiles.on('tileerror', () => { if (++tileErrors >= 3) $('#map-error').hidden = false; });
tiles.on('tileload', () => { tileErrors = 0; $('#map-error').hidden = true; });
const pinIcon = L.divIcon({ className: 'place-pin', html: '<span class="place-pin-halo"></span><span class="place-pin-head"></span>', iconSize: [40, 48], iconAnchor: [20, 44] });
let marker = null;

function guideFor(host = detectedHost, phone = setupPlatform) { return setupGuides[`${host}:${phone}`]; }
function platformName(platform) { return platform === 'ios' ? 'iPhone' : 'Android'; }

// Explicit Dark/Light overrides the system; the main process mirrors the choice for window chrome.
const systemDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const choice = ['dark', 'light'].includes(state.preferences.theme) ? state.preferences.theme : null;
  if (choice) document.documentElement.dataset.theme = choice; else delete document.documentElement.dataset.theme;
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (choice || 'system'))));
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast-message').textContent = message;
  $('#toast-icon').innerHTML = icon(error ? 'help-circle' : 'check');
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  paintIcons(true);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 12000 : 4500);
}

function acceptState(next) {
  if (!next?.devices) return;
  state = { ...state, ...next };
  if (!preferencesApplied && state.loaded !== false) {
    preferencesApplied = true;
    if (MODES[state.preferences.routeMode]) routeMode = state.preferences.routeMode;
    if (typeof state.preferences.realisticMotion === 'boolean') realisticMotion = state.preferences.realisticMotion;
    routeSpeeds = { ...routeSpeeds, ...state.preferences.routeSpeeds };
  }
  applyTheme();
  // Jump to Route mode once when a route starts, without trapping the user there after arrival.
  const routeId = state.route?.id || null;
  if (routeId && routeId !== lastRouteId) {
    locationMode = state.route.kind === 'wander' ? 'wander' : 'route';
    if (MODES[state.route.mode]) routeMode = state.route.mode;
    if (typeof state.route.realistic === 'boolean') realisticMotion = state.route.realistic;
    if (Number.isFinite(state.route.topSpeedMph)) routeSpeeds[routeMode] = state.route.topSpeedMph;
  }
  lastRouteId = routeId;
  // Stop markers become draggable again when a route arrives or is restored.
  if (routeLocked() !== lastLocked) { lastLocked = routeLocked(); drawRoute(); }
  if (!state.devices.some((device) => device.id === selectedDeviceId)) selectedDeviceId = state.devices.find((device) => device.id === state.session?.deviceId)?.id || state.devices[0]?.id || state.session?.deviceId || null;
  setupPlatform = state.preferences.phonePlatform || state.devices.find((device) => device.id === selectedDeviceId)?.platform || setupPlatform;
  render();
  // Restore the preview pin for a fixed session; a route's moving point is not a place to keep.
  if (!selectedPlace && state.session && !state.route && Number.isFinite(state.session.latitude) && Number.isFinite(state.session.longitude)) selectPlace(state.session);
  if (state.warning && state.warning !== lastWarning) { lastWarning = state.warning; notify(state.warning, true); }
  // Only real, loaded preferences decide first-run setup.
  if (!onboardingShown && state.loaded !== false && state.preferences.onboardingComplete !== true) {
    onboardingShown = true; autoOnboarding = true;
    requestAnimationFrame(() => openOnboarding());
  }
  if (autoOnboarding && state.preferences.onboardingComplete === true && $('#onboarding-dialog').open) { autoOnboarding = false; $('#onboarding-dialog').close(); }
}

async function runOperation(action, message, operation = null) {
  if (pending) return null;
  pending = true;
  pendingAction = operation;
  render();
  try {
    const result = await action();
    acceptState(result);
    if (result?.devices) acceptState(await api.getState());
    if (message) notify(message);
    return result;
  } catch (error) {
    notify(error.message || 'Something went wrong. Please try again.', true);
    return null;
  } finally {
    pending = false;
    pendingAction = null;
    render();
  }
}

function selectPlace(place, fly = true) {
  selectedPlace = { latitude: Number(place.latitude), longitude: Number(place.longitude), label: place.label || 'Dropped pin' };
  if (!Number.isFinite(selectedPlace.latitude) || !Number.isFinite(selectedPlace.longitude) || Math.abs(selectedPlace.latitude) > 90 || Math.abs(selectedPlace.longitude) > 180) {
    selectedPlace = null;
    notify('Enter latitude between −90 and 90, and longitude between −180 and 180.', true);
    return;
  }
  const position = [selectedPlace.latitude, selectedPlace.longitude];
  if (!marker) {
    marker = L.marker(position, { icon: pinIcon, draggable: true, title: 'Selected place. Drag to move.', alt: 'Selected place pin', keyboard: true }).addTo(map);
    marker.on('dragend', () => { const point = marker.getLatLng().wrap(); selectPlace({ latitude: point.lat, longitude: point.lng, label: 'Dropped pin' }, false); });
  } else marker.setLatLng(position);
  if (fly) map.flyTo(position, Math.max(map.getZoom(), 14), { duration: 0.8 });
  $('#latitude').value = selectedPlace.latitude.toFixed(6);
  $('#longitude').value = selectedPlace.longitude.toFixed(6);
  $('#search-results').hidden = true;
  renderDestination();
  renderActions();
  renderRoute();
  drawWander();
  paintIcons();
}

const deviceStatusText = (device) => ({ ready: 'Ready', 'setup-required': 'Setup needed', unauthorized: 'Trust this computer', offline: 'Disconnected' }[device.state] || 'Check connection');
function renderDevices() {
  const device = state.devices.find((item) => item.id === selectedDeviceId) || state.devices[0];
  const session = state.session;
  const live = session?.status === 'active';
  const attention = ['unknown', 'error', 'waiting'].includes(session?.status);
  $('#phone-chip').classList.toggle('connected', Boolean(device && device.state !== 'offline'));
  $('#phone-chip').classList.toggle('live', live);
  $('#phone-chip').classList.toggle('attention', attention || Boolean(device && device.state !== 'ready' && device.state !== 'offline'));
  $('#phone-chip-name').textContent = device ? device.name || platformName(device.platform) : session ? session.deviceName || 'Your phone' : 'No phone';
  $('#phone-chip-detail').textContent = !device ? (state.preferences.connection === 'wifi' ? 'Pair over Wi-Fi' : 'Connect by USB') : `${device.connection === 'wifi' ? 'Wi-Fi' : 'USB'}, ${live ? 'live' : deviceStatusText(device).toLowerCase()}`;
  $('#scan-button').disabled = pending || state.busy;
  $('#scan-button').classList.toggle('spinning', pending);
  $('#connection-options').textContent = `Connection: ${(state.preferences.connection || 'usb') === 'wifi' ? 'Wi-Fi' : 'USB'}. Change`;
  if (document.activeElement === $('#device-select')) return;
  if (!state.devices.length) {
    setContent('#device-area', `<button class="device-empty" id="connect-device">${icon('smartphone')}<span><strong>Connect your phone</strong><small>${state.preferences.connection === 'wifi' ? 'Pair on the same Wi-Fi network' : 'Use a USB data cable'}</small></span>${icon('arrow-right')}</button><button id="open-setup" class="setup-link">Open the setup guide</button>`);
    $('#connect-device').onclick = openSetup;
    $('#open-setup').onclick = openSetup;
    return;
  }
  setContent('#device-area', `<div class="device-card ${device.state === 'ready' ? 'ready' : ''}"><div class="device-card-top">${icon('smartphone')}<div class="device-select-wrap"><label class="sr-only" for="device-select">Connected phone</label><select id="device-select">${state.devices.map((phone) => `<option value="${esc(phone.id)}" ${phone.id === selectedDeviceId ? 'selected' : ''}>${esc(phone.name || platformName(phone.platform))}</option>`).join('')}</select><span>${esc(platformName(device.platform))}${device.osVersion ? ` ${esc(device.osVersion)}` : ''} over ${device.connection === 'wifi' ? 'Wi-Fi' : 'USB'}</span></div>${icon('chevron-down')}</div><div class="device-card-state"><span class="status-dot"></span><span>${deviceStatusText(device)}</span>${device.state === 'ready' ? icon('check') : `<button id="prepare-device" class="text-button" ${pending ? 'disabled' : ''}>${device.state === 'setup-required' ? 'Prepare' : 'Help'} ${icon('arrow-right')}</button>`}</div></div>${device.detail ? `<p class="device-detail">${esc(device.detail)}</p>` : ''}`);
  $('#device-select').onchange = (event) => { selectedDeviceId = event.target.value; render(); };
  $('#device-select').onblur = () => { renderDevices(); paintIcons(); };
  if ($('#prepare-device')) $('#prepare-device').onclick = () => {
    if (device.state === 'setup-required') runOperation(() => api.prepareDevice(selectedDeviceId));
    else { setupPlatform = device.platform; openSetup(); }
  };
}

function renderDestination() {
  setContent('#destination-summary', selectedPlace
    ? `<div class="destination-name">${icon('map-pin')}<div><strong>${esc(selectedPlace.label)}</strong><span>${formatCoordinate(selectedPlace.latitude)}, ${formatCoordinate(selectedPlace.longitude, false)}</span></div></div>`
    : `<div class="destination-empty">${icon('map-pin')}<div><strong>No place selected</strong><span>Drop a pin anywhere on the map.</span></div></div>`);
  $('#save-button').disabled = !selectedPlace || pending;
  const recent = (state.recentPlaces || []).slice(0, 4);
  $('#recent-section').hidden = !recent.length;
  setContent('#recent-list', recent.map((place, index) => `<button class="recent-place" data-recent="${index}">${icon('rotate-ccw')}<span><strong>${esc(place.label)}</strong><small>${Number(place.latitude).toFixed(4)}, ${Number(place.longitude).toFixed(4)}</small></span></button>`).join(''));
  document.querySelectorAll('[data-recent]').forEach(button => { button.onclick = () => selectPlace(recent[Number(button.dataset.recent)]); });
}

function renderActions() {
  const device = state.devices.find((item) => item.id === selectedDeviceId);
  const status = state.session?.status;
  const busy = pending || state.busy || ['applying', 'stopping', 'reconnecting'].includes(status);
  const otherSession = state.session && state.session.deviceId !== selectedDeviceId;
  const retry = ['unknown', 'error', 'waiting'].includes(status) && !otherSession;
  const reconnectIOS = Boolean(state.session) && !otherSession && device?.platform === 'ios' && device.state === 'setup-required';
  // Any phone on the current connection can be set; this used to wrongly require USB.
  const canApply = Boolean(device) && (device.state === 'ready' || reconnectIOS);
  const label = pendingAction === 'restore' ? 'Stopping…' : status === 'reconnecting' ? 'Reconnecting…' : busy ? 'Working…' : reconnectIOS || (retry && status === 'waiting') ? 'Reconnect & set location' : retry ? 'Retry location' : status === 'active' ? 'Update location' : 'Set location';
  $('#apply-button').disabled = busy || !selectedPlace || !canApply || Boolean(otherSession);
  setContent('#apply-button', `<span>${label}</span>${icon(busy ? 'loader-circle' : retry ? 'refresh-cw' : 'arrow-up-right', busy ? 'spin' : '')}`);
  $('#apply-hint').textContent = pendingAction === 'restore' ? 'Stopping automatic retry and requesting real location.' : status === 'reconnecting' ? 'Reconnecting to the same phone. Keep your phone connected.' : busy ? 'Keep your phone connected.' : otherSession ? 'Restore the current session before switching phones.' : !device || device.state === 'offline' ? state.session ? 'Reconnect the same phone to continue.' : 'Connect a phone to get started.' : reconnectIOS ? 'Reconnect and apply this pin to the same iPhone.' : device.state !== 'ready' ? 'Finish device setup to set a location.' : !selectedPlace ? 'Choose a place on the map.' : retry ? 'Retry this pin on the same phone, or restore real location.' : 'Your phone changes only when you press this button.';
  $('#restore-button').disabled = !state.session || pending || (busy && status !== 'reconnecting');
  setContent('#restore-button', `${icon(pendingAction === 'restore' ? 'loader-circle' : 'rotate-ccw', pendingAction === 'restore' ? 'spin' : '')} ${pendingAction === 'restore' ? 'Stopping…' : 'Restore real location'}`);
}

function placeItem(place) {
  return `<div class="saved-place"><button class="saved-place-main" data-place="${esc(place.id)}">${icon('map-pin')}<span><strong>${esc(place.label)}</strong><small>${Number(place.latitude).toFixed(4)}, ${Number(place.longitude).toFixed(4)}</small></span></button><div class="saved-place-actions"><button class="icon-button" data-edit="${esc(place.id)}" aria-label="Rename ${esc(place.label)}" title="Rename">${icon('pencil')}</button><button class="icon-button" data-delete="${esc(place.id)}" aria-label="Remove ${esc(place.label)}" title="Remove">${icon('trash-2')}</button></div></div>`;
}

const routeTime = seconds => seconds < 60 ? `${Math.ceil(seconds)} sec` : seconds < 3600 ? `${Math.ceil(seconds / 60)} min` : `${Math.floor(seconds / 3600)} hr ${Math.ceil(seconds % 3600 / 60)} min`;
const miles = meters => `${(meters / 1609.344).toFixed(meters < 16093 ? 2 : 1)} mi`;
const speedText = mph => `${mph < 10 ? mph.toFixed(1).replace(/\.0$/, '') : Math.round(mph)} mph`;
// A running or paused route owns the phone; an arrived route only holds the destination.
const routeLocked = () => Boolean(state.route && state.session && state.route.status !== 'completed');
function fitRoute() {
  const dock = $('#session-dock').hidden ? 0 : $('#session-dock').offsetHeight;
  if (routeLine) map.fitBounds(routeLine.getBounds(), { paddingTopLeft: [48, 48], paddingBottomRight: [72, 60 + dock], maxZoom: 16 });
}
function setRoutePlan(plan) {
  routePlan = plan; estimateCache = null; tickCache = null;
  try { planPath = plan ? measurePath(plan.coordinates) : null; } catch { planPath = null; }
}
function routeEstimate() {
  if (!routePlan || !planPath) return null;
  const mode = playbackMode(), top = routeSpeeds[mode] ?? MODES[mode].defaultMph;
  const key = `${routePlan.id}:${mode}:${realisticMotion}:${top}`;
  if (estimateCache?.key !== key) estimateCache = { key, seconds: estimateSeconds(planPath, routePlan.profile, { mode, realistic: realisticMotion, topSpeedMph: top }) };
  return estimateCache.seconds;
}
// Recorded GPX tracks play in the selected mode; routed plans keep their network's mode.
const playbackMode = () => routePlan && routePlan.provider !== 'gpx' && MODES[routePlan.mode] ? routePlan.mode : routeMode;
function stopsChanged() { setRoutePlan(null); drawRoute(); renderRoute(); paintIcons(); }
function addRouteStop(place) {
  if (routeLocked()) return false;
  if (routeStops.length >= 12) { notify('Routes can have up to 12 stops.', true); return false; }
  routeStops.push({ latitude: place.latitude, longitude: place.longitude, label: place.label || 'Dropped pin' });
  stopsChanged(); return true;
}
function moveStop(from, to) {
  if (from === to || from < 0 || to < 0 || from >= routeStops.length || to >= routeStops.length) return;
  const [stop] = routeStops.splice(from, 1); routeStops.splice(to, 0, stop); stopsChanged();
}
// The wander circle follows the active wander, or the selected centre while planning one.
function drawWander() {
  const active = state.route?.kind === 'wander' && state.session ? state.route : null;
  const center = active ? active.center : selectedPlace;
  const radius = active ? active.radiusMeters : wanderRadius;
  if (locationMode !== 'wander' || !center) { wanderCircle?.remove(); wanderCircle = null; return; }
  const latlng = [center.latitude, center.longitude];
  if (!wanderCircle) wanderCircle = L.circle(latlng, { radius, className: 'wander-area', interactive: false }).addTo(map);
  else { wanderCircle.setLatLng(latlng); wanderCircle.setRadius(radius); }
}
function fitWander() { if (wanderCircle) map.fitBounds(wanderCircle.getBounds(), { padding: [60, 60], maxZoom: 17 }); }
function drawRoute() {
  routeLine?.remove(); routeCasing?.remove(); routeLine = routeCasing = null;
  routeMarkers.splice(0).forEach(item => item.remove());
  drawWander();
  if (locationMode !== 'route') return;
  if (routePlan) {
    const latlngs = routePlan.coordinates.map(([lon, lat]) => [lat, lon]);
    // Colours come from CSS so the line follows the theme without redrawing.
    routeCasing = L.polyline(latlngs, { className: 'route-casing', weight: 9, interactive: false }).addTo(map);
    routeLine = L.polyline(latlngs, { className: 'route-line', weight: 5, interactive: false }).addTo(map);
  }
  const editable = !routeLocked();
  routeStops.forEach((stop, index) => {
    const latlng = index === 0 && routePlan ? [...routePlan.coordinates[0]].reverse() : index === routeStops.length - 1 && routePlan ? [...routePlan.coordinates.at(-1)].reverse() : [stop.latitude, stop.longitude];
    const last = index === routeStops.length - 1 && routeStops.length > 1;
    const stopMarker = L.marker(latlng, { interactive: editable, draggable: editable, keyboard: false, title: editable ? `Stop ${index + 1}. Drag to move.` : `Stop ${index + 1}`, icon: L.divIcon({ className: `route-stop-marker${editable ? ' editable' : ''}${last ? ' destination' : ''}`, html: `<span>${index + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
    stopMarker.on('dragend', () => {
      const point = stopMarker.getLatLng().wrap();
      routeStops[index] = { latitude: point.lat, longitude: point.lng, label: 'Dropped pin' };
      stopsChanged();
    });
    routeMarkers.push(stopMarker);
  });
}
function renderSavedRoutes(busy) {
  const routes = state.savedRoutes || [];
  $('#saved-routes-count').textContent = routes.length;
  setContent('#saved-routes', routes.length ? routes.map(route => `<div class="saved-place"><button class="saved-place-main" data-load-route="${esc(route.id)}" ${busy || routeLocked() ? 'disabled' : ''}>${icon(modeIcons[route.mode] || 'car')}<span><strong>${esc(route.name)}</strong><small>${MODES[route.mode]?.label || 'Drive'}, ${miles(route.distanceMeters)}, ${route.provider === 'gpx' ? 'GPX track' : `${route.stops} stops`}</small></span></button><div class="saved-place-actions"><button class="icon-button" data-rename-route="${esc(route.id)}" aria-label="Rename ${esc(route.name)}" title="Rename">${icon('pencil')}</button><button class="icon-button" data-delete-route="${esc(route.id)}" aria-label="Remove ${esc(route.name)}" title="Remove">${icon('trash-2')}</button></div></div>`).join('') : `<div class="saved-empty">${icon('upload')}<p>Save a planned route, or import a GPX file.</p></div>`);
  document.querySelectorAll('[data-load-route]').forEach(button => { button.onclick = async () => {
    const loaded = await runOperation(() => api.loadSavedRoute(button.dataset.loadRoute));
    if (loaded) { showLoadedRoute(loaded); setView('map'); }
  }; });
  document.querySelectorAll('[data-rename-route]').forEach(button => { button.onclick = () => openRouteName(routes.find(route => route.id === button.dataset.renameRoute)); });
  document.querySelectorAll('[data-delete-route]').forEach(button => { button.onclick = () => runOperation(() => api.deleteSavedRoute(button.dataset.deleteRoute), 'Route removed.'); });
  $('#save-route').disabled = busy || !routePlan || isPreview;
  $('#export-gpx').disabled = busy || !routePlan || isPreview;
  $('#import-gpx').disabled = busy || routeLocked() || isPreview;
}
function showLoadedRoute(route) {
  setRoutePlan(route);
  routeStops = route.waypoints.map(stop => ({ ...stop }));
  if (MODES[route.mode] && route.provider !== 'gpx') routeMode = route.mode;
  locationMode = 'route';
  drawRoute(); render(); fitRoute();
}
function renderMotionSettings(busy) {
  const mode = playbackMode(), spec = MODES[mode];
  const top = clampSpeedMph(mode, routeSpeeds[mode]);
  const slider = $('#speed-slider');
  slider.min = spec.minMph; slider.max = spec.maxMph; slider.step = spec.maxMph <= 10 ? 0.1 : spec.maxMph <= 30 ? 0.5 : 1;
  if (document.activeElement !== slider) slider.value = top;
  $('#speed-value').textContent = speedText(Number(slider.value));
  $('#speed-label').textContent = realisticMotion ? 'Top speed' : 'Speed';
  $('#speed-note').textContent = !realisticMotion ? 'Moves at exactly this speed along the path.' : mode === 'drive' ? 'Drives about 5 mph over posted limits, never faster than this.' : `${spec.verb} pace varies a little below this speed.`;
  if (document.activeElement !== $('#realistic-toggle')) $('#realistic-toggle').checked = realisticMotion;
  $('#realistic-toggle').disabled = slider.disabled = busy && !routeLocked() && state.route?.status !== 'completed';
}
function signalTicks() {
  if (!routePlan?.profile?.signals || !planPath) return [];
  if (tickCache?.id !== routePlan.id) tickCache = { id: routePlan.id, ticks: routePlan.profile.signals.map(index => planPath.cumulative[index] / planPath.distanceMeters).filter(at => at > 0.002 && at < 0.998) };
  return tickCache.ticks;
}
function renderRoute() {
  const route = state.route, active = Boolean(route && state.session), locked = routeLocked(), inRoute = locationMode === 'route', inWander = locationMode === 'wander';
  const lockedMode = locked ? (route.kind === 'wander' ? 'wander' : 'route') : null;
  const busy = pending || state.busy;
  const panel = $('.control-panel'), wasLocked = panel.classList.contains('route-active');
  panel.classList.toggle('route-active', locked);
  if (locked && !wasLocked) $('.panel-scroll').scrollTop = 0;
  if (marker) {
    // A pin that has become a stop is already drawn as a numbered marker.
    const pinIsStop = inRoute && selectedPlace && routeStops.some(stop => stop.latitude === selectedPlace.latitude && stop.longitude === selectedPlace.longitude);
    const hide = locked || (active && (inRoute || inWander)) || pinIsStop;
    if (hide && map.hasLayer(marker)) marker.remove();
    if (!hide && !map.hasLayer(marker)) marker.addTo(map);
  }
  $('#route-controls').hidden = !inRoute;
  $('#wander-section').hidden = !inWander;
  $('.control-panel').classList.toggle('wander-active', lockedMode === 'wander');
  $('#place-section').hidden = inRoute || inWander;
  // One coordinate form serves both modes: it picks the place, or the next stop.
  const slot = $(inRoute ? '#route-pin-slot' : inWander ? '#wander-pin-slot' : '#place-pin-slot');
  if ($('#coordinate-form').parentElement !== slot) slot.append($('#coordinate-form'));
  document.querySelectorAll('[data-location-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locationMode === locationMode));
    button.disabled = busy || (locked && button.dataset.locationMode !== lockedMode);
  });
  const mode = playbackMode();
  document.querySelectorAll('[data-travel-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.travelMode === mode));
    button.disabled = busy || locked;
  });
  $('#add-route-stop').disabled = !selectedPlace || locked || busy || routeStops.length >= 12;
  $('#plan-route').disabled = routeStops.length < 2 || locked || busy;
  $('#plan-route').hidden = Boolean(routePlan);
  $('#clear-route').disabled = !routeStops.length || locked || busy;
  setContent('#route-stops', routeStops.length ? routeStops.map((stop, i) => `<li draggable="${!locked && !busy}" data-stop="${i}" tabindex="${locked ? -1 : 0}" aria-label="Stop ${i + 1}: ${esc(stop.label)}. Alt plus arrow keys reorder.">${locked ? '' : `<span class="route-stop-grip" aria-hidden="true">${icon('grip-vertical')}</span>`}<span class="route-stop-number">${i + 1}</span><div><strong>${esc(stop.label)}</strong><small>${i === 0 ? 'Start' : i === routeStops.length - 1 ? 'Destination' : 'Via'}</small></div><button class="icon-button" data-remove-stop="${i}" aria-label="Remove stop ${i + 1}" ${locked || busy ? 'disabled' : ''}>${icon('x')}</button></li>`).join('') : '<li class="route-stops-empty">No stops yet</li>');
  document.querySelectorAll('[data-remove-stop]').forEach(button => { button.onclick = () => { routeStops.splice(Number(button.dataset.removeStop), 1); stopsChanged(); }; });
  document.querySelectorAll('#route-stops li[data-stop]').forEach(item => {
    const index = Number(item.dataset.stop);
    item.ondragstart = event => { draggedStop = index; item.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); };
    item.ondragend = () => { draggedStop = null; document.querySelectorAll('#route-stops li').forEach(li => li.classList.remove('dragging', 'drop-target')); };
    item.ondragover = event => { if (draggedStop == null) return; event.preventDefault(); item.classList.add('drop-target'); };
    item.ondragleave = () => item.classList.remove('drop-target');
    item.ondrop = event => { event.preventDefault(); if (draggedStop != null) moveStop(draggedStop, index); };
    item.onkeydown = event => {
      if (!event.altKey || locked || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const target = index + (event.key === 'ArrowUp' ? -1 : 1);
      moveStop(index, target);
      document.querySelector(`#route-stops li[data-stop="${target}"]`)?.focus();
    };
  });
  $('#route-summary').hidden = !routePlan;
  if (routePlan) {
    const signals = routePlan.profile?.signals?.length;
    const source = routePlan.provider === 'gpx' ? 'Recorded GPX track' : `${MODES[mode].label} route via ${routePlan.provider === 'osrm' ? 'OSRM' : 'Valhalla'}`;
    const estimate = routeEstimate();
    setContent('#route-summary', `<div class="route-summary-main"><strong>${miles(routePlan.distanceMeters)}</strong><span>${estimate == null ? '' : `about ${routeTime(estimate)}`}</span></div><p>${icon(modeIcons[mode])} ${source}${signals != null ? `, ${signals} traffic light${signals === 1 ? '' : 's'}` : ''}</p>`);
  }
  renderMotionSettings(busy);
  const device = state.devices.find(d => d.id === selectedDeviceId);
  const otherSession = state.session && state.session.deviceId !== selectedDeviceId;
  const running = route?.status === 'running', paused = route?.status === 'paused';
  $('#route-play').disabled = busy || (locked ? !running && (!paused || !device || otherSession || !['ready', 'setup-required'].includes(device.state)) : !routePlan || device?.state !== 'ready' || Boolean(otherSession));
  $('#route-play').textContent = busy ? 'Working…' : running && locked ? 'Pause route' : paused && locked ? 'Resume route' : 'Start route';
  const completed = route?.status === 'completed' && active;
  $('#route-hint').textContent = locked ? route.message : otherSession ? 'Restore the current session before switching phones.' : completed && routePlan?.id === route.id ? route.message : !routePlan ? routeStops.length < 2 ? 'Add a start and destination, then plan the route.' : 'Plan the route to see the path and travel time.' : !device ? 'Connect a phone to start. The route is ready.' : 'Start moves your phone to the first stop, then follows the path.';
  renderSavedRoutes(busy);
  renderWander(busy, lockedMode);
  if (route?.point && (inRoute || inWander)) {
    const point = [route.point.latitude, route.point.longitude];
    if (!routeDot) routeDot = L.circleMarker(point, { radius: 8, weight: 3, fillOpacity: 1, className: 'route-location-dot', interactive: false }).addTo(map);
    else routeDot.setLatLng(point);
    routeDot.bringToFront();
  } else if (routeDot) { routeDot.remove(); routeDot = null; }
}

function renderWander(busy, lockedMode) {
  const route = state.route, wandering = lockedMode === 'wander';
  const center = wandering ? route.center : selectedPlace;
  setContent('#wander-center', center
    ? `<div class="destination-name">${icon('footprints')}<div><strong>${esc(wandering ? 'Wandering here' : center.label || 'Dropped pin')}</strong><span>${formatCoordinate(center.latitude)}, ${formatCoordinate(center.longitude, false)}</span></div></div>`
    : `<div class="destination-empty">${icon('footprints')}<div><strong>No centre yet</strong><span>Click the map to choose where to wander.</span></div></div>`);
  const radius = wandering ? route.radiusMeters : wanderRadius;
  if (document.activeElement !== $('#wander-radius')) $('#wander-radius').value = radius;
  $('#wander-radius-value').textContent = radius >= 1000 ? `${(radius / 1000).toFixed(radius % 1000 ? 2 : 0)} km` : `${radius} m`;
  const pace = wandering ? route.topSpeedMph : clampSpeedMph('walk', routeSpeeds.walk);
  if (document.activeElement !== $('#wander-speed')) $('#wander-speed').value = pace;
  $('#wander-speed-value').textContent = speedText(pace);
  $('#wander-radius').disabled = busy || wandering;
  const device = state.devices.find(d => d.id === selectedDeviceId);
  const otherSession = state.session && state.session.deviceId !== selectedDeviceId;
  const running = route?.status === 'running', paused = route?.status === 'paused';
  $('#wander-start').disabled = busy || (wandering ? !running && !paused : Boolean(lockedMode) || !selectedPlace || device?.state !== 'ready' || Boolean(otherSession));
  $('#wander-start').textContent = busy ? 'Working…' : wandering && running ? 'Pause wandering' : wandering && paused ? 'Resume wandering' : 'Start wandering';
  $('#wander-hint').textContent = wandering ? route.message : otherSession ? 'Restore the current session before switching phones.' : !selectedPlace ? 'Choose a centre on the map.' : !device ? 'Connect a phone to start.' : 'Start moves your phone to the centre, then begins walking.';
}
function renderDock() {
  const session = state.session, route = state.route;
  const dock = $('#session-dock');
  const wasHidden = dock.hidden;
  dock.hidden = !session;
  document.querySelector('.map-workspace').classList.toggle('has-dock', Boolean(session));
  if (!session) return;
  const telemetry = Boolean(route && session.status === 'active' && ['running', 'paused', 'completed', 'starting'].includes(route.status));
  $('#route-telemetry').hidden = !telemetry;
  $('#session-status').hidden = telemetry;
  dock.classList.toggle('route-mode', telemetry);
  const locked = routeLocked(), busy = pending || state.busy;
  const running = route?.status === 'running', paused = route?.status === 'paused';
  $('#dock-play').hidden = !telemetry || !locked || !(running || paused);
  $('#dock-play').disabled = $('#route-play').disabled;
  $('#dock-play').setAttribute('aria-label', running ? 'Pause route' : 'Resume route');
  setContent('#dock-play', icon(running ? 'pause' : 'play'));
  $('#route-from-here').hidden = !(route?.status === 'completed' && session.status === 'active');
  $('#route-from-here').disabled = busy;
  if (telemetry) {
    const progress = route.distanceMeters ? Math.min(1, (route.traveledMeters || 0) / route.distanceMeters) : 0;
    const realistic = route.realistic;
    const mph = route.status === 'completed' ? 0 : realistic ? route.speedMph || 0 : route.status === 'running' ? route.topSpeedMph ?? 45 : 0;
    $('#speed-now').textContent = mph < 10 ? mph.toFixed(0) : Math.round(mph);
    $('#speed-limit').hidden = !(realistic && route.limitMph && route.mode === 'drive');
    if (route.limitMph) $('#speed-limit').textContent = `Limit ${route.limitPosted ? '' : '~'}${Math.round(route.limitMph)}`;
    $('#timeline-fill').style.width = `${progress * 100}%`;
    $('#timeline-head').style.left = `${progress * 100}%`;
    if (route.kind === 'wander') {
      // Wandering has no destination: the bar shows the current walk and totals instead.
      const walking = route.phase === 'walking';
      $('#timeline-fill').style.width = `${walking ? progress * 100 : 0}%`;
      $('#timeline-head').style.left = `${walking ? progress * 100 : 0}%`;
      $('#timeline-start').textContent = 'Wander';
      $('#timeline-end').textContent = `${route.spotsVisited} spot${route.spotsVisited === 1 ? '' : 's'} visited`;
      $('#timeline-state').textContent = route.status === 'paused' ? 'Paused' : route.status === 'starting' ? 'Starting…' : walking ? 'Walking to a spot' : 'Lingering';
      setContent('#timeline-ticks', '');
      $('#eta-time').textContent = miles(route.walkedMeters + (walking ? route.traveledMeters || 0 : 0));
      $('#eta-distance').textContent = 'walked';
    } else {
      const shown = routePlan?.id === route.id;
      const stops = shown ? routeStops : [];
      $('#timeline-start').textContent = stops[0]?.label || 'Start';
      $('#timeline-end').textContent = stops.at(-1)?.label || 'Destination';
      $('#timeline-state').textContent = route.status === 'completed' ? 'Arrived' : route.status === 'paused' ? 'Paused' : route.status === 'starting' ? 'Starting…' : route.waiting ? 'Waiting at a light' : MODES[route.mode]?.verb || 'Moving';
      setContent('#timeline-ticks', (shown ? signalTicks() : []).map(at => `<i class="timeline-tick${at <= progress ? ' passed' : ''}" style="left:${(at * 100).toFixed(2)}%"></i>`).join(''));
      $('#eta-time').textContent = route.status === 'completed' ? 'Arrived' : `${routeTime(route.remainingSeconds || 0)}`;
      $('#eta-distance').textContent = route.status === 'completed' ? miles(route.distanceMeters) : `${miles(Math.max(0, route.distanceMeters - (route.traveledMeters || 0)))} left`;
    }
  }
  if (wasHidden && locationMode === 'route' && routeLine) requestAnimationFrame(fitRoute);
  if (wasHidden && locationMode === 'wander' && wanderCircle) requestAnimationFrame(fitWander);
}

function renderSaved() {
  const places = state.savedPlaces || [];
  $('#saved-count').textContent = places.length;
  $('#saved-dot').textContent = places.length + (state.savedRoutes || []).length;
  $('#saved-dot').hidden = !(places.length + (state.savedRoutes || []).length);
  setContent('#saved-list', places.length ? places.map(placeItem).join('') : `<div class="saved-empty">${icon('bookmark')}<p>Places you save appear here.</p></div>`);
  document.querySelectorAll('[data-place]').forEach((button) => { button.onclick = () => { const place = places.find((item) => item.id === button.dataset.place); if (place) { locationMode = 'fixed'; selectPlace(place); setView('map'); } }; });
  document.querySelectorAll('[data-edit]').forEach((button) => { button.onclick = () => openSave(places.find((item) => item.id === button.dataset.edit)); });
  document.querySelectorAll('[data-delete]').forEach((button) => { button.onclick = () => runOperation(() => api.deletePlace(button.dataset.delete), 'Place removed.'); });
  document.querySelectorAll('[data-library-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.libraryTab === libraryTab)));
  $('#library-places').hidden = libraryTab !== 'places';
  $('#library-routes').hidden = libraryTab !== 'routes';
}

function renderSession() {
  const session = state.session;
  const sessionElement = $('#session-status');
  sessionElement.classList.toggle('is-active', session?.status === 'active');
  sessionElement.classList.toggle('needs-attention', ['unknown', 'error', 'waiting'].includes(session?.status));
  if (!session) { setContent('#session-status', ''); return; }
  const labels = { active: 'Location active', applying: 'Setting location…', reconnecting: 'Reconnecting to your phone…', waiting: 'Waiting for your phone', stopping: 'Stopping simulation…', unknown: 'Location state unverified', error: 'Session needs attention' };
  const refreshDate = session.lastRefreshAt ? new Date(session.lastRefreshAt) : null;
  const hasRefresh = refreshDate && Number.isFinite(refreshDate.getTime());
  const commandAck = session.refreshSource === 'command-ack';
  const helperReadback = session.refreshSource === 'helper-readback';
  const confirmationLabel = commandAck ? 'Last command acknowledged' : helperReadback ? 'Last helper confirmation' : 'Last device confirmation';
  const confirmationScope = commandAck ? 'Command accepted; phone-app location is not verified.' : helperReadback ? 'Helper coordinates confirmed; a fresh GPS fix is not verified.' : 'Device response recorded; phone-app location is not verified.';
  const refreshCount = Number.isFinite(session.refreshCount) ? Math.max(0, session.refreshCount) : null;
  const refreshText = hasRefresh ? `<small id="session-refresh" class="session-refresh" aria-live="off"><span>${confirmationLabel}: <time datetime="${esc(refreshDate.toISOString())}">${esc(refreshDate.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }))}</time>${refreshCount === null ? '' : `. ${commandAck ? 'Updates acknowledged' : 'Refreshes'}: ${refreshCount}`}</span><span>${confirmationScope}</span></small>` : '';
  const recovering = ['waiting', 'unknown', 'error'].includes(session.status);
  const recoveryText = recovering ? `<span class="session-recovery">${session.autoReconnect ? 'Wraith will retry this phone automatically. Restore cancels retry.' : 'Reconnect this phone, then retry or restore.'}</span>` : '';
  const statusIcon = session.status === 'reconnecting' ? 'refresh-cw' : recovering ? 'help-circle' : 'map-pin';
  const title = state.route?.kind === 'wander' && session.status === 'active' ? (state.route.status === 'paused' ? 'Wandering paused' : 'Wandering') : state.route && session.status === 'active' ? ({ running: 'Following route', paused: 'Route paused', completed: 'Arrived', starting: 'Starting route…' }[state.route.status]) : labels[session.status] || 'Session needs attention';
  setContent('#session-status', `<span class="session-status-icon">${icon(statusIcon, session.status === 'reconnecting' ? 'spin' : '')}</span><div><strong>${title}</strong><span>${esc(state.route?.message || session.message || session.label || 'Keep your phone connected.')}</span>${recoveryText}${refreshText}</div>${session.status === 'active' ? '<span class="live-tag"><span></span>Live</span>' : ''}`);
}

function renderRuntime() {
  setContent('#runtime-status', ['ios', 'android'].map((platform) => {
    const runtime = state.runtime?.[platform] || {};
    return `<div class="runtime-row"><div>${icon('smartphone')}<span><strong>${platformName(platform)}</strong><small>${esc(runtime.message || 'Tools have not been checked yet.')}</small></span></div><span class="runtime-tag ${runtime.available ? 'available' : ''}">${runtime.available ? 'Ready' : 'Setup needed'}</span></div>`;
  }).join(''));
  $('#install-runtime').disabled = pending || state.busy || isPreview;
  setContent('#install-runtime', `${icon(pending ? 'loader-circle' : 'download', pending ? 'spin' : '')} ${pending ? 'Preparing…' : isPreview ? 'Available in the desktop app' : 'Prepare device tools'}`);
  if (document.activeElement !== $('#restore-preference')) $('#restore-preference').checked = state.preferences.restoreOnQuit !== false;
  const drift = state.preferences.drift || 'subtle';
  document.querySelectorAll('[data-drift-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.driftChoice === drift)));
  const notifications = state.preferences.notifications || {};
  document.querySelectorAll('[data-notify]').forEach(input => {
    if (document.activeElement !== input) input.checked = notifications[input.dataset.notify] !== false;
    if (input.dataset.notify !== 'enabled') input.disabled = notifications.enabled === false;
  });
  const selectedGuide = state.preferences.phonePlatform ? guideFor(detectedHost, state.preferences.phonePlatform) : null;
  $('#settings-configuration').textContent = selectedGuide?.title || 'No setup selected';
}

function renderSetup() {
  const guide = guideFor();
  $('#setup-title').textContent = guide.title;
  $('#setup-intro').textContent = guide.intro;
  const runtime = state.runtime?.[setupPlatform];
  const runtimeHelp = runtime?.available === false ? `<div class="setup-runtime"><div><strong>${isPreview ? 'Open the desktop app to connect' : 'Device tools need preparation'}</strong><p>${isPreview ? 'The browser preview cannot discover or control phones.' : 'First-time preparation needs internet access.'}</p></div><button id="setup-install-runtime" class="secondary-button compact" ${(pending || state.busy || isPreview) ? 'disabled' : ''}>${pending ? 'Preparing…' : 'Prepare tools'}</button></div>` : '';
  setContent('#setup-content', `${runtimeHelp}<ol class="setup-steps">${guide.steps.map(([title, body], index) => `<li><span class="step-number">${index + 1}</span><div><h3>${title}</h3><p>${body}</p></div></li>`).join('')}</ol><p class="compatibility-note">${setupPlatform === 'ios' ? 'Wraith currently targets iOS 17.4 and later. Support still depends on the iOS version and bundled device tools.' : 'Wraith targets Android 8 and later. Some apps can detect or reject simulated locations.'}</p>`);
  if ($('#setup-install-runtime')) $('#setup-install-runtime').onclick = () => runOperation(() => api.installRuntime(), 'Device tools checked.');
  $('#setup-scan').disabled = pending || state.busy;
  const matching = state.devices.filter((device) => device.platform === setupPlatform && device.state !== 'offline');
  $('#setup-detection').textContent = matching.length ? `${matching.length} ${platformName(setupPlatform)}${matching.length === 1 ? '' : ' devices'} detected. Close this guide to select it.` : isPreview ? 'Open the desktop app to check the USB connection.' : '';
}

function renderOnboarding() {
  $('#onboarding-progress').textContent = onboardingStep === 'survey' ? '1 of 2' : '2 of 2';
  if (onboardingStep === 'survey') {
    setContent('#onboarding-content', `<div class="onboarding-copy"><h1 id="onboarding-title">Which phone are you setting up?</h1><p>Wraith will show the USB setup for this ${hostName}. For wireless setup later, choose Connection, then Wi-Fi, from the phone menu.</p></div><div class="survey-group"><h2>Your phone</h2><div class="choice-grid"><button class="choice-card" data-survey-phone="ios" aria-pressed="${surveyPhone === 'ios'}">${icon('smartphone')}<span><strong>iPhone</strong><small>iOS 17.4 or later</small></span>${icon('check', 'choice-check')}</button><button class="choice-card" data-survey-phone="android" aria-pressed="${surveyPhone === 'android'}">${icon('smartphone')}<span><strong>Android</strong><small>Android 8 or later</small></span>${icon('check', 'choice-check')}</button></div></div><div class="onboarding-actions"><span>Your choice stays on this computer.</span><button id="onboarding-next" class="primary-button inline" ${!surveyPhone ? 'disabled' : ''}><span>Continue</span>${icon('arrow-right')}</button></div>`);
    document.querySelectorAll('[data-survey-phone]').forEach((button) => { button.onclick = () => { surveyPhone = button.dataset.surveyPhone; renderOnboarding(); paintIcons(); }; });
    $('#onboarding-next').onclick = () => { if (surveyPhone) { onboardingStep = 'guide'; onboardingChecks.clear(); renderOnboarding(); paintIcons(); } };
  } else {
    const guide = guideFor(detectedHost, surveyPhone);
    const matching = state.devices.filter((device) => device.platform === surveyPhone && device.state !== 'offline');
    setContent('#onboarding-content', `<button id="onboarding-back" class="back-button">${icon('chevron-left')} Back</button><div class="onboarding-copy guide-copy"><span class="configuration-pill">${guide.title}</span><h1 id="onboarding-title">Prepare your ${platformName(surveyPhone)}.</h1><p>${guide.intro} Tick each step as you finish it.</p></div><div class="onboarding-checklist">${guide.steps.map(([title, body], index) => `<label class="checklist-row"><input type="checkbox" data-onboarding-check="${index}" ${onboardingChecks.has(index) ? 'checked' : ''}/><span class="check-control">${icon('check')}</span><span><strong>${title}</strong><small>${body}</small></span></label>`).join('')}</div><div id="onboarding-detection" class="onboarding-detection ${matching.length ? 'connected' : ''}">${matching.length ? `${icon('check')} ${platformName(surveyPhone)} detected over USB.` : `${icon('cable')} ${isPreview ? 'USB detection is available in the desktop app.' : 'Connect your phone when you’re ready.'}`}</div><div class="onboarding-actions"><button id="onboarding-scan" class="secondary-button" ${pending || state.busy ? 'disabled' : ''}>${icon(pending ? 'loader-circle' : 'refresh-cw', pending ? 'spin' : '')} Check connection</button><button id="onboarding-finish" class="primary-button inline" ${pending ? 'disabled' : ''}><span>Continue to map</span>${icon('arrow-right')}</button></div>`);
    $('#onboarding-back').onclick = () => { onboardingStep = 'survey'; renderOnboarding(); paintIcons(); };
    document.querySelectorAll('[data-onboarding-check]').forEach((checkbox) => { checkbox.onchange = () => { const index = Number(checkbox.dataset.onboardingCheck); if (checkbox.checked) onboardingChecks.add(index); else onboardingChecks.delete(index); }; });
    $('#onboarding-scan').onclick = async () => { const result = await runOperation(() => api.scanDevices()); if (result && !result.devices.some((device) => device.platform === surveyPhone && device.state !== 'offline')) $('#onboarding-detection').innerHTML = `${icon('help-circle')} No ${platformName(surveyPhone)} found. Check the cable, unlock the phone, and accept its prompt.`; paintIcons(true); };
    $('#onboarding-finish').onclick = async () => {
      const result = await runOperation(() => api.updatePreferences({ onboardingComplete: true, hostPlatform: detectedHost, phonePlatform: surveyPhone }));
      if (result) { setupPlatform = surveyPhone; $('#onboarding-dialog').close(); }
    };
  }
}

function renderView() {
  const showingLibrary = currentView === 'saved';
  $('.control-panel').classList.toggle('show-library', showingLibrary);
  $('#saved-nav-button').classList.toggle('active', showingLibrary);
  $('#saved-nav-button').setAttribute('aria-pressed', String(showingLibrary));
}

function handoffPhone() {
  const device = state.devices.find(device => device.id === (state.session?.deviceId || selectedDeviceId));
  return (state.preferences.connection || 'usb') === 'usb' && device?.connection === 'usb' && device.state === 'ready' &&
    (!state.session || state.session.status === 'active') ? device : null;
}
function renderConnections() {
  const mode = state.preferences.connection || 'usb';
  const busy = pending || state.busy, phone = handoffPhone();
  document.querySelectorAll('[data-connection]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.connection === mode));
    button.disabled = busy || (button.dataset.connection !== mode && Boolean(state.session) && !phone);
  });
  $('#wifi-status').textContent = busy ? 'Checking the connection… Keep USB connected.' : phone ? 'Ready to switch. Wraith will check this same phone over Wi-Fi first.' : state.session?.status === 'active' && mode === 'wifi' ? 'Connected over Wi-Fi. Restore real location before returning to USB.' : state.session ? 'Retry or restore this phone’s session before switching.' : `Using ${mode === 'wifi' ? 'Wi-Fi' : 'USB'}. ${state.devices.length} phone${state.devices.length === 1 ? '' : 's'} found.`;
  $('#wifi-handoff').hidden = !phone;
  $('#switch-to-wifi').disabled = $('#wifi-prompt-switch').disabled = Boolean(busy);
  $('#wifi-prompt-android').hidden = $('#wifi-android-note').hidden = phone?.platform !== 'android';
  $('#wifi-prompt').hidden = !phone || state.session?.status !== 'active' || !state.network?.wifi || dismissedWifi.has(phone.id) || (state.preferences.dismissedWifiPrompts || []).includes(phone.id) || isPreview || !state.preferences.onboardingComplete;
  $('#enable-iphone-wifi').disabled = busy || Boolean(state.session) || mode !== 'usb' || state.devices.find(device => device.id === selectedDeviceId)?.platform !== 'ios';
  const recoveringAndroid = state.session?.platform === 'android' && state.session?.connection === 'wifi' && ['waiting', 'unknown', 'error'].includes(state.session?.status);
  $('#wifi-pair-button').disabled = $('#wifi-connect-button').disabled = busy || (Boolean(state.session) && !recoveringAndroid) || mode !== 'wifi';
  $('#wifi-refresh').disabled = busy;
  $('#wifi-ios').hidden = $('#wifi-phone').value !== 'ios';
  $('#wifi-android').hidden = $('#wifi-phone').value !== 'android';
}
async function switchToWifi() {
  const phone = handoffPhone();
  if (!phone) return;
  const result = await runOperation(() => api.switchToWifi(phone.id), 'Connected over Wi-Fi. You can unplug the USB cable.');
  if (result && $('#wifi-dialog').open) $('#wifi-dialog').close();
}

// Dialog-only sections render while their dialog is open, not on every heartbeat.
function render() {
  renderConnections(); renderView(); renderDevices(); renderDestination(); renderActions(); renderRoute(); renderSaved(); renderSession(); renderDock();
  if ($('#settings-dialog').open) renderRuntime();
  if ($('#setup-dialog').open) renderSetup();
  if ($('#onboarding-dialog').open) renderOnboarding();
  paintIcons();
}

function openOnboarding() {
  surveyPhone = state.preferences.phonePlatform || state.devices[0]?.platform || null;
  onboardingStep = 'survey';
  onboardingChecks.clear();
  if ($('#setup-dialog').open) $('#setup-dialog').close();
  renderOnboarding();
  paintIcons();
  if (!$('#onboarding-dialog').open) $('#onboarding-dialog').showModal();
}

function openSetup() {
  closePhonePopover();
  if (state.preferences.connection === 'wifi') { openConnections(); return; }
  if (!state.preferences.phonePlatform) { openOnboarding(); return; }
  setupPlatform = state.preferences.phonePlatform;
  renderSetup();
  paintIcons();
  if (!$('#setup-dialog').open) $('#setup-dialog').showModal();
}

function openPhonePopover() { $('#phone-popover').hidden = false; $('#phone-chip').setAttribute('aria-expanded', 'true'); renderDevices(); paintIcons(); }
function closePhonePopover() { $('#phone-popover').hidden = true; $('#phone-chip').setAttribute('aria-expanded', 'false'); }

let placeBeingSaved = null;
function openSave(place = selectedPlace) {
  if (!place) return;
  placeBeingSaved = { ...place };
  $('#save-title').textContent = place.id ? 'Rename place' : 'Save this place';
  $('#place-name').value = place.label;
  $('#place-id').value = place.id || '';
  $('#save-coordinates').textContent = `${formatCoordinate(place.latitude)}, ${formatCoordinate(place.longitude, false)}`;
  $('#save-dialog').showModal();
  $('#place-name').select();
}

map.on('click', (event) => {
  const point = event.latlng.wrap();
  // In Route mode a click adds the next stop; elsewhere it moves the preview pin.
  if (locationMode === 'route') {
    // While a route owns the phone, the map is for watching; clicks change nothing.
    if (!routeLocked()) addRouteStop({ latitude: point.lat, longitude: point.lng, label: 'Dropped pin' });
    return;
  }
  if (locationMode === 'wander' && routeLocked()) return;
  selectPlace({ latitude: point.lat, longitude: point.lng, label: 'Dropped pin' }, false);
});
map.on('moveend', () => { const center = map.getCenter().wrap(); $('#map-coordinates').textContent = `${formatCoordinate(center.lat)}, ${formatCoordinate(center.lng, false)}`; });
map.on('dragstart', () => { $('#search-results').hidden = true; });
$('#zoom-in').onclick = () => map.zoomIn();
$('#zoom-out').onclick = () => map.zoomOut();
$('#recenter-button').onclick = () => {
  if (locationMode === 'route' && routeDot) map.flyTo(routeDot.getLatLng(), Math.max(14, map.getZoom()));
  else if (locationMode === 'route' && routeLine) fitRoute();
  else map.flyTo(selectedPlace ? [selectedPlace.latitude, selectedPlace.longitude] : [41.8827, -87.6233], selectedPlace ? Math.max(13, map.getZoom()) : 13, { duration: 0.6 });
};
$('#retry-map').onclick = () => { tileErrors = 0; $('#map-error').hidden = true; tiles.redraw(); };
$('#phone-chip').onclick = (event) => { event.stopPropagation(); if ($('#phone-popover').hidden) openPhonePopover(); else closePhonePopover(); };
document.addEventListener('pointerdown', (event) => { if (!$('#phone-popover').hidden && !event.target.closest('#phone-popover, #phone-chip')) closePhonePopover(); });
$('#help-button').onclick = openSetup;
$('#settings-button').onclick = () => { $('#provider-url').value = state.preferences.geocoderUrl || 'https://photon.komoot.io/api/'; renderRuntime(); applyTheme(); paintIcons(true); $('#settings-dialog').showModal(); };
document.querySelectorAll('[data-drift-choice]').forEach(button => { button.onclick = () => runOperation(() => api.updatePreferences({ drift: button.dataset.driftChoice })); });
document.querySelectorAll('[data-notify]').forEach(input => { input.onchange = () => runOperation(() => api.updatePreferences({ notifications: { [input.dataset.notify]: input.checked } })); });
document.querySelectorAll('[data-theme-choice]').forEach(button => { button.onclick = () => runOperation(() => api.updatePreferences({ theme: button.dataset.themeChoice })); });
$('#scan-button').onclick = () => runOperation(() => api.scanDevices(), 'Phone list refreshed.');
$('#setup-scan').onclick = async () => { const result = await runOperation(() => api.scanDevices()); if (result && !result.devices.some((device) => device.platform === setupPlatform && device.state !== 'offline')) $('#setup-detection').textContent = `No ${platformName(setupPlatform)} found. Check the data cable, unlock the phone, and accept its prompt.`; };
$('#change-configuration').onclick = openOnboarding;
$('#rerun-onboarding').onclick = () => { $('#settings-dialog').close(); openOnboarding(); };
$('#save-button').onclick = () => openSave();
$('#apply-button').onclick = () => { if (selectedPlace && selectedDeviceId) runOperation(() => api.applyLocation({ deviceId: selectedDeviceId, ...selectedPlace })); };
document.querySelectorAll('[data-location-mode]').forEach(button => { button.onclick = () => { locationMode = button.dataset.locationMode; drawRoute(); render(); }; });
const savePreferences = preferences => api.updatePreferences(preferences).then(acceptState).catch(error => notify(error.message, true));
document.querySelectorAll('[data-travel-mode]').forEach(button => { button.onclick = () => {
  const mode = button.dataset.travelMode;
  if (mode === playbackMode() || routeLocked()) return;
  routeMode = mode;
  // A routed plan follows one network (roads, bike lanes or footpaths), so it needs planning again.
  if (routePlan && routePlan.provider !== 'gpx') { setRoutePlan(null); drawRoute(); }
  estimateCache = null; render();
  savePreferences({ routeMode: mode });
}; });
let speedTimer;
$('#speed-slider').oninput = () => {
  const mode = playbackMode();
  routeSpeeds[mode] = clampSpeedMph(mode, Number($('#speed-slider').value));
  $('#speed-value').textContent = speedText(routeSpeeds[mode]);
  clearTimeout(speedTimer);
  speedTimer = setTimeout(() => {
    savePreferences({ routeSpeeds: { [mode]: routeSpeeds[mode] } });
    if (routeLocked() && state.route.mode === mode) api.updateRouteOptions({ topSpeedMph: routeSpeeds[mode] }).then(acceptState).catch(error => notify(error.message, true));
  }, 250);
  renderRoute(); paintIcons();
};
$('#realistic-toggle').onchange = () => {
  realisticMotion = $('#realistic-toggle').checked;
  savePreferences({ realisticMotion });
  if (routeLocked()) api.updateRouteOptions({ realistic: realisticMotion }).then(acceptState).catch(error => notify(error.message, true));
  renderRoute(); paintIcons();
};
$('#add-route-stop').onclick = () => { if (selectedPlace) addRouteStop(selectedPlace); };
$('#clear-route').onclick = () => { routeStops = []; stopsChanged(); };
$('#plan-route').onclick = async () => {
  const planned = await runOperation(() => api.planRoute({ waypoints: routeStops, mode: routeMode }));
  if (planned) { setRoutePlan(planned); drawRoute(); fitRoute(); renderRoute(); paintIcons(); }
};
const playRoute = () => runOperation(() => state.route?.status === 'running' && routeLocked() ? api.pauseRoute() : state.route?.status === 'paused' && routeLocked() ? api.resumeRoute()
  : api.startRoute({ deviceId: selectedDeviceId, routeId: routePlan?.id, mode: playbackMode(), realistic: realisticMotion, topSpeedMph: clampSpeedMph(playbackMode(), routeSpeeds[playbackMode()]) }));
$('#route-play').onclick = playRoute;
$('#wander-start').onclick = () => {
  const route = state.route;
  if (route?.kind === 'wander' && routeLocked()) { playRoute(); return; }
  if (!selectedPlace) return;
  runOperation(() => api.startWander({ deviceId: selectedDeviceId, latitude: selectedPlace.latitude, longitude: selectedPlace.longitude, radiusMeters: wanderRadius, topSpeedMph: clampSpeedMph('walk', routeSpeeds.walk) }));
};
$('#wander-radius').oninput = () => {
  wanderRadius = Number($('#wander-radius').value);
  drawWander(); renderRoute(); paintIcons();
};
$('#wander-radius').onchange = fitWander;
$('#wander-speed').oninput = () => {
  routeSpeeds.walk = clampSpeedMph('walk', Number($('#wander-speed').value));
  $('#wander-speed-value').textContent = speedText(routeSpeeds.walk);
  clearTimeout(speedTimer);
  speedTimer = setTimeout(() => {
    savePreferences({ routeSpeeds: { walk: routeSpeeds.walk } });
    if (state.route?.kind === 'wander' && routeLocked()) api.updateRouteOptions({ topSpeedMph: routeSpeeds.walk }).then(acceptState).catch(error => notify(error.message, true));
  }, 250);
};
$('#dock-play').onclick = playRoute;
$('#route-from-here').onclick = () => {
  const session = state.session;
  if (!session || routeLocked()) return;
  locationMode = 'route';
  routeStops = [{ latitude: session.latitude, longitude: session.longitude, label: 'Current location' }];
  stopsChanged(); render();
  notify('Start set to the phone’s current location. Click the map to add a destination.');
};
function openRouteName(route = null) {
  routeBeingNamed = route;
  $('#route-name-title').textContent = route ? 'Rename route' : 'Save this route';
  $('#route-name-submit').textContent = route ? 'Rename route' : 'Save route';
  $('#route-name').value = route?.name || routePlan?.name || `Route to ${routePlan?.waypoints?.at(-1)?.label || 'destination'}`;
  $('#route-name-dialog').showModal();
  $('#route-name').select();
}
$('#save-route').onclick = () => { if (routePlan) openRouteName(); };
$('#route-name-form').onsubmit = async (event) => {
  event.preventDefault();
  const name = $('#route-name').value.trim();
  if (!name) return;
  const result = await runOperation(() => routeBeingNamed ? api.renameSavedRoute({ id: routeBeingNamed.id, name }) : api.saveRoute({ name }), routeBeingNamed ? 'Route renamed.' : 'Route saved.');
  if (result) { if (!routeBeingNamed && routePlan) routePlan = { ...routePlan, name }; $('#route-name-dialog').close(); }
};
$('#import-gpx').onclick = async () => {
  const result = await runOperation(() => api.importGpx({ mode: routeMode }));
  if (!result || result.canceled) return;
  if (result.route) { showLoadedRoute(result.route); setView('map'); notify('GPX track imported. It replays the recorded path exactly.'); }
  else if (result.stops) { locationMode = 'route'; setRoutePlan(null); routeStops = result.stops; drawRoute(); setView('map'); notify(`Imported ${result.stops.length} stops. Plan the route to continue.`); }
};
$('#export-gpx').onclick = async () => {
  const result = await runOperation(() => api.exportGpx());
  if (result?.saved) notify(`Exported ${result.fileName}.`);
};
$('#restore-button').onclick = () => runOperation(() => api.stopLocation(), 'Restore command accepted. Phone apps may need a moment to refresh.', 'restore');
$('#toast-close').onclick = () => { $('#toast').hidden = true; clearTimeout(toastTimer); };
$('#install-runtime').onclick = () => runOperation(() => api.installRuntime(), 'Device tools checked.');
$('#restore-preference').onchange = () => runOperation(() => api.updatePreferences({ restoreOnQuit: $('#restore-preference').checked }));
$('#provider-form').onsubmit = (event) => { event.preventDefault(); const url = $('#provider-url').value.trim(); try { if (new URL(url).protocol !== 'https:') throw new Error(); } catch { notify('Use a valid HTTPS URL for your search provider.', true); return; } runOperation(() => api.updatePreferences({ geocoderUrl: url }), 'Search endpoint saved.'); };
$('#reset-provider').onclick = () => { $('#provider-url').value = 'https://photon.komoot.io/api/'; runOperation(() => api.updatePreferences({ geocoderUrl: 'https://photon.komoot.io/api/' }), 'Default search endpoint restored.'); };
$('#save-form').onsubmit = async (event) => { event.preventDefault(); const label = $('#place-name').value.trim(); if (!label || !placeBeingSaved) return; const result = await runOperation(() => api.savePlace({ ...placeBeingSaved, label }), 'Place saved.'); if (result) $('#save-dialog').close(); };
$('#coordinate-form').onsubmit = (event) => { event.preventDefault(); selectPlace({ latitude: $('#latitude').value, longitude: $('#longitude').value, label: 'Custom coordinates' }); };

function setView(view) {
  currentView = view;
  renderView();
  renderSaved();
  paintIcons();
  $('.panel-scroll').scrollTo({ top: 0 });
}
$('#saved-nav-button').onclick = () => setView(currentView === 'saved' ? 'map' : 'saved');
$('#library-back').onclick = () => setView('map');
document.querySelectorAll('[data-library-tab]').forEach(button => { button.onclick = () => { libraryTab = button.dataset.libraryTab; renderSaved(); paintIcons(); }; });
$('.wordmark').onclick = (event) => { event.preventDefault(); setView('map'); };
document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => document.getElementById(button.dataset.close).close(); });
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (dialog.id === 'onboarding-dialog' && state.preferences.onboardingComplete !== true) return;
  if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); }
}));
$('#onboarding-dialog').addEventListener('cancel', (event) => { if (state.preferences.onboardingComplete !== true) event.preventDefault(); });

function openConnections() {
  closePhonePopover();
  $('#wifi-phone').value = setupPlatform || 'ios';
  $('#wifi-manual').open = !handoffPhone();
  renderConnections();
  $('#wifi-dialog').showModal();
}
$('#connection-options').onclick = openConnections;
$('#wifi-prompt-switch').onclick = $('#switch-to-wifi').onclick = switchToWifi;
$('#wifi-prompt-dismiss').onclick = () => {
  const phone = handoffPhone();
  if (phone) { dismissedWifi.add(phone.id); savePreferences({ dismissWifiPrompt: phone.id }); }
  renderConnections();
};
$('#wifi-phone').onchange = renderConnections;
$('#wifi-dialog').addEventListener('close', () => { $('#wifi-pair-code').value = ''; });
document.querySelectorAll('[data-connection]').forEach(button => {
  button.onclick = () => button.dataset.connection === 'wifi' && handoffPhone() ? switchToWifi() : runOperation(() => api.setConnection(button.dataset.connection));
});
$('#enable-iphone-wifi').onclick = () => runOperation(() => api.connectWifi({platform: 'ios', deviceId: selectedDeviceId}), 'Wi-Fi enabled. Choose Wi-Fi above to find your iPhone.');
$('#wifi-pair-form').onsubmit = async event => {
  event.preventDefault();
  const code = $('#wifi-pair-code').value;
  $('#wifi-pair-code').value = '';
  await runOperation(() => api.connectWifi({platform: 'android', endpoint: $('#wifi-pair-address').value.trim(), code}), 'Paired. Now connect using the port on the main Wireless debugging screen.');
};
$('#wifi-connect-form').onsubmit = event => {
  event.preventDefault();
  runOperation(() => api.connectWifi({platform: 'android', endpoint: $('#wifi-connect-address').value.trim()}), 'Connected. Close this panel and select your phone.');
};
$('#wifi-refresh').onclick = () => runOperation(() => api.scanDevices());

$('#search-form').onsubmit = async (event) => {
  event.preventDefault();
  const query = $('#search-input').value.trim();
  if (!query) { $('#search-input').focus(); return; }
  const coordinates = query.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (coordinates) { selectPlace({ latitude: Number(coordinates[1]), longitude: Number(coordinates[2]), label: 'Custom coordinates' }); return; }
  const request = ++searchNumber;
  $('#search-submit').disabled = true;
  $('#search-results').hidden = false;
  $('#search-results').innerHTML = `<div class="search-message">${icon('loader-circle', 'spin')} Searching…</div>`;
  paintIcons(true);
  try {
    const results = await api.searchPlaces(query);
    if (request !== searchNumber) return;
    $('#search-results').innerHTML = results.length ? results.slice(0, 7).map((place, index) => `<button class="search-result" data-result="${index}">${icon('map-pin')}<span><strong>${esc(place.label)}</strong><small>${Number(place.latitude).toFixed(5)}, ${Number(place.longitude).toFixed(5)}</small></span>${icon(locationMode === 'route' ? 'plus' : 'arrow-up-right')}</button>`).join('') + '<div class="search-attribution">Search by Photon, © OpenStreetMap</div>' : '<div class="search-message">No places found. Try a nearby city or coordinates.</div>';
    document.querySelectorAll('[data-result]').forEach((button) => { button.onclick = () => {
      const place = results[Number(button.dataset.result)];
      selectPlace(place); $('#search-input').value = place.label;
      if (locationMode === 'route' && addRouteStop(place)) notify(`Added ${place.label} as stop ${routeStops.length}.`);
    }; });
  } catch (error) {
    if (request !== searchNumber) return;
    $('#search-results').innerHTML = `<div class="search-message search-error">${icon('help-circle')}<span>${esc(error.message || 'Search is unavailable. Try again, or enter coordinates.')}</span></div>`;
  } finally {
    if (request === searchNumber) { $('#search-submit').disabled = false; paintIcons(true); }
  }
};
$('#search-input').onkeydown = (event) => { if (event.key === 'Escape') { $('#search-results').hidden = true; ++searchNumber; $('#search-submit').disabled = false; } else if (event.key === 'ArrowDown') { const first = $('.search-result'); if (first) { event.preventDefault(); first.focus(); } } };
$('#search-results').onkeydown = (event) => { const buttons = [...document.querySelectorAll('.search-result')]; const index = buttons.indexOf(document.activeElement); if (event.key === 'ArrowDown') { event.preventDefault(); buttons[Math.min(index + 1, buttons.length - 1)]?.focus(); } if (event.key === 'ArrowUp') { event.preventDefault(); if (index <= 0) $('#search-input').focus(); else buttons[index - 1]?.focus(); } if (event.key === 'Escape') { $('#search-results').hidden = true; $('#search-input').focus(); } };
document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.search-wrapper')) $('#search-results').hidden = true; });
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search-input').focus(); $('#search-input').select(); }
  if (event.key === 'Escape' && !$('#phone-popover').hidden) { closePhonePopover(); $('#phone-chip').focus(); }
});
systemDark.addEventListener('change', applyTheme);
const resizeObserver = new ResizeObserver(() => map.invalidateSize());
resizeObserver.observe($('.map-workspace'));
api.onState(acceptState);
render();
api.getState().then(async next => {
  acceptState(next);
  if (api.getRoute) {
    const planned = await api.getRoute();
    if (planned) { setRoutePlan(planned); routeStops = planned.waypoints; if (MODES[planned.mode] && planned.provider !== 'gpx') routeMode = planned.mode; drawRoute(); render(); }
  }
}).catch((error) => notify(`Wraith could not initialize: ${error.message}`, true));
