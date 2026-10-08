import test from 'node:test';
import assert from 'node:assert/strict';
import { Motion, MODES, findTurns, estimateSeconds, DRIVE_OVER_LIMIT_MPH, UNKNOWN_ROAD_MPH, clampSpeedMph } from '../backend/motion.mjs';
import { measurePath, distanceBetween, pointAlong, MPS_PER_MPH, simplifyPath } from '../backend/geo.mjs';

const straight = measurePath([[0, 0], [0.018, 0]]); // About 2 km.
const corner = measurePath([[0, 0], [0.0045, 0], [0.0045, 0.0045]]); // 500 m, a right angle, 500 m.
const posted30 = { spans: [[0, 1, 30 * 1.609344, 1]], signals: [] };
const mph = mps => mps / MPS_PER_MPH;
const run = (motion, seconds) => { const samples = []; for (let i = 0; i < seconds && !motion.done; i++) samples.push(motion.step(1)); return samples; };

test('constant playback keeps the original exact 45 mph motion without jitter', () => {
  const motion = new Motion(straight, posted30, { realistic: false });
  const step = motion.step(1);
  assert.ok(Math.abs(step.distance - 45 * MPS_PER_MPH) < 1e-9);
  assert.deepEqual(step.point, pointAlong(straight, step.distance));
  assert.equal(step.waiting, false);
});

test('realistic driving accelerates smoothly and cruises a few mph over the posted limit', () => {
  const motion = new Motion(straight, posted30, { mode: 'drive', realistic: true, topSpeedMph: 80, seed: 7 });
  const samples = run(motion, 70);
  assert.ok(mph(samples[0].speedMps) < 10, 'Starts from standstill.');
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].speedMps - samples[i - 1].speedMps <= MODES.drive.accel + 1e-9, 'No instant speed jumps.');
  const cruising = samples.slice(25, 60).map(s => mph(s.speedMps));
  assert.ok(Math.min(...cruising) >= 30 + 2, `cruise ${Math.min(...cruising)}`);
  assert.ok(Math.max(...cruising) <= 30 + DRIVE_OVER_LIMIT_MPH * 1.5 + 0.01, `cruise ${Math.max(...cruising)}`);
  assert.equal(samples[30].posted, true);
  assert.ok(Math.abs(mph(samples[30].limitMps) - 30) < 1e-9);
});

test('the speed slider caps realistic motion', () => {
  const motion = new Motion(straight, { spans: [[0, 1, 100, 1]], signals: [] }, { realistic: true, topSpeedMph: 25, seed: 3 });
  const samples = run(motion, 60);
  assert.ok(samples.every(s => mph(s.speedMps) <= 25 + 1e-9));
  motion.setOptions({ topSpeedMph: 15 });
  for (const s of run(motion, 20).slice(5)) assert.ok(mph(s.speedMps) <= 15 + 1e-9);
});

test('red lights stop the phone at the signal, wait, then pull away', () => {
  const signalAt = 1; const path = measurePath([[0, 0], [0.004, 0], [0.008, 0]]);
  // A random source of 0 makes every light red, uses the shortest wait and disables noise.
  const motion = new Motion(path, { spans: [[0, 2, 48, 1]], signals: [signalAt] }, { realistic: true, topSpeedMph: 60, random: () => 0 });
  const samples = run(motion, 200);
  const waiting = samples.filter(s => s.waiting);
  assert.ok(waiting.length >= MODES.drive.dwell[0] - 1, 'Waited at the light.');
  assert.ok(waiting.every(s => Math.abs(s.distance - path.cumulative[signalAt]) < 0.01 && s.speedMps === 0));
  const before = samples.indexOf(waiting[0]);
  assert.ok(samples[before - 1].speedMps < 12, 'Braked before the light.');
  assert.ok(motion.done, 'Continued to the destination.');
});

