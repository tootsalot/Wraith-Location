// Route motion model. Pure and seedable: the backend drives playback with it and
// the renderer imports it to estimate durations before a route starts.
import { MPS_PER_MPH, bearing, offsetPoint, pointAlong } from './geo.mjs';

// Typical drivers sit a little above the posted limit.
export const DRIVE_OVER_LIMIT_MPH = 6;
export const CONSTANT_SPEED_MPH = 45;
// Assumed limit where neither the routing service nor a recording gives a speed.
export const UNKNOWN_ROAD_MPH = 35;

export const MODES = Object.freeze({
  drive: Object.freeze({ label: 'Drive', verb: 'Driving', minMph: 5, maxMph: 100, defaultMph: 70, accel: 2.0, decel: 2.8, lateral: 2.2, signalChance: 0.28, dwell: [4, 30], jitter: 2.2 }),
  bike: Object.freeze({ label: 'Bike', verb: 'Cycling', minMph: 3, maxMph: 30, defaultMph: 14, accel: 0.8, decel: 1.6, lateral: 1.8, signalChance: 0.28, dwell: [4, 25], jitter: 2.6, cruise: [0.78, 0.96] }),
  walk: Object.freeze({ label: 'Walk', verb: 'Walking', minMph: 1, maxMph: 8, defaultMph: 3.2, accel: 0.7, decel: 1.2, lateral: 0, signalChance: 0.3, dwell: [4, 25], jitter: 3, cruise: [0.86, 1] }),
});

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clampSpeedMph(mode, mph) {
  const spec = MODES[mode] || MODES.drive;
  return Number.isFinite(mph) ? Math.min(spec.maxMph, Math.max(spec.minMph, mph)) : spec.defaultMph;
}

const TURN_WINDOW = 15, TURN_MIN_DEGREES = 8, CLUSTER_METERS = 20;

// Corners from geometry: the heading change across a short window gives a radius,
// and a comfortable lateral acceleration gives the corner speed.
export function findTurns(path) {
  const turns = [];
  const { cumulative, coordinates, distanceMeters } = path;
  for (let i = 1; i < coordinates.length - 1; i++) {
    const at = cumulative[i];
    if (at < TURN_WINDOW || at > distanceMeters - TURN_WINDOW) continue;
    if (cumulative[i + 1] - cumulative[i - 1] < 0.5) continue;
    const before = pointAlong(path, at - TURN_WINDOW), after = pointAlong(path, at + TURN_WINDOW);
    const inHeading = bearing([before.longitude, before.latitude], coordinates[i]);
    const outHeading = bearing(coordinates[i], [after.longitude, after.latitude]);
    const angle = Math.abs(((outHeading - inHeading + 540) % 360) - 180);
    if (angle < TURN_MIN_DEGREES) continue;
    const radius = 2 * TURN_WINDOW / (angle * Math.PI / 180);
    const last = turns.at(-1);
    if (last && at - last.at < CLUSTER_METERS) {
      if (radius < last.radius) Object.assign(last, { at, angle, radius });
    } else turns.push({ at, angle, radius });
  }
  return turns;
}

function buildZones(path, profile) {
  const zones = [];
  let cursor = 0;
  // Span kinds: 0 estimated road speed, 1 posted limit, 2 speed recorded in a GPX track.
  for (const [start, end, limitKph, kind] of profile?.spans || []) {
    const from = path.cumulative[start], to = path.cumulative[end];
    if (!(to > from) || from < cursor - 0.01) continue;
    if (from > cursor) zones.push({ from: cursor, to: from, limitMps: null, posted: false });
    zones.push({ from, to, limitMps: limitKph ? limitKph / 3.6 : null, posted: kind === 1, recorded: kind === 2 });
    cursor = to;
  }
  if (cursor < path.distanceMeters) zones.push({ from: cursor, to: path.distanceMeters, limitMps: null, posted: false });
  return zones;
}

