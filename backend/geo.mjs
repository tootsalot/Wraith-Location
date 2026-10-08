// Pure geometry helpers. No Node APIs: the renderer imports this module too.
import { place } from './validation.mjs';

export const EARTH_RADIUS_METERS = 6371008.8;
export const MPS_PER_MPH = 1609.344 / 3600;
const radians = degrees => degrees * Math.PI / 180;
const longitudeDelta = (from, to) => ((to - from + 540) % 360) - 180;

export function distanceBetween(a, b) {
  const dLat = radians(b[1] - a[1]), dLon = radians(longitudeDelta(a[0], b[0]));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

// Initial compass bearing from a to b, in degrees [0, 360).
export function bearing(a, b) {
  const lat1 = radians(a[1]), lat2 = radians(b[1]), dLon = radians(longitudeDelta(a[0], b[0]));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function measurePath(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 100000) throw new Error('The routing service returned an invalid or excessively long path.');
  const cumulative = [0];
  coordinates.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) throw new Error('Invalid route coordinates.');
    place({ longitude: p[0], latitude: p[1] });
    if (i) cumulative.push(cumulative[i - 1] + distanceBetween(coordinates[i - 1], p));
  });
  if (cumulative.at(-1) < 1) throw new Error('Choose two different locations at least a metre apart.');
  return { coordinates, cumulative, distanceMeters: cumulative.at(-1) };
}

// Index of the segment [i - 1, i] containing the given distance.
export function segmentAt(path, distance) {
  let lo = 1, hi = path.cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (path.cumulative[mid] < distance) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function pointAlong(path, distance) {
  const target = Math.min(path.distanceMeters, Math.max(0, distance));
  const lo = segmentAt(path, target);
  const a = path.coordinates[lo - 1], b = path.coordinates[lo];
  const length = path.cumulative[lo] - path.cumulative[lo - 1];
  const fraction = length ? (target - path.cumulative[lo - 1]) / length : 0;
  // Spherical interpolation stays on the segment, including across the dateline.
  const angle = distanceBetween(a, b) / EARTH_RADIUS_METERS;
  let latitude, longitude;
  if (angle < 1e-10) [longitude, latitude] = a;
  else {
    const x = Math.sin((1 - fraction) * angle) / Math.sin(angle), y = Math.sin(fraction * angle) / Math.sin(angle);
    const aLat = radians(a[1]), aLon = radians(a[0]), bLat = radians(b[1]), bLon = radians(b[0]);
    const vx = x * Math.cos(aLat) * Math.cos(aLon) + y * Math.cos(bLat) * Math.cos(bLon);
    const vy = x * Math.cos(aLat) * Math.sin(aLon) + y * Math.cos(bLat) * Math.sin(bLon);
    const vz = x * Math.sin(aLat) + y * Math.sin(bLat);
    latitude = Math.atan2(vz, Math.hypot(vx, vy)) * 180 / Math.PI;
    longitude = Math.atan2(vy, vx) * 180 / Math.PI;
  }
  if (target === path.distanceMeters) [longitude, latitude] = path.coordinates.at(-1);
  return { latitude, longitude };
}

// Shift a point by metres east and north. Accurate for the few-metre offsets used by GPS jitter.
export function offsetPoint({ latitude, longitude }, east, north) {
  const lat = latitude + north / 111320;
  const lon = longitude + east / (111320 * Math.max(0.01, Math.cos(radians(latitude))));
  return { latitude: Math.max(-90, Math.min(90, lat)), longitude: ((lon + 540) % 360) - 180 };
}

// Douglas–Peucker simplification in metres, using a local flat projection per segment.
export function simplifyPath(coordinates, toleranceMeters = 1) {
  return simplifyIndices(coordinates, toleranceMeters).map(i => coordinates[i]);
}

// Indices of the points kept by simplifyPath.
export function simplifyIndices(coordinates, toleranceMeters = 1) {
  if (coordinates.length <= 2) return coordinates.map((_, i) => i);
  const keep = new Uint8Array(coordinates.length);
  keep[0] = keep[coordinates.length - 1] = 1;
  const stack = [[0, coordinates.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = coordinates[first], b = coordinates[last];
    const scale = Math.cos(radians((a[1] + b[1]) / 2)) * 111320;
    const bx = longitudeDelta(a[0], b[0]) * scale, by = (b[1] - a[1]) * 111320;
    const lengthSquared = bx * bx + by * by;
    let worst = -1, worstDistance = toleranceMeters;
    for (let i = first + 1; i < last; i++) {
      const px = longitudeDelta(a[0], coordinates[i][0]) * scale, py = (coordinates[i][1] - a[1]) * 111320;
      const t = lengthSquared ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared)) : 0;
      const d = Math.hypot(px - t * bx, py - t * by);
      if (d > worstDistance) { worst = i; worstDistance = d; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([first, worst], [worst, last]); }
  }
  const indices = [];
  keep.forEach((kept, i) => { if (kept) indices.push(i); });
  return indices;
}
