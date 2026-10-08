import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Providers, GEOAPIFY_DAILY_CREDITS } from '../backend/providers.mjs';
import { Geocoder } from '../backend/geocoder.mjs';

const KEY = '0123456789abcdef0123456789abcdef';
const DAY = Date.parse('2026-10-08T12:00:00Z');
// Reversible stand-in for the operating system's secure storage.
const secure = { available: () => true, encrypt: value => Buffer.from(`sealed:${[...value].reverse().join('')}`), decrypt: buffer => [...buffer.toString().replace(/^sealed:/, '')].reverse().join('') };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const geoapifyPlace = { lat: 41.8827, lon: -87.6233, formatted: 'Cloud Gate, Chicago, IL, United States of America', place_id: 'abc' };
const photonPlace = { features: [{ geometry: { coordinates: [-87.6, 41.9] }, properties: { osm_id: 1, name: 'Chicago', country: 'United States' } }] };

async function setup(t, { fetchImpl, now = () => DAY, ...options } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wraith-providers-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const fetcher = async (url, init) => {
    assert.ok(!String(url).includes(KEY), 'The key must never appear in a request URL.');
    calls.push(new URL(url)); return fetchImpl(new URL(url), init);
  };
  const providers = new Providers({ path: path.join(dir, 'providers.json'), secure, fetchImpl: fetcher, now, ...options });
  await providers.load();
  return { dir, file: path.join(dir, 'providers.json'), providers, calls, fetcher };
}
const geocoderFor = (providers, photon = async () => json(photonPlace)) => new Geocoder({ intervalMs: 0, providers, fetchImpl: photon });

test('without a key, search uses Photon and pins keep their placeholder name', async t => {
  const { providers, calls } = await setup(t, { fetchImpl: () => { throw new Error('must not call Geoapify'); } });
  const geocoder = geocoderFor(providers);
  const places = await geocoder.search('Chicago');
  assert.equal(places[0].source, 'photon');
  assert.equal(await geocoder.name({ latitude: 41.9, longitude: -87.6 }), null);
  assert.equal(calls.length, 0);
  assert.equal(providers.status().geoapify.configured, false);
});

test('a key is tested before saving, encrypted on disk and never exposed in status', async t => {
  const { file, providers, calls } = await setup(t, { fetchImpl: async (url, init) => init.headers['x-api-key'] === KEY ? json({ results: [geoapifyPlace] }) : json({ statusCode: 401, message: 'Invalid apiKey' }, 401) });
  await assert.rejects(providers.setGeoapifyKey('not a key'), /doesn’t look like/);
  await assert.rejects(providers.setGeoapifyKey('ffffffffffffffffffffffffffffffff'), /didn’t accept this key/);
  assert.equal(providers.status().geoapify.configured, false);
  const status = await providers.setGeoapifyKey(` ${KEY} `);
  assert.equal(calls.at(-1).pathname, '/v1/geocode/reverse');
  assert.deepEqual({ configured: status.geoapify.configured, encrypted: status.geoapify.encrypted, active: status.geoapify.active, credits: status.geoapify.credits }, { configured: true, encrypted: true, active: true, credits: 1 });
  assert.ok(!JSON.stringify(status).includes(KEY));
  const raw = await readFile(file, 'utf8');
  assert.ok(!raw.includes(KEY), 'The key must not be stored in plain text when secure storage works.');
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  const reloaded = new Providers({ path: file, secure, fetchImpl: async () => json({ results: [] }), now: () => DAY });
  assert.equal((await reloaded.load()).geoapify.configured, true);
  assert.equal(reloaded.key, KEY);
  await reloaded.removeGeoapifyKey();
  assert.ok(!(await readFile(file, 'utf8')).includes('geoapify'));
});

test('without secure storage, a key is kept in a private file and reported as unencrypted', async t => {
  const { file, providers } = await setup(t, { fetchImpl: async () => json({ results: [] }), secure: { available: () => false } });
  assert.equal((await providers.setGeoapifyKey(KEY)).geoapify.encrypted, false);
  assert.match(await readFile(file, 'utf8'), new RegExp(KEY));
});

test('a key that cannot be decrypted is dropped with a warning', async t => {
  const { file, providers } = await setup(t, { fetchImpl: async () => json({ results: [] }) });
  await providers.setGeoapifyKey(KEY);
  const other = new Providers({ path: file, secure: { available: () => true, decrypt: () => { throw new Error('locked'); } }, now: () => DAY });
  assert.equal((await other.load()).geoapify.configured, false);
  assert.match(other.warning, /could not be unlocked/);
});

