// @ts-nocheck
/**
 * FontPicker — Searchable font dropdown with type-to-jump and last-used memory.
 *
 * Features:
 *   - Type a letter to scroll/filter the font list to that initial
 *   - Remembers last selected font in localStorage for next session
 *   - Shows font preview in each option row
 *   - Click outside or press Escape to close
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

const LS_KEY = 's3_vid_last_font';

/** Read last-used font from localStorage */
export function getLastFont(fallback = 'Inter'): string {
  try {
    return localStorage.getItem(LS_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/** Persist last-used font */
function saveLastFont(font: string) {
  try {
    localStorage.setItem(LS_KEY, font);
  } catch { /* noop */ }
}

interface FontPickerProps {
  fonts: string[];
  value: string;
  onChange: (font: string) => void;
}

export default function FontPicker({ fonts, value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Scroll to the active font when opening
  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector('[data-active="true"]');
      if (active) {
        active.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [open]);

  const filtered = search
    ? fonts.filter(f => f.toLowerCase().startsWith(search.toLowerCase()))
    : fonts;

  const handleSelect = useCallback((font: string) => {
    onChange(font);
    saveLastFont(font);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    } else if (e.key === 'Enter' && filtered.length > 0) {
      handleSelect(filtered[0]);
    }
  }, [filtered, handleSelect]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs text-white border border-white/5 text-left truncate hover:border-white/15 transition-colors"
        style={{ fontFamily: value }}
      >
        {value}
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 text-[8px]">&#9660;</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl shadow-black/60 overflow-hidden"
          style={{ maxHeight: 280 }}
        >
          {/* Search input */}
          <div className="px-2 py-1.5 border-b border-white/5">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type to filter..."
              className="w-full bg-zinc-800 rounded px-2 py-1 text-xs text-white border border-white/5 focus:outline-none focus:border-accent-500/40 placeholder-white/20"
            />
          </div>

          {/* Font list */}
          <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 230 }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-white/30">No matching fonts</div>
            ) : (
              filtered.map(font => (
                <button
                  key={font}
                  type="button"
                  data-active={font === value ? 'true' : undefined}
                  onClick={() => handleSelect(font)}
                  className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                    font === value
                      ? 'bg-accent-500/15 text-accent-400'
                      : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
                  }`}
                  style={{ fontFamily: font }}
                >
                  {font}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