export class Motion {
  constructor(path, profile = null, options = {}) {
    this.path = path;
    this.mode = MODES[options.mode] ? options.mode : 'drive';
    this.spec = MODES[this.mode];
    this.random = options.random || seededRandom(options.seed ?? Math.floor(Math.random() * 2 ** 32));
    this.realistic = Boolean(options.realistic);
    this.topSpeedMps = clampSpeedMph(this.mode, options.topSpeedMph ?? CONSTANT_SPEED_MPH) * MPS_PER_MPH;
    this.distance = 0; this.speed = 0; this.dwell = 0; this.factor = 1; this.east = 0; this.north = 0;
    this.zones = buildZones(path, profile);
    this.signalData = Array.isArray(profile?.signals);
    this.turns = this.spec.lateral ? findTurns(path) : [];
    this.stops = this.buildStops(profile);
    this.zoneIndex = 0; this.turnIndex = 0; this.stopIndex = 0;
  }
  get done() { return this.distance >= this.path.distanceMeters; }
  between(min, max) { return min + (max - min) * this.random(); }
  gaussian() { return Math.sqrt(-2 * Math.log(1 - this.random())) * Math.cos(2 * Math.PI * this.random()); }
  buildStops(profile) {
    const candidates = [], total = this.path.distanceMeters;
    if (this.signalData) {
      for (const index of profile.signals) candidates.push({ at: this.path.cumulative[index], chance: this.spec.signalChance });
    } else {
      // Without signal data, assume controlled junctions at sharp corners and
      // occasional lights or crossings on slower roads.
      for (const turn of this.turns) if (turn.angle >= 60) candidates.push({ at: turn.at, chance: 0.3 });
      for (const zone of this.zones) {
        if (this.mode === 'drive' && zone.limitMps != null && zone.limitMps > 22) continue;
        for (let at = zone.from + this.between(300, 900); at < zone.to; at += this.between(500, 1300)) candidates.push({ at, chance: 0.15 });
      }
    }
    candidates.sort((a, b) => a.at - b.at);
    const stops = [];
    let lastCandidate = -Infinity;
    for (const { at, chance } of candidates) {
      // Wide junctions are often mapped as two signal points; treat them as one light.
      const sameJunction = at - lastCandidate < 40;
      lastCandidate = at;
      if (at < 5 || at > total - 5 || sameJunction) continue;
      // Lights are often coordinated, so a red is less likely just after stopping.
      const greenWave = stops.length && at - stops.at(-1).at < 300 ? 0.5 : 1;
      if (this.random() < chance * greenWave) {
        // Most waits are short; a few catch the full cycle.
        const [shortest, longest] = this.spec.dwell;
        stops.push({ at, dwell: shortest + (longest - shortest) * this.random() ** 2 });
      }
    }
    return stops;
  }
  setOptions({ realistic, topSpeedMph } = {}) {
    if (realistic != null) this.realistic = Boolean(realistic);
    if (topSpeedMph != null) this.topSpeedMps = clampSpeedMph(this.mode, topSpeedMph) * MPS_PER_MPH;
  }
  // Resume from standstill after a pause or reconnect.
  halt() { this.speed = 0; }
  zoneAt(distance) {
    while (this.zoneIndex < this.zones.length - 1 && this.zones[this.zoneIndex].to <= distance) this.zoneIndex++;
    return this.zones[this.zoneIndex];
  }
  findZone(distance) {
    let lo = 0, hi = this.zones.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.zones[mid].to <= distance) lo = mid + 1; else hi = mid; }
    return this.zones[lo];
  }
  cruiseFor(zone, factor = this.factor) {
    const top = this.topSpeedMps;
    if (zone?.recorded && zone.limitMps != null) return Math.max(0.5, Math.min(top, zone.limitMps * (1 + 0.1 * (factor - 1))));
    if (this.mode === 'drive') {
      if (zone?.limitMps == null) return Math.min(top, (UNKNOWN_ROAD_MPH + DRIVE_OVER_LIMIT_MPH * factor) * MPS_PER_MPH);
      return Math.min(top, zone.limitMps + DRIVE_OVER_LIMIT_MPH * MPS_PER_MPH * factor);
    }
    const [low, high] = this.spec.cruise;
    const ratio = low + (high - low) * Math.min(1, Math.max(0, (factor - 0.75) / 0.75));
    const cruise = top * ratio;
    return zone?.posted && this.mode === 'bike' ? Math.min(cruise, zone.limitMps) : cruise;
  }
  turnSpeed(turn) { return Math.sqrt(this.spec.lateral * turn.radius); }
  // Highest speed now that still lets us slow comfortably for everything ahead.
  allowedSpeed() {
    const d = this.distance, decel = this.spec.decel, total = this.path.distanceMeters;
    const horizon = d + this.topSpeedMps ** 2 / (2 * decel) + 30;
    const limit = (gap, v) => Math.sqrt(v * v + 2 * decel * Math.max(0, gap));
    let allowed = limit(total - d + 0.5, 0);
    while (this.turnIndex < this.turns.length && this.turns[this.turnIndex].at < d - 1) this.turnIndex++;
    for (let i = this.turnIndex; i < this.turns.length && this.turns[i].at <= horizon; i++) allowed = Math.min(allowed, limit(this.turns[i].at - d, this.turnSpeed(this.turns[i])));
    const stop = this.stops[this.stopIndex];
    if (stop && stop.at <= horizon) allowed = Math.min(allowed, limit(stop.at - d + 0.5, 0));
    for (let i = this.zoneIndex + 1; i < this.zones.length && this.zones[i].from <= horizon; i++) allowed = Math.min(allowed, limit(this.zones[i].from - d, this.cruiseFor(this.zones[i])));
    return allowed;
  }
  updateNoise(h) {
    // Slowly wandering driver tempo and spatially correlated GPS error.
    this.factor = Math.min(1.5, Math.max(0.75, this.factor + 0.05 * (1 - this.factor) * h + 0.08 * Math.sqrt(h) * this.gaussian()));
    const tau = 10, sigma = this.spec.jitter, kick = sigma * Math.sqrt(2 * h / tau);
    this.east += -this.east / tau * h + kick * this.gaussian();
    this.north += -this.north / tau * h + kick * this.gaussian();
  }
  step(seconds) {
    const total = this.path.distanceMeters;
    if (!this.realistic) {
      this.distance = Math.min(total, this.distance + this.topSpeedMps * seconds);
      this.speed = this.done ? 0 : this.topSpeedMps; this.dwell = 0;
      return this.result(false);
    }
    let remaining = seconds;
    while (remaining > 1e-9 && !this.done) {
      const h = Math.min(0.25, remaining); remaining -= h;
      this.updateNoise(h);
      if (this.dwell > 0) { this.dwell = Math.max(0, this.dwell - h); this.speed = 0; continue; }
      const target = Math.min(this.cruiseFor(this.zoneAt(this.distance)), this.allowedSpeed());
      this.speed = this.speed < target ? Math.min(target, this.speed + this.spec.accel * h) : Math.max(target, this.speed - 2 * this.spec.decel * h);
      let next = this.distance + this.speed * h;
      while (this.stops[this.stopIndex] && this.stops[this.stopIndex].at < this.distance - 0.01) this.stopIndex++;
      const stop = this.stops[this.stopIndex];
      if (stop && next >= stop.at - 0.3) { next = Math.max(this.distance, stop.at); this.speed = 0; this.dwell = stop.dwell; this.stopIndex++; }
      this.distance = Math.min(total, next);
    }
    if (this.done) { this.speed = 0; this.dwell = 0; }
    return this.result(true);
  }
  result(jitter) {
    const exact = pointAlong(this.path, this.distance);
    const zone = this.findZone(this.distance);
    return {
      distance: this.distance,
      speedMps: this.speed,
      waiting: this.dwell > 0,
      limitMps: zone?.limitMps ?? null,
      posted: Boolean(zone?.posted),
      point: jitter && !this.done ? offsetPoint(exact, this.east, this.north) : exact,
    };
  }
  remainingSeconds() {
    const d = this.distance, total = this.path.distanceMeters;
    if (!this.realistic) return (total - d) / this.topSpeedMps;
    const { accel, decel } = this.spec, recovery = 1 / accel + 1 / decel;
    let seconds = this.dwell;
    for (const zone of this.zones) {
      const length = Math.min(zone.to, total) - Math.max(zone.from, d);
      if (length > 0) seconds += length / this.cruiseFor(zone, 1);
    }
    for (let i = this.turnIndex; i < this.turns.length; i++) {
      const turn = this.turns[i]; if (turn.at < d) continue;
      const cruise = this.cruiseFor(this.findZone(turn.at), 1), v = this.turnSpeed(turn);
      if (v < cruise) seconds += (cruise - v) ** 2 / (2 * cruise) * recovery;
    }
    for (let i = this.stopIndex; i < this.stops.length; i++) {
      const stop = this.stops[i]; if (stop.at < d) continue;
      seconds += stop.dwell + this.cruiseFor(this.findZone(stop.at), 1) / 2 * recovery;
    }
    return seconds;
  }
}

// Expected trip time before playback. Uses a fixed seed so the estimate is stable while editing.
export function estimateSeconds(path, profile, options) {
  return new Motion(path, profile, { ...options, seed: 1 }).remainingSeconds();
}