test('corners slow drivers to a believable turning speed', () => {
  assert.equal(findTurns(corner).length, 1);
  assert.ok(Math.abs(findTurns(corner)[0].angle - 90) < 1);
  const motion = new Motion(corner, { spans: [[0, 2, 72, 1]], signals: [] }, { realistic: true, topSpeedMph: 80, random: () => 0.5 });
  const samples = run(motion, 200);
  const nearTurn = samples.filter(s => Math.abs(s.distance - corner.cumulative[1]) < 15).map(s => mph(s.speedMps));
  assert.ok(nearTurn.length && Math.min(...nearTurn) < 16 && Math.max(...nearTurn) < 27, `turn speeds ${nearTurn}`);
  assert.ok(Math.max(...samples.map(s => mph(s.speedMps))) > 35, 'Faster on the straights.');
});

test('GPS jitter stays within a few metres and arrival holds the exact destination', () => {
  const motion = new Motion(straight, posted30, { realistic: true, topSpeedMph: 80, seed: 11 });
  const samples = run(motion, 400);
  for (const s of samples.slice(0, -1)) {
    const exact = pointAlong(straight, s.distance);
    assert.ok(distanceBetween([exact.longitude, exact.latitude], [s.point.longitude, s.point.latitude]) < 15);
  }
  assert.ok(motion.done);
  assert.deepEqual(samples.at(-1).point, { latitude: 0, longitude: 0.018 });
  assert.equal(samples.at(-1).speedMps, 0);
});

test('walking and cycling follow the chosen speed, and unknown roads use a city default', () => {
  for (const mode of ['walk', 'bike']) {
    const top = MODES[mode].defaultMph;
    const samples = run(new Motion(straight, null, { mode, realistic: true, topSpeedMph: top, seed: 5 }), 120).slice(30);
    const speeds = samples.filter(s => !s.waiting).map(s => mph(s.speedMps)).sort((a, b) => a - b);
    const typical = speeds[Math.floor(speeds.length / 2)];
    assert.ok(speeds.at(-1) <= top + 1e-9 && typical > top * 0.75, `${mode}: median ${typical}, max ${speeds.at(-1)}`);
  }
  const drive = run(new Motion(straight, { spans: [], signals: [] }, { realistic: true, topSpeedMph: 90, seed: 5 }), 60).slice(30);
  assert.ok(drive.every(s => mph(s.speedMps) <= UNKNOWN_ROAD_MPH + DRIVE_OVER_LIMIT_MPH * 1.5 + 0.01));
  assert.equal(clampSpeedMph('walk', 50), MODES.walk.maxMph);
});

test('recorded GPX speeds replay at the recorded pace', () => {
  const samples = run(new Motion(straight, { spans: [[0, 1, 36, 2]] }, { realistic: true, topSpeedMph: 80, seed: 2 }), 60).slice(20);
  for (const s of samples.filter(s => !s.waiting)) assert.ok(Math.abs(s.speedMps * 3.6 - 36) < 36 * 0.06);
});

test('remaining time falls as the route progresses and realistic estimates include stops', () => {
  const motion = new Motion(straight, posted30, { realistic: true, topSpeedMph: 80, seed: 4 });
  const first = motion.remainingSeconds();
  run(motion, 30);
  assert.ok(motion.remainingSeconds() < first);
  const constant = estimateSeconds(straight, posted30, { realistic: false, topSpeedMph: 45 });
  assert.ok(Math.abs(constant - straight.distanceMeters / (45 * MPS_PER_MPH)) < 1e-6);
  assert.ok(estimateSeconds(straight, posted30, { realistic: true, topSpeedMph: 80 }) > straight.distanceMeters / (40 * MPS_PER_MPH));
});

test('path simplification keeps corners and drops redundant points', () => {
  const dense = Array.from({ length: 101 }, (_, i) => [i * 0.00001, 0]).concat([[0.001, 0.001]]);
  assert.deepEqual(simplifyPath(dense, 1), [[0, 0], [0.001, 0], [0.001, 0.001]]);
});
