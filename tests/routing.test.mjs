import test from 'node:test';
import assert from 'node:assert/strict';
import { Router, measurePath, pointAlong, distanceBetween, ROUTE_SPEED_MPS, encodePolyline, decodePolyline } from '../backend/routing.mjs';
import { Controller } from '../backend/controller.mjs';
import { defaults } from '../backend/store.mjs';

const close = (a, b, epsilon = 0.001) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
const path = measurePath([[0, 0], [0.001, 0], [0.001, 0.001]]);
const plan = { id: 'road', coordinates: path.coordinates, distanceMeters: path.distanceMeters, durationSeconds: path.distanceMeters / ROUTE_SPEED_MPS, waypoints: [{latitude: 0, longitude: 0, label: 'Start'}, {latitude: 0.001, longitude: 0.001, label: 'End'}] };

test('45 mph advances 20.1168 metres each second along segments, including corners', () => {
  close(ROUTE_SPEED_MPS, 20.1168, 1e-12);
  const before = pointAlong(path, ROUTE_SPEED_MPS * 5);
  assert.equal(before.latitude, 0);
  close(distanceBetween([0, 0], [before.longitude, before.latitude]), 100.584);
  const after = pointAlong(path, ROUTE_SPEED_MPS * 6);
  close(after.longitude, 0.001, 1e-9);
  close(path.cumulative[1] + distanceBetween([0.001, 0], [after.longitude, after.latitude]), 120.7008);
  assert.deepEqual(pointAlong(path, 10000), {latitude: 0.001, longitude: 0.001});
});
test('duplicate points, start clamp, and dateline crossing do not create jumps', () => {
  const repeated = measurePath([[0, 0], [0, 0], [0.001, 0]]);
  assert.deepEqual(pointAlong(repeated, -100), {latitude: 0, longitude: 0});
  close(pointAlong(repeated, repeated.distanceMeters / 2).longitude, 0.0005, 1e-9);
  const dateline = measurePath([[179.999, 0], [-179.999, 0]]);
  close(Math.abs(pointAlong(dateline, dateline.distanceMeters / 2).longitude), 180, 1e-9);
  assert.throws(() => measurePath([[0, 0], [0, 0]]), /different/);
  for (const coordinates of [[], [[0, 0], [181, 0]], [[0, 0], [0, NaN]], [[0, 0], ['1', 0]]]) assert.throws(() => measurePath(coordinates));
});
const valhallaRoute = {trip: {status: 0, summary: {length: 0.22, time: 30}, legs: [{shape: encodePolyline(path.coordinates)}]}};
const valhallaAttributes = {shape: encodePolyline(path.coordinates), edges: [
  {begin_shape_index: 0, end_shape_index: 1, speed_limit: 48, speed: 40, end_node: {traffic_signal: true}},
  {begin_shape_index: 1, end_shape_index: 2, speed: 30, traffic_signal: false},
]};
const json = body => new Response(JSON.stringify(body));