test('with a key, search and pin names use Geoapify, one credit each, with no caching', async t => {
  const { providers, calls } = await setup(t, { fetchImpl: async () => json({ results: [geoapifyPlace] }) });
  await providers.setGeoapifyKey(KEY);
  const geocoder = geocoderFor(providers, () => { throw new Error('must not call Photon'); });
  const first = await geocoder.search('Cloud Gate');
  assert.deepEqual(first[0], { id: 'geoapify-abc', latitude: 41.8827, longitude: -87.6233, label: geoapifyPlace.formatted, source: 'geoapify' });
  await geocoder.search('cloud gate');
  const searches = calls.filter(url => url.pathname === '/v1/geocode/search');
  assert.equal(searches.length, 2);
  assert.equal(searches[0].searchParams.get('text'), 'Cloud Gate');
  assert.equal(searches[0].searchParams.get('format'), 'json');
  assert.deepEqual(await geocoder.name({ latitude: 41.8827, longitude: -87.6233 }), { label: geoapifyPlace.formatted, source: 'geoapify' });
  assert.equal(providers.status().geoapify.credits, 4); // key test, two searches, one name
});

test('Geoapify errors fall back to Photon, and a rate limit pauses Geoapify until the next UTC day', async t => {
  let now = DAY, mode = 'ok';
  const { providers, calls } = await setup(t, { now: () => now, fetchImpl: async () => {
    if (mode === 'down') throw new Error('ECONNRESET');
    if (mode === 'limit') return json({ statusCode: 429, message: 'Too Many Requests' }, 429);
    if (mode === 'error') return json({}, 500);
    return json({ results: [geoapifyPlace] });
  } });
  await providers.setGeoapifyKey(KEY);
  const notices = []; providers.on('notice', message => notices.push(message));
  const geocoder = geocoderFor(providers);
  mode = 'down'; assert.equal((await geocoder.search('Chicago'))[0].source, 'photon');
  mode = 'error'; assert.equal((await geocoder.search('Chicago'))[0].source, 'photon');
  assert.equal(providers.status().geoapify.active, true, 'An outage is not a reason to stop trying.');
  mode = 'limit'; assert.equal((await geocoder.search('Chicago'))[0].source, 'photon');
  assert.equal(providers.status().geoapify.paused, true);
  assert.match(notices.at(-1), /rest of the day/);
  const before = calls.length;
  mode = 'ok';
  assert.equal((await geocoder.search('Chicago'))[0].source, 'photon');
  assert.equal(await geocoder.name({ latitude: 41.9, longitude: -87.6 }), null);
  assert.equal(calls.length, before, 'A paused key makes no requests.');
  now = Date.parse('2026-10-09T00:00:01Z');
  assert.equal(providers.status().geoapify.active, true);
  assert.equal(providers.status().geoapify.credits, 0);
  assert.equal((await geocoder.search('Chicago'))[0].source, 'geoapify');
});

test('a rejected key in use pauses Geoapify and tells the user', async t => {
  let reject = false;
  const { providers } = await setup(t, { fetchImpl: async () => reject ? json({ message: 'Invalid apiKey' }, 401) : json({ results: [] }) });
  await providers.setGeoapifyKey(KEY);
  const notices = []; providers.on('notice', message => notices.push(message));
  reject = true;
  assert.equal((await geocoderFor(providers).search('Chicago'))[0].source, 'photon');
  assert.equal(providers.status().geoapify.paused, true);
  assert.match(notices[0], /no longer accepts your key/);
});

test('the meter warns once at 80% and switches to the free services at the daily limit', async t => {
  const { file, providers, calls } = await setup(t, { fetchImpl: async () => json({ results: [geoapifyPlace] }) });
  await providers.setGeoapifyKey(KEY);
  const notices = []; providers.on('notice', message => notices.push(message));
  providers.usage.credits = GEOAPIFY_DAILY_CREDITS * 0.8 - 2;
  const geocoder = geocoderFor(providers);
  await geocoder.search('a place'); assert.equal(notices.length, 0);
  await geocoder.search('a place'); assert.equal(notices.length, 1); assert.match(notices[0], /About 2,400 of 3,000/);
  await geocoder.search('a place'); assert.equal(notices.length, 1, 'The 80% warning is shown once a day.');
  assert.equal(providers.status().geoapify.warning, true);
  providers.usage.credits = GEOAPIFY_DAILY_CREDITS - 1;
  await geocoder.search('a place');
  assert.match(notices.at(-1), /used up/);
  assert.equal(providers.status().geoapify.active, false);
  const before = calls.length;
  assert.equal((await geocoder.search('a place'))[0].source, 'photon');
  assert.equal(calls.length, before);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([saved.usage.day, saved.usage.credits], ['2026-10-08', GEOAPIFY_DAILY_CREDITS]);
});

test('a development key is used for the run without being saved', async t => {
  const { file, providers } = await setup(t, { fetchImpl: async () => json({ results: [geoapifyPlace] }), developmentKey: KEY });
  assert.deepEqual([providers.status().geoapify.configured, providers.status().geoapify.development], [true, true]);
  await geocoderFor(providers).search('Chicago');
  assert.ok(!(await readFile(file, 'utf8')).includes(KEY));
});

test('a key saved in Settings takes priority over a development key', async t => {
  const { file, providers } = await setup(t, { fetchImpl: async () => json({ results: [] }) });
  await providers.setGeoapifyKey(KEY);
  const dev = new Providers({ path: file, secure, now: () => DAY, developmentKey: 'ffffffffffffffffffffffffffffffff' });
  await dev.load();
  assert.deepEqual([dev.key, dev.status().geoapify.development], [KEY, false]);
});
