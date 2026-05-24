// @ts-nocheck
/**
 * WorkspaceContext — localStorage-backed project folders for grouping songs.
 *
 * 2026-05-05 SGT: Initial implementation. Workspace folders.
 * Songs can belong to multiple workspaces. When a workspace is active,
 * new generations are auto-tagged into it. "My Workspace" (null active)
 * shows all songs unfiltered.
 *
 * Migration path: when Supabase social layer ships, swap localStorage
 * for a `workspaces` table + `song_workspaces` junction table.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspaceId: string | null; // null = "My Workspace" (all songs)
  activeWorkspace: Workspace | null;
  /** Song IDs belonging to each workspace */
  workspaceSongs: Record<string, string[]>;
  /** Create a new workspace. Returns the workspace. */
  createWorkspace: (name: string, description?: string) => Workspace;
  /** Rename a workspace */
  renameWorkspace: (id: string, name: string) => void;
  /** Delete a workspace (does NOT delete songs) */
  deleteWorkspace: (id: string) => void;
  /** Set the active workspace filter */
  setActiveWorkspace: (id: string | null) => void;
  /** Add a song to a workspace */
  addSongToWorkspace: (songId: string, workspaceId: string) => void;
  /** Remove a song from a workspace */
  removeSongFromWorkspace: (songId: string, workspaceId: string) => void;
  /** Add multiple songs to a workspace */
  addSongsToWorkspace: (songIds: string[], workspaceId: string) => void;
  /** Get workspace IDs that a song belongs to */
  getSongWorkspaces: (songId: string) => string[];
  /** Check if a song is in the active workspace (or all if no active) */
  isSongInActiveWorkspace: (songId: string) => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspaceId: null,
  activeWorkspace: null,
  workspaceSongs: {},
  createWorkspace: () => ({ id: '', name: '', created_at: '', updated_at: '' }),
  renameWorkspace: () => {},
  deleteWorkspace: () => {},
  setActiveWorkspace: () => {},
  addSongToWorkspace: () => {},
  removeSongFromWorkspace: () => {},
  addSongsToWorkspace: () => {},
  getSongWorkspaces: () => [],
  isSongInActiveWorkspace: () => true,
});

const WORKSPACES_KEY = 's3:workspaces';
const WORKSPACE_SONGS_KEY = 's3:workspace_songs';
const ACTIVE_WORKSPACE_KEY = 's3:active_workspace';

function generateId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode / quota */ }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() =>
    loadFromStorage<Workspace[]>(WORKSPACES_KEY, [])
  );
  const [workspaceSongs, setWorkspaceSongs] = useState<Record<string, string[]>>(() =>
    loadFromStorage<Record<string, string[]>>(WORKSPACE_SONGS_KEY, {})
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    loadFromStorage<string | null>(ACTIVE_WORKSPACE_KEY, null)
  );

  // Persist on change
  useEffect(() => { saveToStorage(WORKSPACES_KEY, workspaces); }, [workspaces]);
  useEffect(() => { saveToStorage(WORKSPACE_SONGS_KEY, workspaceSongs); }, [workspaceSongs]);
  useEffect(() => { saveToStorage(ACTIVE_WORKSPACE_KEY, activeWorkspaceId); }, [activeWorkspaceId]);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  const createWorkspace = useCallback((name: string, description?: string): Workspace => {
    const now = new Date().toISOString();
    const ws: Workspace = {
      id: generateId(),
      name: name.trim(),
      description,
      created_at: now,
      updated_at: now,
    };
    setWorkspaces(prev => [...prev, ws]);
    setWorkspaceSongs(prev => ({ ...prev, [ws.id]: [] }));
    return ws;
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    setWorkspaces(prev => prev.map(w =>
      w.id === id ? { ...w, name: name.trim(), updated_at: new Date().toISOString() } : w
    ));
  }, []);

  const deleteWorkspace = useCallback((id: string) => {
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    setWorkspaceSongs(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // If deleting the active workspace, reset to "all"
    setActiveWorkspaceId(prev => prev === id ? null : prev);
  }, []);

  const setActiveWorkspace = useCallback((id: string | null) => {
    setActiveWorkspaceId(id);
  }, []);

  const addSongToWorkspace = useCallback((songId: string, workspaceId: string) => {
    setWorkspaceSongs(prev => {
      const current = prev[workspaceId] || [];
      if (current.includes(songId)) return prev;
      return { ...prev, [workspaceId]: [...current, songId] };
    });
  }, []);

  const removeSongFromWorkspace = useCallback((songId: string, workspaceId: string) => {
    setWorkspaceSongs(prev => {
      const current = prev[workspaceId] || [];
      return { ...prev, [workspaceId]: current.filter(id => id !== songId) };
    });
  }, []);

  const addSongsToWorkspace = useCallback((songIds: string[], workspaceId: string) => {
    setWorkspaceSongs(prev => {
      const current = new Set(prev[workspaceId] || []);
      songIds.forEach(id => current.add(id));
      return { ...prev, [workspaceId]: Array.from(current) };
    });
  }, []);

  const getSongWorkspaces = useCallback((songId: string): string[] => {
    return Object.entries(workspaceSongs)
      .filter(([, songs]) => songs.includes(songId))
      .map(([wsId]) => wsId);
  }, [workspaceSongs]);

  const isSongInActiveWorkspace = useCallback((songId: string): boolean => {
    if (!activeWorkspaceId) return true; // "My Workspace" = all songs
    const songs = workspaceSongs[activeWorkspaceId] || [];
    return songs.includes(songId);
  }, [activeWorkspaceId, workspaceSongs]);

  return (
    <WorkspaceContext.Provider value={{
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      workspaceSongs,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      setActiveWorkspace,
      addSongToWorkspace,
      removeSongFromWorkspace,
      addSongsToWorkspace,
      getSongWorkspaces,
      isSongInActiveWorkspace,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
