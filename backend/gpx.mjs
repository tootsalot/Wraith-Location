import { distanceBetween, simplifyIndices } from './geo.mjs';
import { spansFromSegments } from './routing.mjs';

export const MAX_GPX_BYTES = 25_000_000;
const MAX_POINTS = 50000;

const decode = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, entity) => {
  const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[entity.toLowerCase()];
  if (named) return named;
  const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : '';
}).trim();
const escape = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function points(xml, tag) {
  const result = [];
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'gi');
  for (const match of xml.matchAll(pattern)) {
    const attribute = name => match[1].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    const latitude = Number(attribute('lat')), longitude = Number(attribute('lon'));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const body = match[2] || '';
    const time = Date.parse(body.match(/<(?:\w+:)?time>([^<]+)</i)?.[1] || '');
    const name = body.match(/<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/i)?.[1];
    result.push({ latitude, longitude, time: Number.isFinite(time) ? time : null, ...(name ? { label: decode(name).slice(0, 120) } : {}) });
    if (result.length > 2_000_000) throw new Error('This GPX file has too many points.');
  }
  return result;
}

// Returns either a ready-to-play track or a short list of stops to route.
export function parseGpx(xml) {
  if (typeof xml !== 'string' || !xml.length) throw new Error('The GPX file is empty.');
  if (xml.length > MAX_GPX_BYTES) throw new Error('GPX files must be smaller than 25 MB.');
  if (!/<(?:\w+:)?gpx\b/i.test(xml)) throw new Error('This is not a GPX file.');
  const name = decode(xml.match(/<(?:\w+:)?(?:trk|rte|metadata)\b[^>]*>\s*<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/i)?.[1] || '').slice(0, 120) || null;
  const track = points(xml, 'trkpt');
  const routePoints = points(xml, 'rtept');
  if (track.length < 2 && routePoints.length >= 2 && routePoints.length <= 12) {
    return { kind: 'stops', name, stops: routePoints.map((p, i) => ({ latitude: p.latitude, longitude: p.longitude, label: p.label || `Stop ${i + 1}` })) };
  }
  const source = track.length >= 2 ? track : routePoints;
  const unique = source.filter((p, i) => !i || p.latitude !== source[i - 1].latitude || p.longitude !== source[i - 1].longitude);
  if (unique.length < 2) throw new Error('The GPX file needs a track or route with at least two points.');
  const coordinates = unique.map(p => [p.longitude, p.latitude]);
  let kept = simplifyIndices(coordinates, 1);
  for (let tolerance = 3; kept.length > MAX_POINTS; tolerance *= 2) kept = simplifyIndices(coordinates, tolerance);
  const timed = unique.filter(p => p.time != null).length >= unique.length * 0.8;
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i++) cumulative.push(cumulative[i - 1] + distanceBetween(coordinates[i - 1], coordinates[i]));
  // Recorded speed per kept segment, smoothed over at least ~15 seconds of recording.
  const segments = timed ? kept.slice(1).map((end, j) => {
    let from = kept[j], to = end;
    while (unique[to].time - unique[from].time < 15000 && (from > 0 || to < unique.length - 1)) { if (from > 0) from--; if (to < unique.length - 1) to++; }
    const seconds = (unique[to].time - unique[from].time) / 1000, meters = cumulative[to] - cumulative[from];
    const mps = seconds > 0 ? meters / seconds : 0;
    return mps >= 0.5 && mps < 110 ? [Math.round(mps * 3.6), 2] : [null, 2];
  }) : [];
  const first = unique[0], last = unique.at(-1);
  return {
    kind: 'track', name,
    route: {
      provider: 'gpx', ...(name ? { name } : {}),
      coordinates: kept.map(i => coordinates[i]),
      waypoints: [{ latitude: first.latitude, longitude: first.longitude, label: first.label || 'Track start' }, { latitude: last.latitude, longitude: last.longitude, label: last.label || 'Track end' }],
      profile: { spans: spansFromSegments(segments) },
    },
  };
}

export function toGpx(route, name = route.name || 'Ghost route') {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="Ghost" xmlns="http://www.topografix.com/GPX/1/1">', `  <metadata><name>${escape(name)}</name></metadata>`, `  <rte><name>${escape(name)}</name>`];
  for (const stop of route.waypoints) lines.push(`    <rtept lat="${stop.latitude}" lon="${stop.longitude}"><name>${escape(stop.label || '')}</name></rtept>`);
  lines.push('  </rte>', `  <trk><name>${escape(name)}</name><type>${escape(route.mode || 'drive')}</type><trkseg>`);
  for (const [lon, lat] of route.coordinates) lines.push(`    <trkpt lat="${lat}" lon="${lon}"/>`);
  lines.push('  </trkseg></trk>', '</gpx>', '');
  return lines.join('\n');
}
