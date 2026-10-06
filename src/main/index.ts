import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { access, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCORE_FILTERS = [{ name: 'vimscore', extensions: ['vimscore'] }];
/** Opening also reads MuseScore files, converting them */
const OPEN_FILTERS = [
    { name: 'Scores', extensions: ['vimscore', 'mscz', 'mscx'] },
    { name: 'vimscore', extensions: ['vimscore'] },
    { name: 'MuseScore', extensions: ['mscz', 'mscx'] },
];
const SOUNDFONT_FILTERS = [{ name: 'Soundfonts', extensions: ['sf2', 'sf3', 'dls'] }];

/** App settings, kept between runs: so far the soundfont new scores start with */
const settingsPath = () => join(app.getPath('userData'), 'settings.json');

/** `~` is home, and relative paths are from `base` (the open file's folder) or home */
function resolvePath(path: string, base?: string): string {
    if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
    return resolve(base ?? homedir(), path);
}

/** File access for the renderer, which is sandboxed; see FileHost */
function handleFiles(): void {
    ipcMain.handle('files:resolve', (_event, path: string, base?: string) => resolvePath(path, base));
    ipcMain.handle('files:exists', (_event, path: string) =>
        access(path).then(
            () => true,
            () => false,
        ),
    );
    // For completing file names; a link counts as a folder if it leads to one
    ipcMain.handle('files:list', async (_event, folder: string) => {
        const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
        return Promise.all(
            entries.map(async (entry) => ({
                name: entry.name,
                folder: entry.isSymbolicLink()
                    ? await stat(join(folder, entry.name)).then((info) => info.isDirectory(), () => false)
                    : entry.isDirectory(),
            })),
        );
    });
    ipcMain.handle('files:read', (_event, path: string) => readFile(path, 'utf8'));
    ipcMain.handle('files:readBinary', async (_event, path: string) => {
        const data = await readFile(path);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    });
    ipcMain.handle('files:write', async (_event, path: string, text: string) => {
        // Written beside it and moved into place, so a failed write never leaves half a score
        const temporary = join(dirname(path), `.${Date.now()}.vimscore-tmp`);
        await writeFile(temporary, text, 'utf8');
        await rename(temporary, path);
    });
    ipcMain.handle('files:writeBinary', async (_event, path: string, data: Uint8Array) => {
        const temporary = join(dirname(path), `.${Date.now()}.vimscore-tmp`);
        await writeFile(temporary, data);
        await rename(temporary, path);
    });
    ipcMain.handle('files:chooseSave', async (event, suggested?: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const options = { defaultPath: suggested ?? join(homedir(), 'Untitled.vimscore'), filters: SCORE_FILTERS };
        const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
        return result.canceled ? undefined : result.filePath;
    });
    ipcMain.handle('files:chooseOpen', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const options = { properties: ['openFile' as const], filters: OPEN_FILTERS };
        const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        return result.canceled ? undefined : result.filePaths[0];
    });
    ipcMain.handle('files:chooseSoundfont', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const options = { properties: ['openFile' as const], filters: SOUNDFONT_FILTERS };
        const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        return result.canceled ? undefined : result.filePaths[0];
    });
    ipcMain.handle('settings:get', () =>
        readFile(settingsPath(), 'utf8').then(
            (text) => JSON.parse(text) as unknown,
            () => ({}),
        ),
    );
    ipcMain.handle('settings:set', (_event, settings: unknown) =>
        writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8'),
    );
    ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.destroy());
}

function createWindow(): void {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Throttled timers in a hidden window would starve the audio scheduler
            backgroundThrottling: false,
        },
    });

    // electron-vite sets this in dev so the renderer gets HMR
    if (process.env['ELECTRON_RENDERER_URL']) {
        win.loadURL(process.env['ELECTRON_RENDERER_URL']);
        win.webContents.openDevTools();
    } else {
        win.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

app.whenReady().then(() => {
    handleFiles();
    createWindow();

    // macOS: re-create a window when the dock icon is clicked and none are open
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