test('polyline6 encoding round-trips route geometry', () => {
  const coordinates = [[-87.6298, 41.8781], [-87.623301, 41.882705], [179.999999, -0.000001]];
  assert.deepEqual(decodePolyline(encodePolyline(coordinates)), coordinates);
});
test('Valhalla plans ordered stops with posted limits, estimated speeds and traffic signals', async () => {
  const calls = [], waits = [];
  const router = new Router({now: () => 1000, wait: async ms => waits.push(ms), fetcher: async (url, options) => {
    calls.push([url, JSON.parse(options.body)]);
    return json(url.endsWith('/route') ? valhallaRoute : valhallaAttributes);
  }});
  const result = await router.plan(plan.waypoints, {mode: 'bike'});
  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /valhalla1\.openstreetmap\.de\/route$/);
  assert.equal(calls[0][1].costing, 'bicycle');
  assert.deepEqual(calls[0][1].locations.map(l => [l.lat, l.lon, l.search_cutoff]), [[0, 0, 1000], [0.001, 0.001, 1000]]);
  assert.match(calls[1][0], /trace_attributes$/);
  assert.equal(calls[1][1].shape_match, 'edge_walk');
  assert.ok(waits[0] >= 1000, 'Requests to the public server are spaced by a second.');
  assert.equal(result.provider, 'valhalla'); assert.equal(result.mode, 'bike');
  assert.deepEqual(result.profile.spans, [[0, 1, 48, 1], [1, 2, 30, 0]]);
  assert.deepEqual(result.profile.signals, [1]);
  close(result.distanceMeters, path.distanceMeters);
  assert.ok(result.durationSeconds > 0);
  await assert.rejects(router.plan(plan.waypoints), /Wait a second/);
  assert.equal(calls.length, 2);
});
test('missing Valhalla road attributes keep the route with an estimated speed', async () => {
  const router = new Router({wait: async () => {}, fetcher: async url => url.endsWith('/route') ? json(valhallaRoute) : new Response('busy', {status: 503})});
  const result = await router.plan(plan.waypoints);
  assert.equal(result.provider, 'valhalla');
  assert.deepEqual(result.profile.spans, [[0, 2, 29, 0]]);
  assert.equal(result.profile.signals, undefined);
});
test('OSRM is the fallback when Valhalla is unavailable, with recovered limits for drivers', async () => {
  for (const [mode, host] of [['drive', 'router.project-osrm.org'], ['walk', 'routing.openstreetmap.de/routed-foot']]) {
    const calls = [];
    const router = new Router({wait: async () => {}, fetcher: async url => {
      calls.push(url);
      if (url.includes('valhalla')) return new Response('down', {status: 502});
      return json({code: 'Ok', routes: [{geometry: {type: 'LineString', coordinates: path.coordinates}, legs: [{annotation: {speed: [10.7, 0]}}]}]});
    }});
    const result = await router.plan(plan.waypoints, {mode});
    const url = new URL(calls[1]);
    assert.ok(calls[1].includes(host), calls[1]);
    assert.match(url.pathname, /driving\/0,0;0.001,0.001/);
    assert.equal(url.searchParams.get('overview'), 'full');
    assert.equal(url.searchParams.get('annotations'), 'speed');
    assert.equal(result.provider, 'osrm');
    // 10.7 m/s is OSRM's 80% of a 30 mph street.
    assert.deepEqual(result.profile.spans, mode === 'drive' ? [[0, 1, 48, 0]] : []);
  }
});
test('no-route, HTTP, malformed response and invalid stops fail without a straight-line fallback', async () => {
  for (const response of [new Response('', {status: 503}), new Response('{'), new Response(JSON.stringify({code: 'NoRoute'})), new Response(JSON.stringify({code: 'Ok', routes: [{geometry: {type: 'LineString', coordinates: [[0, 0], [0, 91]]}}]}))]) {
    await assert.rejects(new Router({fetcher: async () => response}).plan(plan.waypoints));
  }
  const router = new Router({fetcher: () => assert.fail('Invalid stops reached the network')});
  for (const stops of [null, [], [plan.waypoints[0]], Array(13).fill(plan.waypoints[0]), [{latitude: 91, longitude: 0}, plan.waypoints[1]]]) await assert.rejects(router.plan(stops));
});

async function fixture(t, platform = 'ios', connection = 'usb') {
  const phone = { id: `${platform}:USB123`, serial: 'USB123', platform, name: 'Test phone', connection, state: 'ready' };
  let timestamp = 0, devices = [phone];
  const calls = [], data = defaults(); data.preferences.connection = connection;
  const store = {load: async () => structuredClone(data), save: async value => { calls.push(['persist']); Object.assign(data, structuredClone(value)); }};
  const adapter = {status: async () => ({available: true}), list: async () => devices,
    set: async (device, point) => { calls.push(['set', device.id, {...point}]); return {}; },
    update: async (device, point) => { calls.push(['update', device.id, {...point}]); return {}; },
    clear: async () => calls.push(['clear']), reset: async () => calls.push(['reset']), dispose: async () => {}};
  const c = new Controller({adapters: {[platform]: adapter}, store, router: {plan: async () => structuredClone(plan)}, clock: () => timestamp, now: () => Date.parse('2026-09-13T12:00:00Z') + timestamp});
  await c.init(); await c.planRoute(plan.waypoints);
  t.after(() => c.dispose({restore: false}));
  const start = () => c.startRoute({deviceId: phone.id, routeId: plan.id});
  return {c, phone, adapter, calls, data, start, advance: ms => { timestamp += ms; }, disconnect: () => {devices = [];}, reconnect: () => {devices = [phone];}, replace: () => {devices = [{...phone, id: `${platform}:SECOND`, serial: 'SECOND'}];}};
}

