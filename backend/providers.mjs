import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Optional free-tier keys that unlock better services. Wraith works without any
// key; with one, only deliberate actions spend credits, and nothing is cached.
export const GEOAPIFY_URL = 'https://api.geoapify.com';
export const GEOAPIFY_DAILY_CREDITS = 3000;
export const GEOAPIFY_WARN_RATIO = 0.8;
const KEY_PATTERN = /^[A-Za-z0-9]{16,64}$/;
const MAX_BODY = 2_000_000;
const USER_AGENT = 'Wraith/0.2.1 (+https://github.com/tootsalot/Wraith-Location)';
// Any point works for checking a key; this one costs a single reverse lookup.
const KEY_TEST_POINT = { lat: 51.5007, lon: -0.1246 };

// Credits are counted per UTC day, matching a daily allowance that resets at midnight UTC.
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const nextUtcMidnight = ms => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString(); };

export class ProviderError extends Error {
  constructor(message, { status = 0, reason = 'unavailable' } = {}) { super(message); this.status = status; this.reason = reason; }
}

export class Providers extends EventEmitter {
  // `secure` wraps the operating system's secure storage (Electron safeStorage).
  // Without it, a key is kept in a file only this user can read.
  constructor({ path, secure = null, fetchImpl = fetch, now = Date.now, developmentKey = null } = {}) {
    super();
    this.path = path; this.secure = secure; this.fetch = fetchImpl; this.now = now;
    this.key = null; this.encrypted = false; this.development = false;
    this.usage = { day: utcDay(now()), credits: 0, pausedDay: null, warnedDay: null };
    this.queue = Promise.resolve(); this.warning = null;
    // A development key from .env is used for this run only and never saved.
    if (developmentKey && KEY_PATTERN.test(developmentKey)) { this.key = developmentKey; this.development = true; }
  }
  async load() {
    let parsed;
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return this.status();
      await copyFile(this.path, `${this.path}.backup-${this.now()}`).catch(() => {});
      this.warning = 'Saved API keys could not be read. Add your Geoapify key again in Settings.';
      return this.status();
    }
    const usage = parsed?.usage;
    if (usage && typeof usage.day === 'string' && Number.isFinite(usage.credits) && usage.credits >= 0) {
      this.usage = { day: usage.day, credits: usage.credits, pausedDay: typeof usage.pausedDay === 'string' ? usage.pausedDay : null, warnedDay: typeof usage.warnedDay === 'string' ? usage.warnedDay : null };
    }
    const saved = parsed?.geoapify;
    // A key added in Settings takes priority over a development key.
    if (saved && typeof saved.key === 'string') {
      try {
        const key = saved.encrypted ? this.secure.decrypt(Buffer.from(saved.key, 'base64')) : saved.key;
        if (!KEY_PATTERN.test(key)) throw new Error('Invalid key.');
        this.key = key; this.encrypted = Boolean(saved.encrypted); this.development = false;
      } catch {
        this.warning = 'Your saved Geoapify key could not be unlocked on this computer. Add it again in Settings.';
      }
    }
    this.rollDay();
    return this.status();
  }
  async save() {
    const data = { schemaVersion: 1, usage: this.usage };
    if (this.key && !this.development) data.geoapify = { key: this.encrypted ? this.secure.encrypt(this.key).toString('base64') : this.key, encrypted: this.encrypted };
    const content = JSON.stringify(data, null, 2);
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, content, { mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
    });
    this.queue = operation;
    return operation;
  }
  rollDay() {
    const today = utcDay(this.now());
    if (this.usage.day !== today) this.usage = { day: today, credits: 0, pausedDay: null, warnedDay: null };
    return today;
  }
  // What the interface may know. The key itself never leaves the main process.
  status() {
    const today = this.rollDay();
    const credits = Math.round(this.usage.credits * 100) / 100;
    const paused = this.usage.pausedDay === today || credits >= GEOAPIFY_DAILY_CREDITS;
    return {
      geoapify: {
        configured: Boolean(this.key), development: this.development, encrypted: this.encrypted,
        active: Boolean(this.key) && !paused, paused,
        credits, limit: GEOAPIFY_DAILY_CREDITS,
        warning: credits >= GEOAPIFY_DAILY_CREDITS * GEOAPIFY_WARN_RATIO,
        resetsAt: nextUtcMidnight(this.now()),
      },
    };
  }
  geoapifyActive() { return this.status().geoapify.active; }
  changed() { this.emit('change', this.status()); }
  async setGeoapifyKey(raw) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!KEY_PATTERN.test(key)) throw new Error('That doesn’t look like a Geoapify API key. Copy the key from your project at myprojects.geoapify.com.');
    // Test the key before keeping it, so Settings can say plainly whether it works.
    await this.request('/v1/geocode/reverse', { ...KEY_TEST_POINT, limit: 1, format: 'json' }, { credits: 1, key, test: true });
    this.key = key; this.development = false;
    this.encrypted = Boolean(this.secure?.available());
    // A new key gets a fresh chance today; credits keep counting for the day.
    this.usage.pausedDay = null;
    await this.save(); this.changed();
    return this.status();
  }
  async removeGeoapifyKey() {
    this.key = null; this.encrypted = false; this.development = false;
    await this.save(); this.changed();
    return this.status();
  }
  async charge(credits) {
    this.rollDay();
    const before = this.usage.credits;
    this.usage.credits = before + credits;
    const warnAt = GEOAPIFY_DAILY_CREDITS * GEOAPIFY_WARN_RATIO;
    if (this.usage.credits >= GEOAPIFY_DAILY_CREDITS && before < GEOAPIFY_DAILY_CREDITS) {
      this.emit('notice', 'Today’s Geoapify allowance is used up. Wraith is using the free services until midnight UTC.');
    } else if (this.usage.credits >= warnAt && this.usage.warnedDay !== this.usage.day) {
      this.usage.warnedDay = this.usage.day;
      this.emit('notice', `About ${Math.round(this.usage.credits).toLocaleString('en-US')} of ${GEOAPIFY_DAILY_CREDITS.toLocaleString('en-US')} Geoapify credits used today. Wraith switches to the free services at the limit.`);
    }
    await this.save().catch(() => {});
    this.changed();
  }
  async pauseForToday(message) {
    this.usage.pausedDay = this.rollDay();
    await this.save().catch(() => {});
    this.emit('notice', message);
    this.changed();
  }
  // One request to Geoapify. Callers fall back to the free services on any error.
  async request(path, params, { credits, key = this.key, test = false }) {
    if (!key) throw new ProviderError('No Geoapify key.', { reason: 'no-key' });
    if (!test && !this.geoapifyActive()) throw new ProviderError('Geoapify is paused for today.', { reason: 'paused' });
    const url = new URL(path, GEOAPIFY_URL);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let response;
    try {
      // The key goes in a header, as Geoapify advises for server-side clients, so it never appears in a URL.
      response = await this.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(test ? 15000 : 8000) });
    } catch {
      throw new ProviderError(test ? 'Couldn’t reach Geoapify to check the key. Check your connection and try again.' : 'Geoapify is unavailable.');
    }
    const raw = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      const message = test ? 'Geoapify didn’t accept this key. Check that you copied the whole key from your project.' : 'Geoapify no longer accepts your key. Check it in Settings; Wraith is using the free services meanwhile.';
      if (!test && key === this.key) await this.pauseForToday(message);
      throw new ProviderError(message, { status: response.status, reason: 'rejected' });
    }
    if (response.status === 429) {
      const message = test ? 'Geoapify says this key has reached its limit. Try again tomorrow.' : 'Geoapify’s free-tier limit was reached. Wraith is using the free services for the rest of the day.';
      if (key === this.key) await this.pauseForToday(message);
      throw new ProviderError(message, { status: 429, reason: 'limit' });
    }
    if (!response.ok) throw new ProviderError(`Geoapify returned HTTP ${response.status}.`, { status: response.status });
    if (raw.length > MAX_BODY) throw new ProviderError('Geoapify returned too much data.');
    let data;
    try { data = JSON.parse(raw); } catch { throw new ProviderError('Geoapify returned an unreadable response.'); }
    await this.charge(credits);
    return data;
  }
}
