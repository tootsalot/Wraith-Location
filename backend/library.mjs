import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeRoute } from './routing.mjs';
import { text } from './validation.mjs';

export const MAX_SAVED_ROUTES = 50;
export const MAX_LIBRARY_POINTS = 1_000_000;

// Saved routes keep full geometry, so they replay without the routing service.
// They live apart from settings.json, which is rewritten on every session change.
export class RouteLibrary {
  constructor(path) { this.path = path; this.routes = []; this.queue = Promise.resolve(); this.warning = null; }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.routes)) throw new Error('Unsupported route library format');
      this.routes = parsed.routes.flatMap(route => {
        try { return [{ ...normalizeRoute(route), name: text(route.name, 'Saved route', 120), savedAt: typeof route.savedAt === 'string' ? route.savedAt : new Date(0).toISOString() }]; }
        catch { return []; }
      }).slice(0, MAX_SAVED_ROUTES);
      if (this.routes.length < parsed.routes.length) this.warning = 'Some saved routes could not be read and were skipped.';
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await copyFile(this.path, `${this.path}.backup-${Date.now()}`).catch(() => {});
        this.warning = 'Saved routes could not be read. A backup of the file was kept.';
      }
      this.routes = [];
    }
    return this.list();
  }
  list() {
    return this.routes.map(({ id, name, mode, provider, distanceMeters, waypoints, savedAt }) => ({ id, name, mode, provider, distanceMeters, stops: waypoints.length, savedAt }));
  }
  get(id) {
    const route = this.routes.find(item => item.id === id);
    if (!route) throw new Error('That saved route no longer exists.');
    return structuredClone(route);
  }
  async persist(routes) {
    const snapshot = JSON.stringify({ schemaVersion: 1, routes });
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
      this.routes = routes;
    });
    this.queue = operation;
    return operation;
  }
  async save(route, name) {
    const record = { ...normalizeRoute(route), id: randomUUID(), name: text(name, 'Saved route', 120), savedAt: new Date().toISOString() };
    const routes = [record, ...this.routes];
    if (routes.length > MAX_SAVED_ROUTES) throw new Error(`You can save up to ${MAX_SAVED_ROUTES} routes. Delete one first.`);
    if (routes.reduce((sum, item) => sum + item.coordinates.length, 0) > MAX_LIBRARY_POINTS) throw new Error('The route library is full. Delete a long route first.');
    await this.persist(routes);
    return record;
  }
  async rename(id, name) {
    this.get(id);
    await this.persist(this.routes.map(route => route.id === id ? { ...route, name: text(name, route.name, 120) } : route));
  }
  async delete(id) { await this.persist(this.routes.filter(route => route.id !== id)); }
}
