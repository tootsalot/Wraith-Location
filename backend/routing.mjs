import { randomUUID } from 'node:crypto';
import { place, text } from './validation.mjs';
import { measurePath, MPS_PER_MPH } from './geo.mjs';
import { MODES, CONSTANT_SPEED_MPH, estimateSeconds } from './motion.mjs';

export { distanceBetween, measurePath, pointAlong } from './geo.mjs';
export const ROUTE_SPEED_MPS = CONSTANT_SPEED_MPH * MPS_PER_MPH;
export const USER_AGENT = 'Wraith/0.2.0 (+https://github.com/tootsalot/ghost-Toots)';

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const VALHALLA_COSTING = { drive: 'auto', bike: 'bicycle', walk: 'pedestrian' };
const OSRM_URLS = { drive: 'https://router.project-osrm.org', bike: 'https://routing.openstreetmap.de/routed-bike', walk: 'https://routing.openstreetmap.de/routed-foot' };
const TRACE_CHUNK_POINTS = 4000, TRACE_CHUNK_METERS = 150000, TRACE_MAX_CHUNKS = 8;
const MAX_BODY = 8_000_000;

export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision, coordinates = [];
  let index = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, byte;
    do {
      if (index >= encoded.length) throw new Error('Malformed route shape.');
      byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) { lat += next(); lon += next(); coordinates.push([lon / factor, lat / factor]); }
  return coordinates;
}

export function encodePolyline(coordinates, precision = 6) {
  const factor = 10 ** precision;
  let output = '', lastLat = 0, lastLon = 0;
  const put = value => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { output += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
    output += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of coordinates) {
    const la = Math.round(lat * factor), lo = Math.round(lon * factor);
    put(la - lastLat); put(lo - lastLon); lastLat = la; lastLon = lo;
  }
  return output;
}

const round6 = value => Math.round(value * 1e6) / 1e6;
function joinShapes(shapes) {
  const merged = [];
  for (const shape of shapes) for (const [i, point] of shape.entries()) {
    if (i === 0 && merged.length) { const last = merged.at(-1); if (last[0] === point[0] && last[1] === point[1]) continue; }
    merged.push(point);
  }
  return merged.map(([lon, lat]) => [round6(lon), round6(lat)]);
}

// Merge per-segment values into [start, end, kph, kind] spans of equal speed.
export function spansFromSegments(segments) {
  const spans = [];
  segments.forEach(([kph, kind], i) => {
    const last = spans.at(-1);
    if (last && last[1] === i && last[2] === kph && last[3] === kind) last[1] = i + 1;
    else spans.push([i, i + 1, kph, kind]);
  });
  return spans.filter(span => span[2] != null);
}

// Validate a route from disk or a file before it can drive a phone.
export function normalizeRoute(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid route.');
  const mode = MODES[input.mode] ? input.mode : 'drive';
  const coordinates = Array.isArray(input.coordinates) ? input.coordinates.map(p => Array.isArray(p) ? [round6(Number(p[0])), round6(Number(p[1]))] : p) : null;
  const path = measurePath(coordinates);
  const last = coordinates.length - 1;
  if (!Array.isArray(input.waypoints) || input.waypoints.length < 2 || input.waypoints.length > 12) throw new Error('Invalid route stops.');
  const waypoints = input.waypoints.map(p => place(p));
  const profile = { spans: [] };
  const spans = Array.isArray(input.profile?.spans) ? input.profile.spans : [];
  if (spans.length > coordinates.length) throw new Error('Invalid route speed data.');
  for (const span of spans) {
    const [start, end, kph, kind] = Array.isArray(span) ? span : [];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > last ||
      !(kph === null || (typeof kph === 'number' && kph > 0 && kph < 400)) || ![0, 1, 2].includes(kind)) throw new Error('Invalid route speed data.');
    profile.spans.push([start, end, kph, kind]);
  }
  if (input.profile?.signals != null) {
    const signals = input.profile.signals;
    if (!Array.isArray(signals) || signals.length > 50000 || !signals.every(i => Number.isInteger(i) && i >= 0 && i <= last)) throw new Error('Invalid traffic signal data.');
    profile.signals = signals.slice();
  }
  const provider = ['valhalla', 'osrm', 'gpx'].includes(input.provider) ? input.provider : 'gpx';
  return {
    id: typeof input.id === 'string' && input.id.length <= 64 ? input.id : randomUUID(),
    ...(input.name ? { name: text(input.name, 'Route', 120) } : {}),
    mode, provider, waypoints, coordinates, profile,
    distanceMeters: path.distanceMeters,
    durationSeconds: estimateSeconds(path, profile, { mode, realistic: true, topSpeedMph: MODES[mode].defaultMph }),
  };
}

