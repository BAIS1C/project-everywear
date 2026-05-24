// @ts-nocheck
/**
 * SearchPage — Community search & discovery surface for the Gener8 applet.
 *
 * COMING SOON state (2026-04-25 SGT, Sean):
 *   The full surface (Featured Songs / Creators / Playlists, genre tag
 *   browser, server-side search) ships once Strands has the social
 *   playlist sharing infra and dedicated server space to back it. Until
 *   then this page is intentionally a single Coming Soon panel so users
 *   are not promised something the backend cannot deliver.
 *
 *   The previous 611-line implementation (search/api wiring, infinite
 *   scroll, copy-tag UX, featured carousels) is preserved in git history
 *   and will be reinstated when the social layer lands.
 *
 * Component signature kept identical to avoid touching Gener8Core's
 * import + render call. All props are accepted but unused.
 */
import React from 'react';
import { Search, Users, ListMusic, Music2 } from 'lucide-react';
import { Song, Playlist } from '../types';
import { UserProfile } from '../services/api';

export interface SearchPageProps {
  onPlaySong?: (song: Song, list?: Song[]) => void;
  currentSong?: Song | null;
  isPlaying?: boolean;
  onNavigateToProfile?: (username: string) => void;
  onNavigateToSong?: (songId: string) => void;
  onNavigateToPlaylist?: (playlistId: string) => void;
}

const PILLARS: { icon: React.ReactNode; title: string; sub: string }[] = [
  {
    icon: <Music2 size={16} />,
    title: 'Featured Songs',
    sub: 'Curated tracks from the community feed.',
  },
  {
    icon: <Users size={16} />,
    title: 'Featured Creators',
    sub: 'Discover producers shaping new sounds.',
  },
  {
    icon: <ListMusic size={16} />,
    title: 'Featured Playlists',
    sub: 'Public sets you can clone, remix, and follow.',
  },
  {
    icon: <Search size={16} />,
    title: 'Community Search',
    sub: 'Search across songs, creators, and playlists.',
  },
];

export const SearchPage: React.FC<SearchPageProps> = () => {
  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: 'var(--ew-bg)' }}
    >
      <div className="max-w-2xl mx-auto px-6 py-16 flex flex-col items-center text-center">

        {/* Eyebrow */}
        <div
          style={{
            fontFamily: 'var(--ew-font-mono)',
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'var(--ew-text-faint)',
            marginBottom: 14,
          }}
        >
          Strands · Community
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: 'var(--ew-font-display)',
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--ew-text)',
            lineHeight: 1.1,
            marginBottom: 12,
          }}
        >
          Community Search
        </h1>

        {/* Status badge */}
        <div
          className="inline-flex items-center gap-2"
          style={{
            padding: '6px 14px',
            border: '1px solid var(--ew-warm)',
            color: 'var(--ew-warm)',
            background: 'var(--ew-warm-soft)',
            fontFamily: 'var(--ew-font-mono)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginBottom: 24,
          }}
        >
          <span
            className="inline-block"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--ew-warm)',
            }}
          />
          Coming Soon
        </div>

        {/* Lead copy */}
        <p
          style={{
            fontFamily: 'var(--ew-font-body)',
            fontSize: 15,
            lineHeight: 1.6,
            color: 'var(--ew-text-muted)',
            maxWidth: 520,
            marginBottom: 36,
          }}
        >
          Featured songs, creators, and public playlists arrive once social
          playlist sharing and dedicated community storage ship. Strands does
          not run social infra it cannot back, so this surface stays quiet
          until the layer behind it is real.
        </p>

        {/* What lands here */}
        <div
          className="w-full grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="flex items-start gap-3 text-left p-4"
              style={{
                background: 'var(--ew-surface)',
                border: '1px solid var(--ew-border)',
                clipPath: 'var(--ew-clip-card-inner)',
              }}
            >
              <span
                style={{
                  color: 'var(--ew-text-faint)',
                  marginTop: 2,
                  flexShrink: 0,
                }}
              >
                {p.icon}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--ew-font-mono)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'var(--ew-text)',
                    marginBottom: 4,
                  }}
                >
                  {p.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ew-text-faint)',
                    lineHeight: 1.5,
                  }}
                >
                  {p.sub}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          className="mt-10"
          style={{
            fontFamily: 'var(--ew-font-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ew-text-faint)',
          }}
        >
          Make tracks now in Gener8 · Community lands in a later wave
        </div>
      </div>
    </div>
  );
};

// Defensive named exports so any historical re-import patterns continue to
// resolve without touching call sites.
export default SearchPage;
export type { Song, Playlist, UserProfile };
