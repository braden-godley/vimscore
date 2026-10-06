/// <reference types="vite/client" />
import { FileHost } from '../../services/file/Commands';

/** Kept between runs, in the app's data folder */
export interface Settings {
  /** The soundfont new scores start with: the last one loaded */
  soundfont?: string;
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
