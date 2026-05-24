// @ts-nocheck
/**
 * PatchSelector — Style Patch picker for CreatePanel
 *
 * Horizontal scrollable strip of patch cards.
 * Selecting a patch loads it into ACE-Step and auto-inserts the trigger keyword.
 * Includes a strength slider per-patch.
 */

import React, { useState, useEffect } from 'react';
import { Layers, Loader2, X, Flame } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { patchesApi, loraApi, PatchManifest } from '../services/api';

interface PatchSelectorProps {
  /** Called when a patch is loaded/unloaded — parent can inject trigger keyword into prompt */
  onPatchChange?: (activePatch: PatchManifest | null, triggerKeyword: string | null) => void;
  /** Navigate to Style Forge */
  onNavigateToForge?: () => void;
}

export const PatchSelector: React.FC<PatchSelectorProps> = ({ onPatchChange, onNavigateToForge }) => {
  const { token } = useAuth();
  const [patches, setPatches] = useState<PatchManifest[]>([]);
  const [activePatchId, setActivePatchId] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.8);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadPatches();
  }, [token]);

  const loadPatches = async () => {
    if (!token) return;
    try {
      const { patches: p } = await patchesApi.list(token);
      setPatches(p.filter(p => p.hasWeights));
    } catch {
      // API not available, no patches to show
    }
  };

  const selectPatch = async (patch: PatchManifest) => {
    if (!token) return;

    // If clicking the already-active patch, unload it
    if (activePatchId === patch.id) {
      setIsLoading(true);
      try {
        await loraApi.unload(patch.id, token);
        setActivePatchId(null);
        onPatchChange?.(null, null);
      } catch (e) {
        console.error('Failed to unload patch:', e);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Load the new patch
    setIsLoading(true);
    try {
      // Unload any existing patch first
      if (activePatchId) {
        await loraApi.unload(activePatchId, token);
      }
      await patchesApi.load(patch.id, strength, token);
      setActivePatchId(patch.id);
      onPatchChange?.(patch, patch.triggerKeyword);
    } catch (e) {
      console.error('Failed to load patch:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateStrength = async (newStrength: number) => {
    setStrength(newStrength);
    if (!token || !activePatchId) return;
    try {
      await loraApi.scale(newStrength, activePatchId, token);
    } catch (e) {
      console.error('Failed to update strength:', e);
    }
  };

  // Don't render if no patches available — show coming soon notice
  if (patches.length === 0) {
    return (
      <div className="px-4 py-3">
        <div
          className="w-full flex items-center justify-center gap-2 py-2 text-xs text-zinc-500 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-white/10 rounded-lg opacity-60"
        >
          <Flame size={12} />
          Style Patches — coming in Creator Studio
        </div>
      </div>
    );
  }

  const activePatch = patches.find(p => p.id === activePatchId);

  return (
    <div className="border-t border-zinc-200 dark:border-white/5 px-4 py-3">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-2"
      >
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-purple-500" />
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Style Patch</span>
          {activePatch && (
            <span className="text-[10px] px-1.5 py-0.5 bg-accent-500/20 text-accent-400 rounded-full font-medium">
              {activePatch.name}
            </span>
          )}
        </div>
        <span className="text-[10px] text-zinc-400">{patches.length} available</span>
      </button>

      {/* Collapsed: show active patch only */}
      {!isExpanded && activePatch && (
        <div className="flex items-center gap-2 p-2 bg-accent-500/10 rounded-lg">
          <span className="text-xs text-accent-400 font-medium truncate flex-1">{activePatch.name}</span>
          <span className="text-[10px] font-mono text-zinc-400">{strength.toFixed(2)}</span>
          <button
            onClick={(e) => { e.stopPropagation(); selectPatch(activePatch); }}
            className="text-zinc-400 hover:text-red-400 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Expanded: patch grid */}
      {isExpanded && (
        <div className="space-y-2">
          {/* "No Style" option */}
          <button
            onClick={() => {
              if (activePatchId && token) {
                loraApi.unload(activePatchId, token);
                setActivePatchId(null);
                onPatchChange?.(null, null);
              }
            }}
            className={`w-full text-left p-2 rounded-lg text-xs transition-all ${
              !activePatchId
                ? 'bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white font-medium'
                : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5'
            }`}
          >
            Base Model (No Style)
          </button>

          {/* Patch buttons */}
          {patches.map((patch) => (
            <button
              key={patch.id}
              onClick={() => selectPatch(patch)}
              disabled={isLoading}
              className={`w-full text-left p-2 rounded-lg transition-all ${
                activePatchId === patch.id
                  ? 'bg-accent-500/10 border border-accent-500/30 text-white'
                  : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 border border-transparent'
              } ${isLoading ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{patch.name}</span>
                {isLoading && activePatchId === patch.id && <Loader2 size={10} className="animate-spin" />}
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
                {patch.triggerKeyword}
              </p>
            </button>
          ))}

          {/* Strength slider (when a patch is active) */}
          {activePatchId && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-zinc-500 w-14">Strength</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={strength}
                onChange={(e) => updateStrength(parseFloat(e.target.value))}
                className="flex-1 h-1 bg-zinc-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-500"
              />
              <span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{strength.toFixed(2)}</span>
            </div>
          )}

          {/* Link to Style Forge */}
          <button
            onClick={onNavigateToForge}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-zinc-500 hover:text-accent-500 transition-colors"
          >
            <Flame size={10} />
            Open Style Forge
          </button>
        </div>
      )}
    </div>
  );
};

export default PatchSelector;
