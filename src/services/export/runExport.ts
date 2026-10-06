/**
 * `:export`: works out where the file goes, renders it, and writes it. Rendering and the
 * filesystem come in from the app, so this decides the rules and stays testable.
 */

import { Composition } from '../composition/Composition';
import { EXPORT_EXTENSIONS, ExportFormat } from '../editor/CommandLine';
import { Document } from '../file/Commands';

export interface ExportHost {
    resolve(path: string, base?: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    writeBinary(path: string, data: Uint8Array): Promise<void>;
}

/** Turns a composition into a file's bytes; may take a while */
export type Renderer = (composition: Composition, format: ExportFormat) => Promise<Uint8Array>;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string | undefined) => path?.replace(/[\\/][^\\/]*$/, '');

/**
 * The score file's path with the format's extension in place of its own. The animation is
 * marked, so it doesn't replace the score video beside it.
 */
export function besideScore(scorePath: string, format: ExportFormat): string {
    const marked = format === 'musanim' ? '.musanim' : '';
    return scorePath.replace(/(\.[^\\/.]*)?$/, `${marked}.${EXPORT_EXTENSIONS[format]}`);
}

export async function runExport(
    command: { format: ExportFormat; path?: string; force: boolean },
    document: Document,
    host: ExportHost,
    render: Renderer,
): Promise<{ message: string; error?: boolean }> {
    const { format, path: typed, force } = command;

    let path: string;
    if (typed) {
        const named = /\.[^\\/.]+$/.test(typed) ? typed : `${typed}.${EXPORT_EXTENSIONS[format]}`;
        path = await host.resolve(named, folder(document.path));
        // Like :w, a file you name won't be replaced without !; the one beside the score is ours
        if (!force && (await host.exists(path))) {
            return { message: `"${fileName(path)}" exists (add ! to override)`, error: true };
        }
    } else if (document.path) {
        path = besideScore(document.path, format);
    } else {
        return { message: `No file name: save the score first, or :export ${format} file`, error: true };
    }

    try {
        await host.writeBinary(path, await render(document.session.composition, format));
    } catch (error) {
        return { message: `Export failed: ${(error as Error).message}`, error: true };
    }
    return { message: `"${fileName(path)}" exported` };
}
