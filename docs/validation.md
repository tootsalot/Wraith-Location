# Validation

Results of checks run on real builds. Automated tests use simulated phones; real-device
results are in [hardware-test-matrix.md](hardware-test-matrix.md).

## 0.3.2 (Windows x64)

| Check | Result |
| --- | --- |
| `npm test` | All 186 unit tests pass, including the iPhone helper's new `update` method (26 sidecar tests). |
| `npm run test:renderer-session` | Passes on Electron 44.7.0: route plan/start/pause/resume, Wi-Fi prompt and handoff, live-update stability. |
| iPhone helper | Rebuilt for protocol 2; `scripts/check-resources.mjs` passes for win32-x64. |
| GPX import | A 60,000-point zigzag track with repeated timestamps imports in about 1 second (was about 246 seconds). |
| Real phone | iPhone over Wi-Fi user-observed working in a development build (October 2026). |
| Release check | `scripts/release-notes.mjs --tag v0.3.2` matches package.json and CHANGELOG.md. |

## 0.3.0 (Windows x64)

| Check | Result |
| --- | --- |
| `npm test` | All 182 unit tests pass. |
| `npm run test:renderer-session` | Passes: route plan/start/pause/resume, Wi-Fi prompt and handoff, live-update stability. |
| Packaged smoke | Passes; a connected phone was discovered, both runtimes available, live search and Valhalla planning work. |
| Real phone | The user installed the build and confirmed it works with their phone (October 2026). |
| Release check | `scripts/release-notes.mjs --tag v0.3.0` matches package.json and CHANGELOG.md. |
| Installer | `Wraith-0.3.0-win-x64.exe`, 153.9 MB (local build). SHA-256 `c192ba6916bb5e278b9bd7ac437d5a71b01cbe52ef1ef4d2791c23fe5dc10d5d`. The CI build's hash will differ. |

## 0.2.1 (Windows x64)

| Check | Result |
| --- | --- |
| `npm test` | All unit tests pass. |
| `npm run test:renderer-session` | Passes: live-update stability, route plan/start/pause/resume, Wi-Fi prompt and handoff. |
| `npm run test:native` | Passes with read-only discovery, live search and live Valhalla planning. |
| Theme switching | Dark, light and system switch in both directions with no main-process errors. |
| Windows title bar | Caption buttons draw inside Wraith's title bar in the theme colour; no native title bar. |
| Packaged smoke | Passes; a connected iPhone was discovered and both runtimes reported available. |
| Installer | `Wraith-0.2.1-win-x64.exe`, 146.7 MB; app archive 1.5 MB (was 24.3 MB). SHA-256 `a370f20707436232d3cf97f78305ee68538953477f5a09724a9f14170ecefab1`. |

## 0.2.0 (Windows x64)

| Check | Result |
| --- | --- |
| Unit tests | 157 pass, including route planning and fallback, motion, saved routes and GPX. |
| Renderer session | Passes in about 12 seconds after the test window was made visible. |
| Native smoke, development and packaged | Passes; the packaged app discovered a connected iPhone and both runtimes reported available. |
| Live routing | Valhalla routes plan in the real app; OSRM fallback is covered by tests. |
| Realistic motion, simulated | A 20-mile Chicago drive took 28 minutes with a median of 6 mph over posted limits. A 2.4-mile downtown route averaged 7.4 stops of about 13 seconds over 50 runs. |
| Installer | `Wraith-0.2.0-win-x64.exe` built with NSIS; the published asset's SHA-256 matches the local build. |
| Real device | Set location, route playback and the after-arrival flow user-observed on an iPhone (iOS 27.0.1) over USB. |

Earlier versions (0.1.x) were validated on macOS Apple Silicon and through GitHub Actions
native builds; see the git history of this file for those records.
