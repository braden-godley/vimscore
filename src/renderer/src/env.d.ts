/// <reference types="vite/client" />
import { FileHost } from '../../services/file/Commands';
import { FolderEntry } from '../../services/editor/Completion';

/** Kept between runs, in the app's data folder */
export interface Settings {
  /** The soundfonts new scores start with, first played first: the last ones chosen */
  soundfonts?: string[];
  /** Before there could be several, the one soundfont */
  soundfont?: string;
  /** Scores opened or saved, newest first, for `:recent` */
  recentFiles?: string[];
  /** Commands entered on the `:` command line, newest first */
  commandHistory?: string[];
}

declare global {
  interface Window {
    versions: {
      node: () => string;
      chrome: () => string;
      electron: () => string;
    };
    /** From the preload script */
    files: FileHost & {
      /** What's in a folder, or nothing if it can't be read */
      list(folder: string): Promise<FolderEntry[]>;
      readBinary(path: string): Promise<ArrayBuffer>;
      writeBinary(path: string, data: Uint8Array): Promise<void>;
      chooseSoundfontPath(): Promise<string | undefined>;
    };
    settings: {
      get(): Promise<Settings>;
      set(settings: Settings): Promise<void>;
    };
  }
}
