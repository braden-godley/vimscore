/**
 * Renders the icons in resources/ from their SVGs, with Electron's own Chromium so there's no
 * image tool to install: icon.svg to icon.png, the app's, and file-icon.svg to file-icon.png and
 * file-icon.icns, for .vimscore files in Finder. Run it with `npm run icon` after changing either.
 */

import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');

/** The sizes in a macOS .icns, each at 1x and 2x */
const ICNS_SIZES = [16, 32, 128, 256, 512];

async function render(win, name) {
    const svg = readFileSync(join(resources, `${name}.svg`), 'utf8');
    const page = `<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${svg}`;
    await win.loadURL('data:text/html,' + encodeURIComponent(page));
    // Offscreen windows paint a frame or two after load
    await new Promise((done) => setTimeout(done, 300));
    const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE });
    writeFileSync(join(resources, `${name}.png`), image.toPNG());
    console.log(`Wrote resources/${name}.png`);
    return image;
}

/** macOS's iconutil packs the sizes into an .icns; electron-builder makes the app's own from its PNG */
function writeIcns(image, name) {
    const iconset = join(tmpdir(), `${name}.iconset`);
    rmSync(iconset, { recursive: true, force: true });
    mkdirSync(iconset);
    for (const size of ICNS_SIZES) {
        for (const scale of [1, 2]) {
            const file = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
            const pixels = size * scale;
            writeFileSync(join(iconset, file), image.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG());
        }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(resources, `${name}.icns`)]);
    rmSync(iconset, { recursive: true });
    console.log(`Wrote resources/${name}.icns`);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: SIZE,
        height: SIZE,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: { offscreen: true },
    });
    await render(win, 'icon');
    const fileIcon = await render(win, 'file-icon');
    if (process.platform === 'darwin') writeIcns(fileIcon, 'file-icon');
    app.quit();
});
