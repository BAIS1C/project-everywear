import React from 'react';

export interface GalleryImage {
  id: string;
  base64: string;
  prompt: string;
  seed: number;
  elapsed: number;
  width: number;
  height: number;
  timestamp: number;
}

interface Props {
  images: GalleryImage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function Gallery({ images, selectedId, onSelect }: Props) {
  if (images.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--ew-space-2)',
      padding: 'var(--ew-space-3)',
      overflowX: 'auto',
      background: 'var(--ew-chrome-bg)',
      borderTop: '1px solid var(--ew-border)',
      minHeight: 80,
    }}>
      {images.map(img => (
        <button
          key={img.id}
          onClick={() => onSelect(img.id)}
          style={{
            flex: '0 0 64px',
            width: 64,
            height: 64,
            border: img.id === selectedId
              ? '2px solid var(--ew-primary)'
              : '1px solid var(--ew-border)',
            borderRadius: 'var(--ew-radius)',
            background: 'var(--ew-surface-sunken)',
            padding: 0,
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          <img
            src={`data:image/png;base64,${img.base64}`}
            alt={img.prompt}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </button>
      ))}
    </div>
  );
}