for (const connection of ['usb', 'wifi']) for (const platform of ['ios', 'android']) test(`${platform} ${connection} route sends one point per second, preserves session, and holds exact endpoint`, async t => {
  const f = await fixture(t, platform, connection); await f.start();
  const id = f.c.state.session.id; f.calls.length = 0;
  for (let second = 1; second <= 12; second++) { f.advance(1000); await f.c.tickRoute(); }
  assert.equal(f.c.state.route.status, 'completed');
  const updates = f.calls.filter(c => c[0] === 'update');
  assert.equal(updates.length, 12);
  assert.ok(updates.every(c => c[1] === f.phone.id && c[2].sessionId === id));
  close(distanceBetween([0, 0], [updates[0][2].longitude, updates[0][2].latitude]), ROUTE_SPEED_MPS);
  assert.equal(f.c.state.session.latitude, 0.001); assert.equal(f.c.state.session.longitude, 0.001);
  assert.equal(f.c.state.busy, false); assert.equal(f.c.state.session.status, 'active');
  assert.equal(f.calls.filter(c => c[0] === 'persist').length, 1, 'Only arrival journals, not every tick');
  await f.c.tickRoute(); assert.equal(f.calls.filter(c => c[0] === 'update').length, 12);
  await f.c.stopLocation(); assert.equal(f.c.state.route, null); assert.equal(f.c.state.session, null);
});
test('backend timer sends updates independently of renderer events', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(t); await f.start();
  for (let i = 0; i < 6; i++) { f.advance(1000); t.mock.timers.tick(1000); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(f.calls.filter(c => c[0] === 'update').length, 6);
});
test('pause holds location and resume excludes paused time from speed', async t => {
  const f = await fixture(t); await f.start();
  f.advance(1000); await f.c.tickRoute();
  await f.c.pauseRoute(); const point = {...f.c.state.route.point};
  f.advance(60000); await f.c.tickRoute(); assert.deepEqual(f.c.state.route.point, point);
  await f.c.resumeRoute(); f.advance(1000); await f.c.tickRoute();
  close(f.c.state.route.traveledMeters, ROUTE_SPEED_MPS * 2);
});
test('disconnect and sleep pause progress; reconnect holds the last point until explicit resume', async t => {
  const f = await fixture(t); await f.start(); f.advance(1000); await f.c.tickRoute();
  await f.c.sessionEnded({deviceId: f.phone.id, error: 'Cable removed'});
  f.disconnect(); f.advance(30000); await f.c.scanDevices(); await f.c.tickRoute();
  assert.equal(f.c.state.route.status, 'paused'); close(f.c.state.route.traveledMeters, ROUTE_SPEED_MPS);
  f.reconnect(); await f.c.scanDevices();
  assert.equal(f.c.state.session.status, 'active'); assert.equal(f.c.state.route.status, 'paused');
  await f.c.resumeRoute(); f.advance(1000); await f.c.tickRoute(); close(f.c.state.route.traveledMeters, 2 * ROUTE_SPEED_MPS);
  await f.c.suspend(); f.advance(30000); await f.c.resume();
  assert.equal(f.c.state.route.status, 'paused'); close(f.c.state.route.traveledMeters, 2 * ROUTE_SPEED_MPS);
});
test('failed initial route can resume through manual reconnect, without getting stuck', async t => {
  const f = await fixture(t); const set = f.adapter.set;
  f.adapter.set = async () => {throw new Error('USB lost');};
  await assert.rejects(f.start()); assert.equal(f.c.state.route.status, 'paused');
  f.adapter.set = set; await f.c.resumeRoute(); assert.equal(f.c.state.route.status, 'running');
});
test('slow transport and long scheduling stalls pause instead of queueing or jumping', async t => {
  const f = await fixture(t); await f.start();
  let finish; f.adapter.update = () => new Promise(resolve => {finish = resolve;});
  f.advance(1000); const tick = f.c.tickRoute();
  await f.c.tickRoute(); // No concurrent write.
  f.advance(1500); finish({}); await tick;
  assert.equal(f.c.state.route.status, 'paused'); close(f.c.state.route.traveledMeters, ROUTE_SPEED_MPS);
  await f.c.resumeRoute(); f.advance(60000); await f.c.tickRoute();
  assert.equal(f.c.state.route.status, 'paused'); close(f.c.state.route.traveledMeters, ROUTE_SPEED_MPS);
});
test('Restore waits for an in-flight update, then clears without a late restart', async t => {
  const f = await fixture(t); await f.start(); let finish;
  f.adapter.update = () => new Promise(resolve => {finish = resolve;});
  f.advance(1000); const tick = f.c.tickRoute(); const stop = f.c.stopLocation();
  assert.ok(!f.calls.some(c => c[0] === 'clear')); finish({});
  await Promise.all([tick, stop]);
  assert.equal(f.c.state.session, null); assert.equal(f.c.state.route, null); assert.equal(f.c.routeTimer, null);
});
test('failed update or late acknowledgement cannot hide transport loss, and a new phone never receives the route', async t => {
  const f = await fixture(t); await f.start();
  f.adapter.update = async () => {await f.c.sessionEnded({deviceId: f.phone.id, error: 'Lost USB'}); return {};};
  f.advance(1000); await f.c.tickRoute();
  assert.equal(f.c.state.session.status, 'waiting'); assert.equal(f.c.state.route.status, 'paused');
  f.replace(); await f.c.scanDevices();
  assert.equal(f.c.state.route, null); assert.equal(f.c.state.session, null);
  assert.equal(f.calls.filter(c => c[0] === 'set').length, 1);
});
test('unplanned routes and changed endpoints cannot bypass route planning', async t => {
  const f = await fixture(t);
  await assert.rejects(f.c.startRoute({deviceId: f.phone.id, routeId: 'other'}), /Plan the route/);
  await f.start(); await assert.rejects(f.c.planRoute(plan.waypoints), /restore real location/);
  await assert.rejects(f.start(), /Restore real location/);
});

