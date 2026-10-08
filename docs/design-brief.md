# Wraith design brief

Status: version 0.3.0. See `validation.md` for what has been checked and
`hardware-test-matrix.md` for real-device results.

## Product

Wraith is a free, open-source Electron app for Windows, macOS and Linux that sets an iPhone's or
Android phone's location from a computer, over USB or Wi-Fi.

- One phone session at a time: hold a place, or follow a route.
- Routes run through up to 12 ordered stops as a drive, bike ride or walk, sending a
  position every second.
- Realistic motion is the default: posted limits (drivers about 5 mph over), corner
  slowing, occasional traffic-light stops, pace drift and GPS-like position noise. It can
  be turned off for exact constant speed.
- After arrival the phone holds the destination and route editing unlocks without
  restoring real GPS.
- Saved places and routes (full geometry) are local; GPX imports and exports.

## Architecture

One Electron interface handles the map, search, phone selection, setup guidance and session
status. Device control stays in the main process, isolated from remote map and search content.

- **iPhone:** a bundled, persistent `pymobiledevice3` sidecar (`wraith-ios`) with a structured
  stdio protocol. It reasserts the location every second and awaits each DVT acknowledgement.
  Initial target is iOS 17.4+.
- **Android:** bundled ADB and unmodified Appium Settings, installed and configured only by the
  explicit Prepare action. The helper emits mock fixes every two seconds; the desktop reads
  back its coordinates.
- **Routing:** the public FOSSGIS Valhalla service plans the path and supplies posted limits,
  road speeds and traffic signals; OSRM is the fallback. Planning happens only on an explicit
  Plan; playback is local.
- **Motion:** `backend/motion.mjs` is a pure, seedable model shared by the backend (playback)
  and the renderer (time estimates).

## Behaviour defaults

- Selecting a pin changes only the preview; Set location, Update location or Start route
  changes the phone.
- One unresolved session at a time. An `unknown`, `waiting` or `error` record for a different
  phone is discarded when another usable phone appears; `active`, `applying`, `reconnecting`
  and `stopping` sessions stay protected.
- A disconnected phone is reconnected automatically to the same target while Wraith stays open.
  After a restart, Retry or Restore is manual.
- Restore cancels automatic reconnection and waits for any in-progress recovery. Quit restores
  by default; failures leave a recovery record.
- Discarding an old record never sends Restore to the old phone, which may keep its simulated
  location until restarted or restored.

## Interface: Spectral

- **Palette:** deep violet surfaces (`#141126`, `#1a1631`) with a lavender accent (`#c9b8ff`) in
  dark; a pale violet light theme (`#f3f0fb`, accent `#6a4be0`). Tokens live in `src/style.css`
  and follow the system or the Settings choice.
- **Type:** Geologica, bundled locally (no web fonts at runtime).
- **Layout:** title bar with search, phone menu, setup and settings; a side panel that switches
  between Place and Route, with a Library view; the map with tinted OpenStreetMap tiles.
- **The one bold element:** the playback bar along the bottom of the map: speed against the
  limit, a progress line with a mark for each traffic light, time left and Restore.

## Known constraints

- The Android helper can keep supplying its last coordinates after disconnect.
- A disconnected iPhone cannot receive a clear command; Wraith shows the state as unverified
  rather than restored.
- Acknowledgements and readbacks are not proof of what a phone app displays.
- First-time iPhone preparation needs internet for developer support files.
- Public map, search and routing services have usage limits and attribution requirements.
- Installers are unsigned until signing credentials are configured.

## References

- [pymobiledevice3](https://github.com/doronz88/pymobiledevice3)
- [Appium Settings mock locations](https://github.com/appium/io.appium.settings#setting-mock-locations)
- [Valhalla](https://github.com/valhalla/valhalla) and [OSRM](https://github.com/Project-OSRM/osrm-backend)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
