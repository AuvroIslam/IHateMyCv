import type { Store } from '@/types/cv';
import { storageMode } from './backend';
import * as files from './store-files';
import * as firebase from './store-firebase';
import { DATA_DIR } from './workspace';

export { DATA_DIR };

/**
 * One workspace's data - a user's library, design, CVs and uploaded files -
 * in whichever backend this deployment uses (see backend.ts). Every function
 * finds the requesting user itself; work that outlives the request (after())
 * passes the workspace id it captured.
 */
const impl = () => (storageMode() === 'firebase' ? firebase : files);

export const readStore = (ws?: string) => impl().readStore(ws);

export function mutateStore<T>(fn: (store: Store) => T | Promise<T>, ws?: string): Promise<{ store: Store; result: T }> {
  return impl().mutateStore(fn, ws);
}

export const resetStore = () => impl().resetStore();
export const saveSourceLayout: typeof files.saveSourceLayout = (...a) => impl().saveSourceLayout(...a);
export const readSourceLayout = () => impl().readSourceLayout();
export const readSourcePdf = () => impl().readSourcePdf();
export const saveSourceFonts: typeof files.saveSourceFonts = (...a) => impl().saveSourceFonts(...a);
export const readSourceFont = (id: string) => impl().readSourceFont(id);
export const savePageImages: typeof files.savePageImages = (...a) => impl().savePageImages(...a);
export const readPageImage = (page: number) => impl().readPageImage(page);