test('arrival unlocks planning, another route and fixed locations without restoring real location', async t => {
  const f = await fixture(t); await f.start();
  for (let second = 1; second <= 12; second++) { f.advance(1000); await f.c.tickRoute(); }
  assert.equal(f.c.state.route.status, 'completed');
  assert.match(f.c.state.route.message, /Plan another route/);
  assert.equal((await f.c.planRoute({waypoints: plan.waypoints, mode: 'drive'})).id, plan.id);
  await f.c.startRoute({deviceId: f.phone.id, routeId: plan.id});
  assert.equal(f.c.state.route.status, 'running');
  assert.equal(f.c.state.session.status, 'active');
  for (let second = 1; second <= 12; second++) { f.advance(1000); await f.c.tickRoute(); }
  await f.c.applyLocation({deviceId: f.phone.id, latitude: 1, longitude: 1, label: 'Fixed after arrival'});
  assert.equal(f.c.state.route, null);
  assert.equal(f.c.state.session.label, 'Fixed after arrival');
  assert.equal(f.calls.filter(c => c[0] === 'clear').length, 0, 'The phone never jumped back to real GPS.');
  assert.deepEqual(f.c.state.recentPlaces.map(p => p.label), ['Fixed after arrival'], 'Route starts are not recent places.');
});

test('a running or paused route still locks route changes', async t => {
  const f = await fixture(t); await f.start();
  await assert.rejects(f.c.planRoute({waypoints: plan.waypoints, mode: 'walk'}), /restore real location/);
  await assert.rejects(f.c.importGpx('<gpx></gpx>'), /restore real location/);
  await f.c.pauseRoute();
  await assert.rejects(f.c.planRoute(plan.waypoints), /restore real location/);
  await assert.rejects(f.start(), /Restore real location/);
});

test('realistic options flow into playback and can change while the route runs', async t => {
  const f = await fixture(t);
  await f.c.startRoute({deviceId: f.phone.id, routeId: plan.id, realistic: true, topSpeedMph: 12});
  assert.equal(f.c.state.route.realistic, true); assert.equal(f.c.state.route.topSpeedMph, 12);
  assert.match(f.c.state.route.message, /realistic/);
  for (let second = 1; second <= 8; second++) { f.advance(1000); await f.c.tickRoute(); }
  assert.ok(f.c.state.route.speedMph <= 12 + 1e-9);
  assert.ok(f.c.state.route.traveledMeters > 0);
  await f.c.updateRouteOptions({realistic: false, topSpeedMph: 45});
  const before = f.c.state.route.traveledMeters;
  f.advance(1000); await f.c.tickRoute();
  close(f.c.state.route.traveledMeters - before, ROUTE_SPEED_MPS);
  await assert.rejects(f.c.startRoute({deviceId: f.phone.id, routeId: plan.id, realistic: 'yes'}), /Restore real location|Invalid/);
  await assert.rejects(f.c.updateRouteOptions({topSpeedMph: 'fast'}), /Invalid route speed/);
});

test('settings load before discovery and route preferences are validated', async () => {
  const data = defaults(); data.preferences.onboardingComplete = true;
  let scans = 0;
  const adapter = {status: async () => { scans++; return {available: true}; }, list: async () => [], dispose: async () => {}};
  const c = new Controller({adapters: {ios: adapter}, store: {load: async () => structuredClone(data), save: async () => {}}});
  assert.equal(c.snapshot().loaded, false);
  const loaded = await c.load();
  assert.equal(loaded.loaded, true); assert.equal(loaded.preferences.onboardingComplete, true); assert.equal(scans, 0);
  assert.equal(loaded.preferences.realisticMotion, true); assert.equal(loaded.preferences.routeMode, 'drive');
  await c.updatePreferences({routeMode: 'walk', realisticMotion: false, routeSpeeds: {walk: 99}, dismissWifiPrompt: 'ios:A'});
  assert.equal(c.state.preferences.routeSpeeds.walk, 8);
  assert.deepEqual(c.state.preferences.dismissedWifiPrompts, ['ios:A']);
  for (const bad of [{routeMode: 'fly'}, {realisticMotion: 1}, {routeSpeeds: {drive: 'x'}}, {routeSpeeds: {boat: 5}}]) await assert.rejects(c.updatePreferences(bad));
  await c.dispose({restore: false});
});
