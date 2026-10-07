/**
 * Runs after `dist`: takes the app just built in dist/ out of macOS's list of apps, so Finder
 * only ever opens .vimscore files with, and takes their icon from, the one in /Applications.
 * Building registers it, since electron-builder signs it there.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LSREGISTER =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

if (process.platform === 'darwin') {
    // dist/mac-arm64, or dist/mac on Intel
    for (const folder of readdirSync(dist).filter((name) => name.startsWith('mac'))) {
        const built = join(dist, folder, 'vimscore.app');
        execFileSync(LSREGISTER, ['-u', built], { stdio: 'ignore' });
        console.log(`Unregistered ${built}`);
    }
}
