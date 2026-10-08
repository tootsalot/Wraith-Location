# Wraith

A small Electron app for setting a fixed phone location or following a road route over USB or Wi-Fi. Search for a
place, drop a pin, or enter coordinates, then explicitly apply it to your selected
phone. Windows and macOS share one interface and use the appropriate iPhone or
Android adapter.

Current version: **0.2.0**. See [CHANGELOG.md](CHANGELOG.md) for realistic routes,
travel modes, saved routes, GPX, and earlier changes.

Wraith is a modified version of [Ghost](https://github.com/Blueturboguy07/ghost-location)
by the Ghost contributors, renamed and extended by Tootsalot. Like Ghost, it is free
software under the GNU GPL v3 or later; see [License](#license).

![Wraith following an example road route in Chicago](docs/images/ghost-route.png)

*Route mode in the original Ghost interface, using an example phone and sample Chicago route.*

## Build and run locally

Wraith has no prebuilt downloads yet. On Windows or macOS, with Node.js 24 LTS and npm:

```sh
npm ci
npm run runtime:prepare
npm run pack
```

`npm run pack` creates a ready-to-run app in `release/` (`release/win-unpacked/Wraith.exe`
on Windows). `npm run dist` builds an installer instead (`Wraith-0.2.0-win-x64.exe`).
Rebuild with `npm run pack` after pulling changes. The `release/` folder is not committed.

Building the iPhone runtime needs Python 3.12 or 3.13. If it isn't installed, `uv` can
provide one without a system-wide install:

```sh
uv python install 3.12
GHOST_BUILD_PYTHON="$(uv python find 3.12)" npm run runtime:prepare
```

In PowerShell, set the variable with `$env:GHOST_BUILD_PYTHON = (uv python find 3.12)` first.

Then follow the [setup guide](SETUP.md) for Mac → iPhone, Windows → iPhone, Mac → Android,
or Windows → Android. The first time a packaged Wraith starts, it copies saved places,
setup choices and saved routes from an existing Ghost installation; Ghost's own files are
left untouched.

## Features


- Drive, bike or walk routes through up to 12 stops, with one-second updates, Pause and Resume.
- Realistic motion: posted speed limits (drivers run about 5 mph over), slowing for corners, real traffic-light stops, natural pace changes and GPS drift. It can be switched off for exact constant-speed playback.
- A top-speed slider for each travel mode, adjustable while a route runs.
- After arrival, plan another route, start one from the phone's current position, or set a fixed location, all without restoring real GPS first.
- Click the map to add stops, drag stops to reorder or move them, and save routes (full path) to replay later. GPX tracks import and export.
- Interactive map, manual place search, draggable pin, and latitude/longitude input.
- First-run Mac/Windows and iPhone/Android survey with a checklist tailored to all four USB configurations.
- Saved places and recent selections stored locally.
- A one-click USB → Wi-Fi handoff keeps the current location and resumes routes. Wraith offers it after a working USB session when the computer has Wi-Fi. Android 11+ also supports cable-free pairing.
- iPhone location simulation through a bundled pymobiledevice3 sidecar.
- Android location simulation through bundled ADB and Appium Settings.
- Ongoing fixed-location updates and same-phone reconnection while Wraith stays open.
- Automatic stale recovery-record cleanup when a different usable USB phone appears.
- Explicit restoration, normal-quit cleanup, and a persisted recovery journal.
- Honest disconnected/error states: lost connectivity never means “restored”.
- No account, telemetry, analytics, or cloud location history.

## Development

Use Node.js 24 LTS and npm. Python 3.12 or 3.13 is needed only to **build** the iPhone
runtime. End users of a complete packaged release do not install Python, Node.js,
Android Studio, or Appium Server.

```sh
npm ci
npm run runtime:prepare
npm run dev
```

`GHOST_BUILD_PYTHON` can point to a specific Python executable. A runtime build can
download public Python packages, Apple-device support dependencies, Google's
platform tools, and the Android helper. Driver installation and changes to phone
settings are performed through the setup flow, not by the build scripts.

For a browser-only interface preview: `npm run preview`. Hardware controls are only
available inside Electron. For a production renderer inside Electron: `npm start`.

## Device setup

On first launch, choose the computer and phone you use. Wraith saves that choice
locally and shows only the relevant setup checklist. Open **Setup** in the toolbar
or **Change** in Settings to review or switch configurations later.

**iPhone (initial target: iOS 17.4+):** connect with a USB data cable, unlock and
trust the computer, enable Developer Mode in Settings → Privacy & Security, and
restart when requested. Use Wraith's Prepare action to mount the developer support
image. Initial preparation requires internet and can take a few minutes. Windows
also needs Apple's USB services/drivers (upstream recommends Microsoft Store
iTunes). The application does not remove passcodes or change Find My settings.

**Android (8.0+):** enable Developer options and USB debugging, connect a USB data
cable, and approve the computer's RSA prompt. Wraith's explicit Prepare action
installs Appium Settings, grants location access, and selects it as the mock-location
provider. Follow any additional device-specific prompts. Some Windows phones need
the manufacturer's ADB USB driver. No root is required by this approach.

## Session behavior

Selecting a map pin only changes the preview. **Set location** starts or updates a
fixed location on the selected phone. Only one unresolved phone session is
kept at a time. When an unknown, waiting, or error recovery record belongs to a
different phone and Wraith discovers another usable USB phone, Wraith automatically
discards the old record so the newly connected phone can be prepared or have a
location set.
Active, applying, reconnecting, and stopping sessions remain protected from this
automatic cleanup.

On iPhone, the sidecar reasserts the selected coordinates on a one-second loop.
Each DVT location command is awaited before Wraith records its acknowledgement.
Fresh acknowledgements also keep the selected USB connection ready during
discovery polling, so a transient discovery miss does not gray out a healthy
session. On Android, the on-phone helper emits timestamped mock fixes every two
seconds; the desktop checks the helper's reported coordinates.

The interface distinguishes command acknowledgements from helper readbacks.
An iOS acknowledgement confirms the developer command, and an Android readback
confirms the helper's coordinates. Neither proves a fresh GPS reading in a phone
app. The Android receiver does not expose the fix timestamp to the desktop.
Verify the result in the intended phone app.

**Restore** stops the Android mock service or sends the iOS clear-location command.
The iOS clear API does not return an independent real-GPS measurement; cached
locations in other apps can take time to update. Normal quit attempts restoration
by default. If that fails, Wraith offers to keep the app open or quit with an
unresolved session saved for recovery.

If the phone disconnects during a live session, Wraith waits and automatically reconnects
the **same phone and applied target** when it becomes available again, while the
same Wraith process remains open. Selecting another pin still changes only the
preview; use **Update location** to apply that target. You can also use **Retry
location** or **Reconnect & set location** on the same phone after a connection
failure. While the previous session is active, applying, reconnecting, or stopping,
a different phone remains blocked.

If that previous session is already unresolved as unknown, waiting, or error,
connecting a different usable USB phone automatically removes the old recovery
record instead. This does not send **Restore** to the old phone. Because the old
phone is absent or cannot be verified, it may retain its last simulated location
until it is restarted or restored separately.

**Restore** cancels automatic reconnection, including while the cable is absent.
If reconnection is already in progress, Wraith waits for that bounded operation
before clearing the simulation. An unplugged phone must reconnect before Wraith
can send the clear command.

USB unplug, laptop sleep, force-quit, and a crashed helper cannot guarantee immediate
restoration. Android's upstream helper can keep supplying its last coordinates
without the cable. After Wraith restarts, continuing or clearing a saved session on
the same phone requires a manual **Retry location** or **Restore**; it is never
automatically resumed on startup. A different usable phone instead triggers the
unresolved-record cleanup described above.
An iPhone restart is a further recovery step if its developer simulation becomes
stuck.

## Route playback

Choose **Route** and a travel mode (**Drive**, **Bike** or **Walk**). Click the map to
add stops in order, or use search or coordinates and **Add selected pin to route**
(in Route mode, choosing a search result adds it directly). Drag stops in the list,
or press Alt+Up/Down, to reorder them; drag numbered markers to move them.
**Plan route** previews the path and an estimated time. **Start route** moves the
selected phone to the first point and begins playback.

Wraith plans with the open-source [Valhalla](https://github.com/valhalla/valhalla)
service run by FOSSGIS on OpenStreetMap data, then reads the road attributes along
the path: posted speed limits where mapped, estimated road speeds elsewhere, and
traffic signals. If Valhalla is unavailable, Wraith falls back to
[OSRM](https://github.com/Project-OSRM/osrm-backend) (with estimated limits and no
signal data). Pins snap to roads or paths within 1 km; if no connected route exists,
planning fails instead of drawing a straight line.

With **Realistic motion** on (the default), drivers cruise about 5 mph over the
posted limit (3–9 mph as the pace drifts), never above the **Top speed** slider.
They accelerate and brake smoothly, slow for corners based on their sharpness, and
stop at roughly one traffic light in four, usually for 5–15 seconds and at most 30.
A red is less likely just after stopping, as on coordinated signals. Without signal
data, occasional stops are placed at sharp junctions and on slower roads. Cyclists and walkers
move a little below the slider speed and wait at crossings. Reported positions
drift a few metres like real GPS, and arrival holds the exact destination. With
realism off, the phone moves at exactly the slider speed. The slider and the
toggle can change while a route runs. Location commands run every second in the
desktop backend, including while the window is minimized. The blue dot shows the
last sent point, not an independently measured phone position. Android reuses
Appium Settings' immediate update on each new target; its idle heartbeat remains
two seconds.

**Pause** holds the last point. **Resume** continues from standstill. Arrival holds the
exact destination and unlocks route editing: plan another route, choose **New route
from here** to start from the phone's current point, load a saved route, or switch
to **Fixed location**, all without returning the phone to its real GPS position.
**Restore real location** stops simulation. Disconnect and sleep
pause motion. Reconnection holds the last attempted point on the same phone until
you press Resume. Slow commands or scheduling stalls pause rather than building a
backlog or jumping ahead. Timings depend on the operating system and connection latency;
the app does not guarantee that every phone app consumes each fix.

Route progress stays in memory. Restarting Wraith does not resume a route; it keeps
the existing recovery record for Retry or Restore. Wait for arrival or Restore
before editing a running or paused route, and Restore before changing phones.

### Saved routes and GPX

The bookmark button under **Saved routes** stores the planned route, including its
full path and road data, in `routes.json` beside the settings file. A saved route
replays without contacting the routing service. **Import GPX** turns a track into a
ready route that follows the recorded path exactly; tracks with timestamps replay at
their recorded speeds when realistic motion is on. A GPX route of up to 12 points
becomes stops to plan. **Export GPX** writes the stops and the full path.

## Maps, search, and privacy

Search sends your submitted text to the configured Photon provider. Viewing the map
requests tiles from OpenStreetMap. Device identifiers and saved/session coordinates
stay in the local application settings file. Planning a route sends the chosen
stop coordinates (without device identifiers) to the public Valhalla service, and
the resulting path back to it for road attributes, or to OSRM as a fallback. Route
playback, saved routes and GPX files make no routing-service requests. Search is rate-limited and cached for
the running app; there is no autocomplete, background geocoding, or offline tile
download. Pin and coordinate selection remain available if search fails.

The default Photon public demo is appropriate only for moderate use and has no
availability guarantee. Change the HTTPS Photon API endpoint in Settings for a
larger public deployment. See THIRD_PARTY_NOTICES.md.

The FOSSGIS Valhalla and OSRM demo services are for reasonable noncommercial use,
with no uptime guarantee. Wraith contacts them only on **Plan route**, spacing its
requests a second apart. See [OSRM's demo policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).
A larger public deployment needs its own routing service instead of relying on these.

## Build installers

```sh
npm test
npm run build
npm run runtime:prepare
npm run pack
npm run dist
```

Build on each target operating system. macOS Apple Silicon, macOS Intel and Windows
x64 use matching Python sidecars and ADB resources. Windows ARM is not a supported
release target yet. The packaging check refuses to produce an app with missing
device runtimes. Release installers are unsigned. Signing/notarization credentials are required
for a trusted macOS launch and a recognized Windows publisher.
No publishing or repository upload is performed by these commands.

For v0.2.0, a macOS arm64 build produces `Wraith-0.2.0-mac-arm64.dmg` and
`Wraith-0.2.0-mac-arm64.zip` in `release/`.

### Native CI builds

`.github/workflows/build.yml` defines separate native jobs for Windows x64
(`windows-2025`), macOS Apple Silicon (`macos-15`), and macOS Intel
(`macos-15-intel`). Each uses pinned Node.js 24.18.0 and Python 3.12.10, installs
the npm lockfile with `npm ci`, builds both phone runtimes, runs tests, and produces
unsigned installers. Action implementations are pinned to commit hashes.
The Python pin is the latest 3.12 build available for these macOS/Windows targets
in GitHub's `actions/python-versions` manifest; newer 3.12 entries there are Linux-only.

The prepack check verifies executable CPU types, the actual iOS executable and
Python bundle, Android helper version/checksum, ADB files/checksums, license notices,
and device-free launch smoke checks. Native target matching is required because
electron-builder's `${platform}` resource macro resolves to `darwin` or `win32`
from its build host. Cross-platform packaging and Windows ARM are excluded.

CI uploads installers and provenance as workflow artifacts only; it does not
publish a GitHub release, upload to a store, or use signing credentials. Passing
CI does not verify real phones. Complete the hardware test matrix before claiming
phone/OS compatibility.

## Validation

`npm test` checks USB filtering, exact-device targeting, argument handling,
adapter failures, acknowledgement handling, fixed-target refresh, same-process
reconnection, cancellation, persisted crash recovery, concurrency,
search validation, saved settings, route interpolation, Valhalla/OSRM planning and
fallback, realistic motion (limits, corners, signals, drift, speed caps), arrival
unlock, saved routes, GPX import/export, one-second scheduling,
pause/resume, arrival, slow transport, and cancellation during an in-flight update. Sidecar-specific Python tests are in
`sidecar/` where applicable. See docs/hardware-test-matrix.md for on-device checks.

`npm run test:ios-stream` runs a hardware-free stress harness through the real
Node adapter, JSONL bridge loop, Python bridge, and pinned upstream location API.
It replaces only the USB/tunnel/DVT peer, then checks repeated acknowledgements,
an in-place target update, concurrent discovery, and post-Restore silence.

`npm run test:native` launches Electron with isolated settings and exercises map
search, live Valhalla road planning, coordinates, saved-place create/rename/delete, setup, preferences, and a
compact window. It performs read-only USB discovery but never invokes phone
preparation, Set, or Restore. Screenshots are written to `artifacts/`. It requires
a graphical desktop; live search and map tiles need internet access.

`npm run test:renderer-session` runs a separate, bounded Electron fixture with no
device adapters and all external requests blocked. Ten real-time heartbeats span
more than eight seconds, checking that Update stays enabled, the pending pin and
selected phone persist, focus is retained, recovery restores the controls, and
only an explicit Update submits the new target. It also checks route stop selection,
plan/start/pause/resume controls, and a moving map dot with fake device state. It uses existing Electron and
Playwright dependencies, temporary settings, and a 45-second deadline; no phone
runtime or network access is needed.

To check an already packaged app, set `GHOST_SMOKE_EXECUTABLE` to its executable and
run `node scripts/smoke-electron.mjs`. The check also requires both bundled runtimes
to report available. See docs/validation.md for the recorded local build results.

Automated transport tests use controlled doubles; they are not evidence of phone
compatibility. The project must be tested on actual target phone/OS combinations
before claiming all four connections are verified.

## License

GPL-3.0-or-later. See LICENSE and THIRD_PARTY_NOTICES.md.

Wraith is based on [Ghost](https://github.com/Blueturboguy07/ghost-location), copyright
the Ghost contributors, and is distributed under the same license. Tootsalot modified it
in October 2026 (version 0.2.0): renamed it to Wraith, added realistic route motion,
travel modes, saved routes, GPX support and route editing after arrival, and changed
the routing provider. The full history of changes is in this repository's git log.
"Ghost" is the upstream project's name; Wraith is not affiliated with or endorsed by it.

For wireless setup, see [the Wi-Fi guide](SETUP.md#connect-over-the-same-wi-fi-network-017). Wi-Fi support is implemented and covered by automated tests; physical phone validation is still needed.
