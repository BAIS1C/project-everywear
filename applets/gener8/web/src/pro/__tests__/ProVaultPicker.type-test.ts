import { expectedAssetKindsForMode, filterVaultItemsForProMode } from '../ProVaultPicker';

const referenceKinds = expectedAssetKindsForMode('reference');
const coverKinds = expectedAssetKindsForMode('cover');

if (referenceKinds.join(',') !== 'reference') {
  throw new Error('Reference picker must only request reference assets.');
}

if (coverKinds.join(',') !== 'cover_source,gener8_song') {
  throw new Error('Cover picker must only request cover_source and gener8_song assets.');
}

const filtered = filterVaultItemsForProMode([
  {
    id: 'good',
    media_type: 'audio',
    asset_kind: 'reference',
    file_path: 'reference.wav',
    title: 'Reference',
    created_at: Date.now(),
  },
  {
    id: 'bad',
    media_type: 'audio',
    asset_kind: 'gener8_song',
    file_path: 'song.wav',
    title: 'Song',
    created_at: Date.now(),
  },
] as any[], 'reference');

if (filtered.length !== 1 || filtered[0].id !== 'good') {
  throw new Error('Reference picker filter leaked a non-reference asset.');
}
