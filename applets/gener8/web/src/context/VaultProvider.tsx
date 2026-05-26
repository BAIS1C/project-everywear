/**
 * VaultProvider — unified Everywear Vault context.
 *
 * Primary data source: Tauri vault commands (vaultSearch, vaultGetStats).
 * Secondary source: SongStoreContext (for live DAW state, not persisted media).
 *
 * The Everywear Vault is a single local repository at:
 *   ~/Documents/Everywear Vault/
 *
 * Structure:
 *   Images/   — generated images (from 1magen)
 *   Audio/    — completed audio generations (from Gener8)
 *   Videos/   — generated videos (from 3nvizen, vid pipeline)
 *   .thumbnails/ — auto-generated previews
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  vaultSearch,
  vaultGetStats,
  vaultSetFavorite,
  vaultSetTags,
  vaultDeleteItem,
  vaultFileUrl,
  vaultThumbnailUrl,
  runGener8VaultAudioImport,
  type VaultItem,
  type VaultSearchResponse,
  type VaultStats,
} from '@everywear/transport';

// ── Types ───────────────────────────────────────────────────────────────

export type VaultMediaFilter =
  | 'all'
  | 'image'
  | 'gener8_song'
  | 'stem'
  | 'riff'
  | 'sample'
  | 'reference'
  | 'cover_source'
  | 'local_audio'
  | 'video'
  | 'favorites';
export type VaultSortBy = 'newest' | 'oldest' | 'title' | 'size' | 'duration';

export interface VaultContextValue {
  /** Current search results */
  items: VaultItem[];
  /** Total matching items (for pagination) */
  total: number;
  /** Vault-wide stats */
  stats: VaultStats | null;
  /** Loading state */
  isLoading: boolean;
  hasLoaded: boolean;
  /** Current filter/sort/pagination */
  filter: VaultMediaFilter;
  sortBy: VaultSortBy;
  searchQuery: string;
  page: number;
  pageSize: number;
  /** Actions */
  setFilter: (f: VaultMediaFilter) => void;
  setSortBy: (s: VaultSortBy) => void;
  setSearchQuery: (q: string) => void;
  setPage: (p: number) => void;
  refetch: () => Promise<void>;
  refreshStats: () => Promise<void>;
  /** Item mutations */
  toggleFavorite: (id: string, current: boolean) => Promise<void>;
  updateTags: (id: string, tags: string[]) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  /** URL helpers */
  getFileUrl: (filePath: string) => string;
  getThumbnailUrl: (itemId: string) => string;
  /** Currently selected item for detail panel */
  selectedItem: VaultItem | null;
  setSelectedItem: (item: VaultItem | null) => void;
}

const VaultContext = createContext<VaultContextValue>({
  items: [],
  total: 0,
  stats: null,
  isLoading: false,
  hasLoaded: false,
  filter: 'all',
  sortBy: 'newest',
  searchQuery: '',
  page: 0,
  pageSize: 20,
  setFilter: () => {},
  setSortBy: () => {},
  setSearchQuery: () => {},
  setPage: () => {},
  refetch: async () => {},
  refreshStats: async () => {},
  toggleFavorite: async () => {},
  updateTags: async () => {},
  removeItem: async () => {},
  getFileUrl: (p) => p,
  getThumbnailUrl: () => '',
  selectedItem: null,
  setSelectedItem: () => {},
});

const LEGACY_IMPORT_REPAIR_KEY = 'gener8:vault-import-repair:2026-05-26-readable-names-videos-dedupe';

// ── Filter/sort mapping ─────────────────────────────────────────────────

function mapFilter(f: VaultMediaFilter): string | undefined {
  switch (f) {
    case 'all': return undefined;
    case 'image': return 'image';
    case 'gener8_song': return 'gener8_song';
    case 'stem': return 'stem';
    case 'riff': return 'riff';
    case 'sample': return 'sample';
    case 'reference': return 'reference';
    case 'cover_source': return 'cover_source';
    case 'local_audio': return 'local_audio';
    case 'video': return 'video';
    case 'favorites': return 'favorites';
    default: return undefined;
  }
}

