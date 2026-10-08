import { coordinates, geocoderUrl } from './validation.mjs';
import { USER_AGENT } from './version.mjs';

// Placeholder labels the interface gives pins that have no real name yet.
export const UNNAMED_LABELS = new Set(['Dropped pin', 'Custom coordinates']);

export class Geocoder {
  // With a Geoapify key, search and pin names use Geoapify (uncached, one credit
  // each); any Geoapify failure falls back to Photon, so search never blocks.
  constructor({ fetchImpl = fetch, endpoint = 'https://photon.komoot.io/api/', intervalMs = 1100, providers = null } = {}) {
    this.fetch = fetchImpl; this.endpoint = geocoderUrl(endpoint); this.interval = intervalMs; this.providers = providers;
    this.cache = new Map(); this.inflight = new Map(); this.queue = Promise.resolve(); this.lastRequest = 0;
  }
  configure(endpoint) { this.endpoint = geocoderUrl(endpoint); }
  async search(raw) {
    if (typeof raw !== 'string' || raw.trim().length < 2 || raw.length > 200) throw new Error('Enter a place name between 2 and 200 characters.');
    const query = raw.trim();
    if (this.providers?.geoapifyActive()) {
      try { return await this.geoapifySearch(query); } catch {}
    }
    const key = `${this.endpoint}|${query.toLocaleLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 86400000) return structuredClone(cached.results);
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= 3) throw new Error('Please wait for the current search to finish.');
    const endpoint = this.endpoint;
    const job = this.queue.catch(() => {}).then(async () => {
      const delay = Math.max(0, this.interval - (Date.now() - this.lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastRequest = Date.now();
      const url = new URL(endpoint);
      url.searchParams.set('q', query); url.searchParams.set('limit', '6');
      let response;
      try {
        response = await this.fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(12000)
        });
      } catch { throw new Error('Place search is unavailable. Check your connection, or choose a pin on the map.'); }
      if (!response.ok) throw new Error(response.status === 429 ? 'Search is busy. Wait a moment and try again.' : `Place search returned ${response.status}. You can still use map pins or coordinates.`);
      const content = await response.text();
      if (content.length > 2_000_000) throw new Error('Search response was too large.');
      let data;
      try { data = JSON.parse(content); } catch { throw new Error('Search returned an unreadable response.'); }
      if (!Array.isArray(data.features)) throw new Error('Use a Photon-compatible search endpoint.');
      const results = data.features.slice(0, 6).flatMap((feature, index) => {
        try {
          const [longitude, latitude] = feature.geometry.coordinates;
          coordinates({ latitude, longitude });
          const p = feature.properties ?? {};
          const label = [...new Set([p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.town || p.village, p.state, p.country].filter(x => typeof x === 'string' && x))].join(', ').slice(0, 240);
          return [{ id: `${p.osm_type || 'place'}-${p.osm_id || index}`, latitude, longitude, label: label || query, source: 'photon' }];
        } catch { return []; }
      });
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { at: Date.now(), results });
      return structuredClone(results);
    });
    this.queue = job;
    this.inflight.set(key, job);
    try { return await job; } finally { this.inflight.delete(key); }
  }
  async geoapifySearch(query) {
    const data = await this.providers.request('/v1/geocode/search', { text: query, limit: 6, format: 'json' }, { credits: 1 });
    if (!Array.isArray(data?.results)) throw new Error('Unexpected Geoapify response.');
    return data.results.slice(0, 6).flatMap((result, index) => {
      try {
        const { lat: latitude, lon: longitude } = result;
        coordinates({ latitude, longitude });
        const label = geoapifyLabel(result) || query;
        return [{ id: `geoapify-${typeof result.place_id === 'string' ? result.place_id.slice(0, 80) : index}`, latitude, longitude, label, source: 'geoapify' }];
      } catch { return []; }
    });
  }
  // A real name for a pin, looked up only when it is applied or saved. Without
  // an active key there is no lookup and the pin keeps its placeholder name.
  async name(input) {
    const { latitude, longitude } = coordinates(input);
    if (!this.providers?.geoapifyActive()) return null;
    try {
      const data = await this.providers.request('/v1/geocode/reverse', { lat: latitude, lon: longitude, limit: 1, format: 'json' }, { credits: 1 });
      const label = geoapifyLabel(data?.results?.[0]);
      return label ? { label, source: 'geoapify' } : null;
    } catch { return null; }
  }
}

function geoapifyLabel(result) {
  if (!result || typeof result !== 'object') return '';
  const parts = typeof result.formatted === 'string' && result.formatted ? [result.formatted]
    : [result.name, result.address_line1, result.address_line2];
  const clean = parts.filter(x => typeof x === 'string' && x).map(x => x.replace(/[\u0000-\u001f\u007f]/g, '').trim());
  return [...new Set(clean)].join(', ').slice(0, 240);
}
