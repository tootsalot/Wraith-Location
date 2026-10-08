# Changelog

## Unreleased

- Add natural drift for held places: the reported location wanders slowly by a few metres around the exact spot, like real GPS. Choose Off, Subtle (default) or Normal in Settings. It also applies at a route's destination after arrival.
- Add wander mode: walk real footpaths between random spots inside a circle, lingering 30 seconds to 3 minutes at each, with an adjustable radius and walking pace. Falls back to straight lines when routing is unavailable.
- Add desktop notifications for route arrival, a phone needing attention, a route pausing itself and a phone reconnecting, each with its own switch plus a master switch. Shown only when Wraith isn't the active window.
- Restart drift after switching a held place to Wi-Fi.
- Resolve six Dependabot alerts in build tools (shell-quote, source-map-js, brace-expansion, http-cache-semantics).
- Add `.env.example` for local development keys.

## 0.2.1

- Fix a main-process error dialog when switching between dark and light themes on Windows.
- Use Windows' own caption buttons inside Wraith's title bar, replacing the separate native title bar.
- Ignore map clicks while a route is running, so the hidden place pin no longer moves.
- Stop packaging the source of libraries that are already bundled into the interface: the app archive drops from 24 MB to 1.5 MB.
- Read the version shown in Settings from the build, and reserve title-bar space for window buttons only on macOS.
- Rename the remaining internal identifiers and environment variables to Wraith (`WRAITH_*`), and move the project to tootsalot/Wraith-Location.

## 0.2.0

- Redesign the interface (Spectral): dark and light themes that follow the system, with a choice in Settings; a focused side panel; the phone in a title-bar menu; saved places and routes in a Library; and a playback bar showing speed, speed limit, traffic lights ahead, time left and Restore.
- Fix Set location being disabled for phones connected over Wi-Fi.
- Fix map overlays drawing over the phone menu and search results, and the selected pin covering route stop markers.
- Repaint less: icons are re-scanned only when new ones render, and closed dialogs no longer re-render every second.
- Make the renderer test reliable by showing its window, so screenshots no longer hang.
- Rename the app to Wraith, with a new icon and app identity.
- Make traffic-light stops less frequent and shorter: about one red in four, usually 5–15 seconds, fewer reds just after stopping, and one light per junction.
- Unlock route planning, saved routes and Fixed location after a route arrives. The phone keeps holding the destination, and **New route from here** starts the next route at the current point.
- Add Drive, Bike and Walk modes with a per-mode top-speed slider that can change while a route runs.
- Add realistic motion, on by default: posted speed limits (about 5 mph over for drivers), smooth acceleration and braking, slowing for corners, traffic-light stops, pace variation and correlated GPS drift. Turning it off gives exact constant-speed playback.
- Plan with the FOSSGIS Valhalla service for speed limits and traffic signals, falling back to OSRM.
- Click the map to add stops; drag (or Alt+arrow) to reorder; drag markers to move stops. Search results add stops directly in Route mode.
- Save routes with their full path, and import/export GPX. Timed GPX tracks replay at their recorded speeds.
- Fix first-run setup reopening on every launch: settings now load before the window opens.
- Remember **Stay on USB** for the Wi-Fi switch prompt across launches.

## 0.1.7

- Offer Switch to Wi-Fi after a working USB session when the computer has an active Wi-Fi interface.
- Replace the active-session connection lock with a same-phone handoff that carries the current point and resumes a running route.
- Keep USB active during wireless discovery; try USB recovery if the new Wi-Fi session fails.
- Add USB-assisted Android Wi-Fi setup and keep manual Android 11+ pairing available.
- Add handoff, recovery, host-network and renderer regression coverage. Physical Wi-Fi handoff still needs device validation.

## 0.1.6

- Add explicit USB and same-network Wi-Fi connection modes on Mac and Windows.
- Enable trusted iPhone Wi-Fi connections after a one-time USB setup; iOS 17.4+ required.
- Pair Android 11+ using Wireless debugging, with separate pairing and connection ports.
- Preserve Android phone identity across changed Wi-Fi ports and reject reused addresses belonging to another phone.
- Keep fixed-location refreshes and one-second route updates over Wi-Fi; pause routes on connection loss.
- Add guided setup, pairing-code cleanup, transport and UI tests. Physical Wi-Fi validation remains pending.

## 0.1.5

- Plan driving routes through 2–12 ordered map/search stops using OSRM and OpenStreetMap roads.
- Move along the full road geometry at 45 mph, sending a coordinate update every second from the Electron main process.
- Add a route line, moving location dot, distance, remaining time, Pause, Resume, and destination hold.
- Pause motion on disconnect, sleep, or delayed USB writes. Same-phone reconnect holds the last attempted point until explicit Resume; Restore cancels playback.
- Reuse the live iPhone connection and Android helper for moving targets without repeating setup every second.
- Add route geometry, timer, lifecycle, adapter, renderer, and real routing-service checks. These do not establish physical phone behavior.

## 0.1.4

- Add a first-run survey for Mac/Windows and iPhone/Android, with a focused USB
  setup checklist for each of the four combinations.
- Save the selected setup locally and make it available again from Setup and Settings.
- Replace the dense green studio interface with a larger, neutral map-first layout,
  restrained glass controls, standard icons, system typography, and clearer status text.
- Exercise all four setup guides in the isolated native smoke test without sending
  phone location commands.

## 0.1.3

- Accept Android 14's nonzero `am stopservice` result only after `dumpsys`
  confirms that both location services stopped.
- Allow Google's official 32-bit Windows `adb.exe` on Windows x64 while keeping
  the bundled Windows iPhone sidecar check strictly x64.
- Verify the real Android adapter and Appium Settings helper on an Android 14
  emulator with two location targets, helper readback, and cleanup. This is
  component coverage; physical USB acceptance still requires an Android phone.

## 0.1.2

- Automatically discard an unresolved `unknown`, `waiting`, or `error` recovery
  record when a different usable USB phone is discovered, allowing the new phone
  to be prepared and have a location set without manual journal cleanup.
- Cancel pending retries and reset the old adapter transport when that record is
  discarded. Wraith does not send Restore to the absent old phone, which may retain
  its simulated location until it is restarted or restored separately.
- Keep `active`, `applying`, `reconnecting`, and `stopping` sessions protected from
  automatic replacement.

## 0.1.1

- Reassert the fixed iPhone location on a one-second loop with awaited DVT command acknowledgements; show acknowledgement time and count without claiming a phone-app GPS measurement.
- Preserve a healthy iPhone connection during discovery polling while fresh acknowledgements continue. Android's helper emits timestamped fixes every two seconds; desktop status identifies helper readback separately.
- Recover the same device and applied target after USB replug within the same running Wraith process. Allow same-phone retry and target updates after a connection failure; application restart still requires manual Retry or Restore.
- Make Restore cancel automatic reconnection, including while offline or recovery is pending, and preserve focused controls during state updates.

These are implementation changes validated with software checks and controlled
transports. They do not establish physical Set/Update/Restore behavior or
phone-app compatibility; see `docs/hardware-test-matrix.md`.
