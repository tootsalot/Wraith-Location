import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseGpx, toGpx } from '../backend/gpx.mjs';
import { RouteLibrary } from '../backend/library.mjs';
import { normalizeRoute } from '../backend/routing.mjs';

const start = Date.parse('2026-09-01T10:00:00Z');
const trackXml = (points, extra = '') => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Lake &amp; Loop</name><trkseg>${points.map(([lat, lon, t]) => `<trkpt lon='${lon}' lat="${lat}">${t == null ? '' : `<time>${new Date(start + t * 1000).toISOString()}</time>`}</trkpt>`).join('')}</trkseg></trk>${extra}</gpx>`;
const tempDir = async t => { const dir = await mkdtemp(path.join(tmpdir(), 'ghost-routes-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('GPX tracks import as exact paths with recorded speeds', () => {
  // About 11.1 m per point, one point every second: 40 km/h.
  const points = Array.from({ length: 60 }, (_, i) => [0, i * 0.0001, i]);
  const parsed = parseGpx(trackXml(points));
  assert.equal(parsed.kind, 'track');
  assert.equal(parsed.name, 'Lake & Loop');
  assert.equal(parsed.route.provider, 'gpx');
  assert.deepEqual(parsed.route.coordinates, [[0, 0], [0.0059, 0]], 'Straight runs are simplified.');
  assert.deepEqual(parsed.route.profile.spans, [[0, 1, 40, 2]]);
  assert.deepEqual(parsed.route.waypoints.map(w => w.label), ['Track start', 'Track end']);
  const route = normalizeRoute({ ...parsed.route, mode: 'bike' });
  assert.equal(route.mode, 'bike');
});

test('GPX without times, short GPX routes, and invalid files are handled', () => {
  const untimed = parseGpx(trackXml([[1, 1], [1, 1], [1.001, 1.001], [1.002, 1]]));
  assert.deepEqual(untimed.route.profile.spans, []);
  assert.equal(untimed.route.coordinates.length, 3, 'Duplicate points are removed.');
  const stops = parseGpx('<gpx><rte><rtept lat="1" lon="2"><name>A</name></rtept><rtept lat="1.5" lon="2.5"/></rte></gpx>');
  assert.deepEqual(stops, { kind: 'stops', name: null, stops: [{ latitude: 1, longitude: 2, label: 'A' }, { latitude: 1.5, longitude: 2.5, label: 'Stop 2' }] });
  assert.throws(() => parseGpx('<kml></kml>'), /not a GPX/);
  assert.throws(() => parseGpx('<gpx><trk><trkpt lat="91" lon="0"/><trkpt lat="0" lon="0"/></trk></gpx>'), /at least two points/);
  assert.throws(() => parseGpx(''), /empty/);
});

test('GPX export escapes names and re-imports to the same path', () => {
  const route = normalizeRoute({ mode: 'walk', provider: 'valhalla', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]], waypoints: [{ latitude: 0, longitude: 0, label: '<Start & "go">' }, { latitude: 0.001, longitude: 0.001, label: 'End' }], profile: { spans: [] } });
  const xml = toGpx(route, 'My <route>');
  assert.match(xml, /<name>My &lt;route&gt;<\/name>/);
  assert.match(xml, /&lt;Start &amp; &quot;go&quot;&gt;/);
  assert.ok(!xml.includes('<Start'));
  assert.deepEqual(parseGpx(xml).route.coordinates, route.coordinates);
});

test('stored routes are validated before they can drive a phone', () => {
  const base = { coordinates: [[0, 0], [0.001, 0]], waypoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }] };
  assert.equal(normalizeRoute(base).mode, 'drive');
  for (const profile of [{ spans: [[0, 2, 50, 1]] }, { spans: [[0, 1, -5, 1]] }, { spans: [[0, 1, 50, 7]] }, { spans: [], signals: [9] }, { spans: [], signals: 'x' }]) {
    assert.throws(() => normalizeRoute({ ...base, profile }));
  }
  assert.throws(() => normalizeRoute({ ...base, coordinates: [[0, 0], [0, 95]] }));
  assert.throws(() => normalizeRoute({ ...base, waypoints: [base.waypoints[0]] }));
});

test('route library saves full routes to disk, renames, deletes and survives restarts', async t => {
  const file = path.join(await tempDir(t), 'routes.json');
  const library = new RouteLibrary(file);
  assert.deepEqual(await library.load(), []);
  const route = normalizeRoute({ mode: 'bike', provider: 'valhalla', coordinates: [[0, 0], [0.001, 0], [0.001, 0.001]], waypoints: [{ latitude: 0, longitude: 0, label: 'A' }, { latitude: 0.001, longitude: 0.001, label: 'B' }], profile: { spans: [[0, 2, 30, 1]], signals: [1] } });
  const saved = await library.save(route, '  Commute  ');
  assert.notEqual(saved.id, route.id);
  await library.rename(saved.id, 'Morning ride');
  const reopened = new RouteLibrary(file);
  const list = await reopened.load();
  assert.deepEqual(list.map(r => [r.name, r.mode, r.stops]), [['Morning ride', 'bike', 2]]);
  const loaded = reopened.get(saved.id);
  assert.deepEqual(loaded.coordinates, route.coordinates);
  assert.deepEqual(loaded.profile, route.profile);
  await reopened.delete(saved.id);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).routes, []);
  assert.throws(() => reopened.get(saved.id), /no longer exists/);
});

test('a damaged route library is backed up instead of overwritten, and bad entries are skipped', async t => {
  const dir = await tempDir(t), file = path.join(dir, 'routes.json');
  await writeFile(file, '{not json');
  const library = new RouteLibrary(file);
  assert.deepEqual(await library.load(), []);
  assert.match(library.warning, /backup/);
  assert.ok((await readdir(dir)).some(name => name.startsWith('routes.json.backup-')));
  await writeFile(file, JSON.stringify({ schemaVersion: 1, routes: [{ name: 'Broken', coordinates: [[0, 0]], waypoints: [] }, { name: 'Good', coordinates: [[0, 0], [0.001, 0]], waypoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }] }] }));
  const second = new RouteLibrary(file);
  assert.deepEqual((await second.load()).map(r => r.name), ['Good']);
  assert.match(second.warning, /skipped/);
});

test('controller saves, loads, imports and exports routes without touching the phone', async t => {
  const { Controller } = await import('../backend/controller.mjs');
  const { defaults } = await import('../backend/store.mjs');
  const library = new RouteLibrary(path.join(await tempDir(t), 'routes.json'));
  const planned = normalizeRoute({ mode: 'drive', provider: 'valhalla', coordinates: [[0, 0], [0.001, 0]], waypoints: [{ latitude: 0, longitude: 0, label: 'Home' }, { latitude: 0, longitude: 0.001, label: 'Work' }], profile: { spans: [] } });
  const adapter = { status: async () => ({ available: true }), list: async () => [], dispose: async () => {}, set: () => assert.fail('No phone command expected.') };
  const c = new Controller({ adapters: { ios: adapter }, library, store: { load: async () => defaults(), save: async () => {} }, router: { plan: async () => structuredClone(planned) } });
  t.after(() => c.dispose({ restore: false }));
  await c.init();
  await assert.rejects(c.saveRoute(), /Plan or import/);
  assert.throws(() => c.exportGpx(), /Plan, load or import/);
  await c.planRoute({ waypoints: planned.waypoints, mode: 'drive' });
  await c.saveRoute({ name: 'Commute' });
  assert.deepEqual(c.state.savedRoutes.map(r => r.name), ['Commute']);
  const loaded = await c.loadSavedRoute(c.state.savedRoutes[0].id);
  assert.deepEqual(loaded.coordinates, planned.coordinates);
  assert.equal(c.getRoute().id, loaded.id);
  const exported = c.exportGpx();
  assert.equal(exported.name, 'Commute');
  const imported = await c.importGpx(exported.gpx, { mode: 'walk' });
  assert.equal(imported.route.mode, 'walk'); assert.equal(imported.route.provider, 'gpx');
  assert.deepEqual(imported.route.coordinates, planned.coordinates);
  const stops = await c.importGpx('<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1.5" lon="2.5"/></rte></gpx>');
  assert.equal(stops.stops.length, 2);
  await c.renameSavedRoute({ id: c.state.savedRoutes[0].id, name: 'Old commute' });
  assert.equal(c.state.savedRoutes[0].name, 'Old commute');
  await c.deleteSavedRoute(c.state.savedRoutes[0].id);
  assert.deepEqual(c.state.savedRoutes, []);
});