export class Router {
  constructor({ fetcher = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), valhallaUrl = VALHALLA_URL } = {}) {
    this.fetcher = fetcher; this.now = now; this.wait = wait; this.valhallaUrl = valhallaUrl; this.lastRequest = -Infinity;
  }
  async request(url, body) {
    const response = await this.fetcher(url, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    if (raw.length > MAX_BODY) throw new Error('Route is too large. Choose a shorter path.');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(response.ok ? 'The routing service returned an unreadable response.' : `Routing service returned HTTP ${response.status}.`); }
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || `Routing service returned HTTP ${response.status}.`);
      error.noRoute = response.status === 400;
      throw error;
    }
    return data;
  }
  async plan(input, { mode = 'drive' } = {}) {
    if (!MODES[mode]) throw new Error('Choose drive, bike or walk.');
    if (!Array.isArray(input) || input.length < 2 || input.length > 12) throw new Error('Add between 2 and 12 route stops.');
    const waypoints = input.map(p => place(p));
    if (this.now() - this.lastRequest < 1000) throw new Error('Wait a second before planning another route.');
    this.lastRequest = this.now();
    let planned, primaryError;
    try { planned = await this.valhalla(waypoints, mode); }
    catch (error) {
      primaryError = error;
      try { planned = await this.osrm(waypoints, mode); }
      catch (fallbackError) {
        if (primaryError.noRoute || fallbackError.noRoute) throw new Error(`No ${mode === 'drive' ? 'drivable' : mode === 'bike' ? 'cycling' : 'walking'} route found. Move the pins closer to connected roads or paths and try again.`);
        throw new Error(`Could not plan the route. Check your internet connection and try again. ${primaryError.message}`);
      }
    }
    return normalizeRoute({ id: randomUUID(), mode, waypoints, ...planned });
  }
  async valhalla(waypoints, mode) {
    const costing = VALHALLA_COSTING[mode];
    const data = await this.request(`${this.valhallaUrl}/route`, {
      locations: waypoints.map(p => ({ lat: p.latitude, lon: p.longitude, type: 'break', search_cutoff: 1000 })),
      costing, directions_type: 'none', units: 'kilometers',
    });
    const legs = data?.trip?.legs;
    if (data?.trip?.status !== 0 || !Array.isArray(legs) || !legs.length || legs.some(leg => typeof leg.shape !== 'string')) {
      const error = new Error('No route found.'); error.noRoute = true; throw error;
    }
    const coordinates = joinShapes(legs.map(leg => decodePolyline(leg.shape)));
    measurePath(coordinates);
    let profile;
    try { profile = await this.valhallaProfile(coordinates, costing); }
    catch {
      // The road attributes are an enhancement. Keep the route and use the
      // service's average leg speed as an estimated limit.
      const summary = data.trip.summary;
      const kph = summary?.time > 0 && mode === 'drive' ? Math.round(summary.length / summary.time * 3600 * 1.1) : null;
      profile = { spans: kph ? [[0, coordinates.length - 1, kph, 0]] : [] };
      return { provider: 'valhalla', coordinates, profile };
    }
    return { provider: 'valhalla', coordinates: profile.coordinates, profile: { spans: profile.spans, signals: profile.signals } };
  }
  async valhallaProfile(coordinates, costing) {
    const chunks = [];
    let start = 0;
    while (start < coordinates.length - 1) {
      let end = start + 1, length = 0;
      while (end < coordinates.length - 1 && end - start < TRACE_CHUNK_POINTS) {
        const [a, b] = [coordinates[end - 1], coordinates[end]];
        length += Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 111320);
        if (length > TRACE_CHUNK_METERS) break;
        end++;
      }
      chunks.push(coordinates.slice(start, end + 1)); start = end;
    }
    if (chunks.length > TRACE_MAX_CHUNKS) throw new Error('Route too long for road attributes.');
    const shape = [], segments = [], signals = [];
    for (const chunk of chunks) {
      await this.wait(1050); // Stay within the public server's one request per second.
      const data = await this.request(`${this.valhallaUrl}/trace_attributes`, {
        encoded_polyline: encodePolyline(chunk), shape_match: 'edge_walk', costing,
        filters: { attributes: ['shape', 'edge.speed_limit', 'edge.speed', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.traffic_signal', 'node.traffic_signal'], action: 'include' },
      });
      const matched = typeof data?.shape === 'string' ? decodePolyline(data.shape) : chunk;
      if (!Array.isArray(data?.edges) || matched.length < 2) throw new Error('Road attributes unavailable.');
      const offset = shape.length ? shape.length - 1 : 0;
      shape.push(...(shape.length ? matched.slice(1) : matched));
      for (let i = segments.length; i < shape.length - 1; i++) segments[i] = [null, 0];
      for (const edge of data.edges) {
        const begin = edge.begin_shape_index, end = edge.end_shape_index;
        if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end <= begin || end >= matched.length) continue;
        const posted = edge.speed_limit > 0 && edge.speed_limit < 200;
        const kph = posted ? edge.speed_limit : edge.speed > 0 ? edge.speed : null;
        for (let i = begin; i < end; i++) segments[offset + i] = [kph, posted ? 1 : 0];
        if (edge.traffic_signal || edge.end_node?.traffic_signal) signals.push(offset + end);
      }
    }
    measurePath(shape);
    return { coordinates: shape.map(([lon, lat]) => [round6(lon), round6(lat)]), spans: spansFromSegments(segments), signals: [...new Set(signals)] };
  }
  async osrm(waypoints, mode) {
    const coordinates = waypoints.map(p => `${p.longitude},${p.latitude}`).join(';');
    const url = `${OSRM_URLS[mode]}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=false&annotations=speed&radiuses=${waypoints.map(() => 1000).join(';')}`;
    const data = await this.request(url);
    if (data.code !== 'Ok' || data.routes?.[0]?.geometry?.type !== 'LineString') { const error = new Error('No route found.'); error.noRoute = true; throw error; }
    const route = data.routes[0];
    const geometry = route.geometry.coordinates.map(([lon, lat]) => [round6(lon), round6(lat)]);
    measurePath(geometry);
    const speeds = (route.legs || []).flatMap(leg => Array.isArray(leg.annotation?.speed) ? leg.annotation.speed : []);
    // OSRM's car profile drives at about 80% of the limit; recover a likely posted limit for drivers.
    const segments = speeds.length === geometry.length - 1 && mode === 'drive'
      ? speeds.map(mps => mps > 1 ? [Math.round(Math.round(mps / 0.8 / MPS_PER_MPH / 5) * 5 * 1.609344), 0] : [null, 0])
      : [];
    return { provider: 'osrm', coordinates: geometry, profile: { spans: spansFromSegments(segments) } };
  }
}
