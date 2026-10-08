import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {changelogSection, checkTag, releaseNotes} from '../scripts/release-notes.mjs';

const changelog = '# Changelog\n\n## 0.3.0\n\n- Add wander mode.\n- Add drift.\n\n## 0.2.1\n\n- Fix themes.\n';

test('release tag must match package.json exactly', () => {
  assert.equal(checkTag('v0.3.0', '0.3.0'), '0.3.0');
  assert.throws(() => checkTag('v0.3.1', '0.3.0'), /does not match package\.json version 0\.3\.0/);
  assert.throws(() => checkTag('0.3.0', '0.3.0'), /not a vX\.Y\.Z/);
  assert.throws(() => checkTag('v0.3', '0.3'), /not a vX\.Y\.Z/);
  assert.throws(() => checkTag(undefined, '0.3.0'), /not a vX\.Y\.Z/);
});

test('changelog section stops at the next version heading', () => {
  assert.equal(changelogSection(changelog, '0.3.0'), '- Add wander mode.\n- Add drift.');
  assert.equal(changelogSection(changelog, '0.2.1'), '- Fix themes.');
  assert.equal(changelogSection(changelog.replaceAll('\n', '\r\n'), '0.2.1'), '- Fix themes.');
});

test('missing or empty changelog sections fail before building', () => {
  assert.throws(() => changelogSection(changelog, '0.4.0'), /no "## 0\.4\.0" section/);
  assert.throws(() => changelogSection('## 0.3.0\n\n## 0.2.1\n- x\n', '0.3.0'), /is empty/);
  assert.throws(() => changelogSection('## 0.3.0-beta\n- x\n', '0.3.0'), /no "## 0\.3\.0" section/);
});

test('the real changelog sections are found', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelogSection(text, '0.2.1'), /dark and light themes on Windows/);
});

test('notes list only the platforms that were built and flag untested ones', () => {
  const windowsOnly = releaseNotes({version: '0.3.0', section: '- Add drift.', assets: ['Wraith-0.3.0-win-x64.exe']});
  assert.match(windowsOnly, /^## Wraith 0\.3\.0\n\n- Add drift\./);
  assert.match(windowsOnly, /\| Windows 10\/11, 64-bit \| `Wraith-0\.3\.0-win-x64\.exe` \|/);
  assert.match(windowsOnly, /Run anyway/);
  assert.doesNotMatch(windowsOnly, /untested|Open Anyway|AppImage/);
  assert.match(windowsOnly, /blob\/v0\.3\.0\/THIRD_PARTY_NOTICES\.md/);

  const all = releaseNotes({version: '0.3.0', section: '- x', assets: [
    'SHA256SUMS.txt', 'Wraith-0.3.0-mac-arm64.dmg', 'Wraith-0.3.0-mac-arm64.zip', 'Wraith-0.3.0-mac-x64.dmg',
    'Wraith-0.3.0-win-x64.exe', 'Wraith-0.3.0-linux-x86_64.AppImage', 'Wraith-0.3.0-linux-amd64.deb',
  ]});
  assert.match(all, /\*\*Mac and Linux builds are untested on real phones\.\*\*/);
  for (const label of ['Apple chip', 'Intel processor', 'AppImage', 'Debian or Ubuntu']) assert.ok(all.includes(label), label);
  assert.match(all, /Open Anyway/);
  assert.doesNotMatch(all, /mac-arm64\.zip/);

  const macOnly = releaseNotes({version: '0.3.0', section: '- x', assets: ['Wraith-0.3.0-mac-x64.dmg']});
  assert.match(macOnly, /\*\*Mac builds are untested on real phones\.\*\*/);
});
