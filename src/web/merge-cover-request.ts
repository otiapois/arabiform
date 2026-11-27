import type { OutputSettings } from './useBatch';

export function mergeCoverRequest(cover: OutputSettings['cover'], filenames: OutputSettings['filenamePlans']) {
  return cover && { ...cover, filenames: filenames.map(({ filename }) => filename) };
}
