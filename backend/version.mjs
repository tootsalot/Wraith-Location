import { createRequire } from 'node:module';

// One User-Agent for every outside service, read from package.json so it follows each release.
export const VERSION = createRequire(import.meta.url)('../package.json').version;
export const USER_AGENT = `Wraith/${VERSION} (+https://github.com/tootsalot/Wraith-Location)`;
