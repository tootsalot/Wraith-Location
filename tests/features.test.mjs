import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../backend/controller.mjs';
import { defaults } from '../backend/store.mjs';
import { GpsDrift, DRIFT_LEVELS, seededRandom } from '../backend/motion.mjs';
import { distanceBetween, measurePath } from '../backend/geo.mjs';

const meters = (a, b) => distanceBetween([a.longitude, a.latitude], [b.longitude, b.latitude]);
const anchor = { latitude: 41.8917, longitude: -87.6078 };

// A straight line between the requested stops stands in for a footpath.
const straightRouter = (calls = []) => ({
  plan: async stops => { calls.push(stops); return { id: `leg-${calls.length}`, mode: 'walk', provider: 'valhalla', waypoints: stops, coordinates: stops.map(s => [s.longitude, s.latitude]), profile: { spans: [] }, distanceMeters: 0 }; },
});

async function fixture(t, { platform = 'ios', router = straightRouter(), preferences = {} } = {}) {
  const phone = { id: `${platform}:USB1`, serial: 'USB1', platform, name: 'Test phone', connection: 'usb', state: 'ready' };
  let clock = 0, devices = [phone];
  const calls = [], alerts = [], data = defaults();
  Object.assign(data.preferences, preferences);
  const adapter = {
    status: async () => ({ available: true }), list: async () => devices, dispose: async () => {},
    set: async (device, point) => { calls.push(['set', { ...point }]); return {}; },
    update: async (device, point) => { calls.push(['update', { ...point }]); return {}; },
    clear: async () => calls.push(['clear']), reset: async () => calls.push(['reset']),
  };
  const c = new Controller({ adapters: { [platform]: adapter }, store: { load: async () => structuredClone(data), save: async () => {} }, router, random: seededRandom(7), clock: () => clock, now: () => Date.parse('2026-10-08T12:00:00Z') + clock });
  c.on('alert', alert => alerts.push(alert));
  await c.init();
  t.after(() => c.dispose({ restore: false }));
  const advance = ms => { clock += ms; };
  return { c, phone, adapter, calls, alerts, advance, updates: () => calls.filter(call => call[0] === 'update').map(call => call[1]), disconnect: () => { devices = []; }, reconnect: () => { devices = [phone]; } };
}

test('GPS drift is zero when off, stays within a few metres, and moves smoothly', () => {
  const off = new GpsDrift({ sigma: DRIFT_LEVELS.off, random: seededRandom(1) });
  for (let i = 0; i < 50; i++) off.step(1);
  assert.deepEqual(off.apply(anchor), anchor);
  const drift = new GpsDrift({ sigma: DRIFT_LEVELS.subtle, random: seededRandom(2) });
  let previous = anchor, largest = 0, largestStep = 0;
  for (let i = 0; i < 1800; i++) {
    drift.step(1);
    const point = drift.apply(anchor);
    largest = Math.max(largest, meters(anchor, point));
    largestStep = Math.max(largestStep, meters(previous, point));
    previous = point;
  }
  assert.ok(largest > 1 && largest < DRIFT_LEVELS.subtle * 5, `largest offset ${largest}`);
  assert.ok(largestStep < 3, `largest one-second jump ${largestStep}`);
});

test('a held place drifts around its exact anchor, and Off returns the phone to it', async t => {
  const f = await fixture(t);
  await f.c.applyLocation({ deviceId: f.phone.id, ...anchor, label: 'Navy Pier' });
  assert.ok(f.c.drift, 'Drift starts once the location is confirmed.');
  assert.deepEqual(f.c.state.session.anchor, anchor);
  assert.match(f.c.state.session.message, /natural GPS drift/);
  for (let i = 0; i < 30; i++) { f.advance(1000); await f.c.tickDrift(); }
  const updates = f.updates();
  assert.equal(updates.length, 30);
  assert.ok(updates.every(point => meters(anchor, point) < 15));
  assert.ok(updates.some(point => meters(anchor, point) > 0.5), 'The point actually moves.');
  assert.deepEqual(f.c.state.session.anchor, anchor, 'The anchor never moves.');
  await f.c.updatePreferences({ drift: 'off' });
  assert.equal(f.c.drift, null);
  assert.deepEqual(f.updates().at(-1), { ...anchor, sessionId: f.c.state.session.id });
  await f.c.updatePreferences({ drift: 'normal' });
  assert.ok(f.c.drift);
  assert.equal(f.c.drift.sigma, DRIFT_LEVELS.normal);
  await f.c.stopLocation();
  assert.equal(f.c.drift, null);
});

test('drift is off when the preference says so and pauses during disconnects', async t => {
  const f = await fixture(t, { preferences: { drift: 'off' } });
  await f.c.applyLocation({ deviceId: f.phone.id, ...anchor });
  assert.equal(f.c.drift, null);
  await f.c.updatePreferences({ drift: 'subtle' });
  assert.ok(f.c.drift);
  await f.c.sessionEnded({ deviceId: f.phone.id, error: 'Cable removed' });
  assert.equal(f.c.drift, null);
  await f.c.scanDevices();
  assert.equal(f.c.state.session.status, 'active');
  assert.ok(f.c.drift, 'Drift resumes after the automatic reconnect.');
  for (const bad of [{ drift: 'wild' }, { notifications: { enabled: 'yes' } }, { notifications: { sms: true } }]) await assert.rejects(f.c.updatePreferences(bad));
});

