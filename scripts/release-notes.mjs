import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'https://github.com/tootsalot/Wraith-Location';

/** The tag must be exactly v + package.json's version. */
export function checkTag(tag, version) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? '')) throw new Error(`Tag ${tag} is not a vX.Y.Z version tag.`);
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package.json version ${version}; bump package.json or retag.`);
  return version;
}

/** Body of the `## <version>` section, without its heading. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section; rename "## Unreleased" before tagging.`);
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md section "## ${version}" is empty.`);
  return body;
}

const PLATFORMS = [
  {test: /-win-x64\.exe$/, os: 'windows', label: 'Windows 10/11, 64-bit'},
  {test: /-mac-arm64\.dmg$/, os: 'mac', label: 'Mac with an Apple chip (M1 or newer)'},
  {test: /-mac-x64\.dmg$/, os: 'mac', label: 'Mac with an Intel processor'},
  {test: /-linux-x86_64\.AppImage$/, os: 'linux', label: 'Linux, 64-bit (AppImage)'},
  {test: /-linux-amd64\.deb$/, os: 'linux', label: 'Debian or Ubuntu, 64-bit (.deb)'},
];

/** Release notes in the style of the hand-written 0.2.1 release, for the user to edit before publishing. */
export function releaseNotes({version, section, assets}) {
  const downloads = PLATFORMS.flatMap(platform => {
    const file = assets.find(name => platform.test.test(name));
    return file ? [{...platform, file}] : [];
  });
  const has = os => downloads.some(item => item.os === os);
  const untested = ['mac', 'linux'].filter(has).map(os => ({mac: 'Mac', linux: 'Linux'})[os]);
  const out = [`## Wraith ${version}`, '', section, ''];
  if (untested.length) {
    out.push(`> **${untested.join(' and ')} builds are untested on real phones.** They are built and checked automatically, but nobody has yet set a phone's location with them. Please [open an issue](${repo}/issues) with what worked and what didn't.`, '');
  }
  out.push('### Download', '', '| Your computer | File |', '| --- | --- |');
  for (const item of downloads) out.push(`| ${item.label} | \`${item.file}\` |`);
  out.push('', 'None of the downloads are code-signed.');
  if (has('windows')) out.push('- **Windows:** SmartScreen may warn you. Choose **More info → Run anyway** if you trust this download. The installer upgrades an existing install and keeps your settings.');
  if (has('mac')) out.push('- **Mac:** open the DMG and drag Wraith into Applications. If macOS blocks it, use **System Settings → Privacy & Security → Open Anyway**.');
  if (has('linux')) out.push('- **Linux:** make the AppImage executable (`chmod +x`) and run it, or install the .deb with `sudo apt install ./<file>.deb`.');
  out.push('', `Then follow the [setup guide](${repo}/blob/main/SETUP.md) to connect your iPhone or Android phone. Compare downloads with \`SHA256SUMS.txt\` below.`, '');
  out.push(`Wraith is free software under GPL-3.0-or-later. The source for this release is the \`v${version}\` tag; licence and attribution details are in [THIRD_PARTY_NOTICES.md](${repo}/blob/v${version}/THIRD_PARTY_NOTICES.md).`, '');
  return out.join('\n');
}

const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const version = checkTag(option('--tag'), pkg.version);
    const section = changelogSection(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
    const assetsDir = option('--assets');
    const output = option('--out');
    if (assetsDir && output) {
      await writeFile(output, releaseNotes({version, section, assets: await readdir(assetsDir)}));
      console.log(`Wrote release notes for ${version} to ${output}.`);
    } else {
      console.log(`Tag v${version} matches package.json and CHANGELOG.md has its section.`);
    }
  } catch (error) {
    console.error(`Release check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