function mapSort(s: VaultSortBy): string {
  switch (s) {
    case 'newest': return 'newest';
    case 'oldest': return 'oldest';
    case 'title': return 'title';
    case 'size': return 'size';
    case 'duration': return 'duration';
    default: return 'newest';
  }
}

// ── Provider ────────────────────────────────────────────────────────────

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [filter, setFilter] = useState<VaultMediaFilter>('all');
  const [sortBy, setSortBy] = useState<VaultSortBy>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const pageSize = 20;
  const fetchRef = useRef(false);
  const legacyImportRef = useRef(false);

  const runLegacyAudioImport = useCallback(async (force = false) => {
    if (legacyImportRef.current && !force) return;
    if (!force) {
      try {
        if (localStorage.getItem(LEGACY_IMPORT_REPAIR_KEY) === 'done') return;
      } catch {}
    }
    legacyImportRef.current = true;
    try {
      await runGener8VaultAudioImport(false);
      try { localStorage.setItem(LEGACY_IMPORT_REPAIR_KEY, 'done'); } catch {}
    } catch (err) {
      console.warn('[Vault] Legacy Gener8 audio import skipped:', err);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    if (fetchRef.current) return;
    fetchRef.current = true;
    setIsLoading(true);
    try {
      await runLegacyAudioImport();
      const response: VaultSearchResponse = await vaultSearch(
        searchQuery,
        mapFilter(filter),
        mapSort(sortBy),
        pageSize,
        page * pageSize,
      );
      setItems(response.items);
      setTotal(response.total);
    } catch (err) {
      console.error('[Vault] Search failed:', err);
      // Graceful fallback: empty results
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
      fetchRef.current = false;
    }
  }, [searchQuery, filter, sortBy, page, runLegacyAudioImport]);

  const refreshStats = useCallback(async () => {
    try {
      const s = await vaultGetStats();
      setStats(s);
    } catch (err) {
      console.error('[Vault] Stats failed:', err);
    }
  }, []);

  // Fetch on mount and when filter/sort/search/page changes
  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Fetch stats on mount
  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const refetch = useCallback(async () => {
    await runLegacyAudioImport(true);
    await fetchItems();
    await refreshStats();
  }, [fetchItems, refreshStats, runLegacyAudioImport]);

  const toggleFavorite = useCallback(async (id: string, current: boolean) => {
    try {
      await vaultSetFavorite(id, !current);
      // Optimistic update
      setItems((prev) => prev.map((item) =>
        item.id === id ? { ...item, favorite: !current } : item,
      ));
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, favorite: !current } : null);
      }
    } catch (err) {
      console.error('[Vault] Toggle favorite failed:', err);
      throw err;
    }
  }, [selectedItem]);

  const updateTags = useCallback(async (id: string, tags: string[]) => {
    try {
      await vaultSetTags(id, tags);
      setItems((prev) => prev.map((item) =>
        item.id === id ? { ...item, tags } : item,
      ));
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, tags } : null);
      }
    } catch (err) {
      console.error('[Vault] Update tags failed:', err);
      throw err;
    }
  }, [selectedItem]);

  const removeItem = useCallback(async (id: string) => {
    try {
      await vaultDeleteItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
      await refreshStats();
    } catch (err) {
      console.error('[Vault] Delete failed:', err);
      throw err;
    }
  }, [selectedItem, refreshStats]);

  const getFileUrl = useCallback((filePath: string) => vaultFileUrl(filePath), []);
  const getThumbnailUrl = useCallback((itemId: string) => vaultThumbnailUrl(itemId), []);

  return (
    <VaultContext.Provider
      value={{
        items,
        total,
        stats,
        isLoading,
        hasLoaded,
        filter,
        sortBy,
        searchQuery,
        page,
        pageSize,
        setFilter: (f) => { setFilter(f); setPage(0); },
        setSortBy: (s) => { setSortBy(s); setPage(0); },
        setSearchQuery: (q) => { setSearchQuery(q); setPage(0); },
        setPage,
        refetch,
        refreshStats,
        toggleFavorite,
        updateTags,
        removeItem,
        getFileUrl,
        getThumbnailUrl,
        selectedItem,
        setSelectedItem,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  return useContext(VaultContext);
}