test('notifications fire for arrival, attention, automatic pauses and reconnects', async t => {
  const f = await fixture(t);
  const route = { id: 'r1', mode: 'drive', provider: 'valhalla', waypoints: [{ ...anchor, label: 'Start' }, { latitude: 41.8927, longitude: -87.6078, label: 'Pier end' }], coordinates: [[anchor.longitude, anchor.latitude], [-87.6078, 41.8927]], profile: { spans: [] }, distanceMeters: 111 };
  f.c.usePlannedRoute(route);
  await f.c.startRoute({ deviceId: f.phone.id, routeId: 'r1', realistic: false, topSpeedMph: 45 });
  for (let i = 0; i < 8; i++) { f.advance(1000); await f.c.tickRoute(); }
  assert.equal(f.c.state.route.status, 'completed');
  assert.equal(f.alerts.at(-1).type, 'arrived');
  assert.match(f.alerts.at(-1).body, /Pier end/);
  assert.deepEqual(f.c.state.session.anchor, { latitude: 41.8927, longitude: -87.6078 });
  assert.ok(f.c.drift, 'The arrived destination drifts like any held place.');
  await f.c.sessionEnded({ deviceId: f.phone.id, error: 'Cable removed' });
  assert.equal(f.alerts.at(-1).type, 'attention');
  await f.c.scanDevices();
  assert.equal(f.alerts.at(-1).type, 'reconnected');
  await f.c.suspend();
  assert.notEqual(f.alerts.at(-1).type, 'attention', 'No alert while the computer is going to sleep.');
});

test('a stalled route raises an automatic-pause alert', async t => {
  const f = await fixture(t);
  f.c.usePlannedRoute({ id: 'r2', mode: 'drive', provider: 'valhalla', waypoints: [{ ...anchor }, { latitude: 41.9, longitude: -87.6078 }], coordinates: [[anchor.longitude, anchor.latitude], [-87.6078, 41.9]], profile: { spans: [] }, distanceMeters: 900 });
  await f.c.startRoute({ deviceId: f.phone.id, routeId: 'r2', realistic: false });
  f.advance(5000); await f.c.tickRoute();
  assert.equal(f.c.state.route.status, 'paused');
  assert.equal(f.alerts.at(-1).type, 'autoPaused');
});

test('wander mode walks footpaths between spots inside the circle and lingers at each', async t => {
  const calls = [];
  const f = await fixture(t, { router: straightRouter(calls) });
  await assert.rejects(f.c.startWander({ deviceId: f.phone.id, ...anchor, radiusMeters: 10 }), /radius/);
  await f.c.startWander({ deviceId: f.phone.id, ...anchor, radiusMeters: 200, topSpeedMph: 3 });
  const route = f.c.state.route;
  assert.equal(route.kind, 'wander'); assert.equal(route.status, 'running'); assert.equal(route.phase, 'lingering');
  assert.ok(f.c.routeLocked(), 'Wandering owns the phone like a route.');
  assert.equal(f.c.state.recentPlaces.length, 0, 'A wander centre is not a recent place.');
  await f.c.wander.planning;
  assert.equal(calls.length, 1);
  const points = [];
  for (let second = 0; second < 900; second++) {
    f.advance(1000);
    await f.c.tickRoute();
    if (f.c.wander?.planning) await f.c.wander.planning;
    points.push({ ...f.c.state.session });
  }
  assert.ok(route.spotsVisited >= 2, `visited ${route.spotsVisited}`);
  assert.ok(route.walkedMeters > 0);
  assert.ok(points.every(point => meters(anchor, point) <= 200 * 1.5 + 50), 'Never leaves the area.');
  assert.ok(calls.every(stops => stops.length === 2), 'Each leg is planned on its own.');
  await f.c.pauseRoute();
  assert.equal(route.status, 'paused');
  await f.c.resumeRoute();
  assert.equal(route.status, 'running');
  await f.c.updateRouteOptions({ topSpeedMph: 2 });
  assert.equal(route.topSpeedMph, 2);
  await f.c.stopLocation();
  assert.equal(f.c.state.route, null); assert.equal(f.c.wander, null);
});

test('wander keeps moving in a straight line when footpaths are unavailable', async t => {
  const f = await fixture(t, { router: { plan: async () => { throw new Error('offline'); } } });
  await f.c.startWander({ deviceId: f.phone.id, ...anchor, radiusMeters: 150 });
  await f.c.wander.planning;
  f.advance(1000); await f.c.tickRoute();
  assert.equal(f.c.state.route.phase, 'walking');
  assert.match(f.c.state.route.message, /footpaths are unavailable/);
  assert.equal(measurePath(f.c.routePath.coordinates).coordinates.length, 2);
});
