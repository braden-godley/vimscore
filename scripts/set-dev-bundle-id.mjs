/**
 * Gives the dev Electron.app in node_modules our own bundle ID, so macOS tools that match apps by
 * bundle ID (like Karabiner's per-app rules) can tell vimscore apart from every other Electron app.
 * Runs before `dev` and `start`; a reinstall of electron restores the stock ID, so it's reapplied.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const BUNDLE_ID = 'com.braden.vimscore';

if (process.platform === 'darwin') {
    // The electron package exports the path to its binary: <app>/Contents/MacOS/Electron
    const binary = createRequire(import.meta.url)('electron');
    const app = dirname(dirname(dirname(binary)));
    const plist = join(app, 'Contents', 'Info.plist');

    const current = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]).toString().trim();
    if (current !== BUNDLE_ID) {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${BUNDLE_ID}`, plist]);
        // The signature covers Info.plist, so editing it needs a fresh ad-hoc signature to launch
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
        console.log(`Set dev Electron bundle ID to ${BUNDLE_ID}`);
    }
}
