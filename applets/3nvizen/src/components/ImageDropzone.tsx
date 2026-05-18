import React, { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

export interface ImageDropzoneProps {
  imagePath: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function ImageDropzone({ imagePath, onChange, disabled }: ImageDropzoneProps) {
  const [fileSize, setFileSize] = useState<string | null>(null);

  const handlePick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      });
      if (typeof selected === "string") {
        onChange(selected);
        // File size would need Tauri fs API to read; leave as path-only for now
        setFileSize(null);
      }
    } catch {
      // User cancelled dialog
    }
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange(null);
    setFileSize(null);
  }, [onChange]);

  if (imagePath) {
    return (
      <div className="tv-dropzone tv-dropzone--filled">
        <div className="tv-dropzone__thumb tv-dropzone__thumb--image">IMG</div>
        <div className="tv-dropzone__body">
          <div className="tv-dropzone__title">{fileNameFromPath(imagePath)}</div>
          <div className="tv-dropzone__copy">
            {fileSize ?? "Source image loaded"}
          </div>
        </div>
        <button
          className="tv-dropzone__clear"
          onClick={handleClear}
          disabled={disabled}
          title="Remove image"
          aria-label="Remove image"
        >
          &times;
        </button>
      </div>
    );
  }

  return (
    <button
      className="tv-dropzone tv-dropzone--empty"
      onClick={handlePick}
      disabled={disabled}
    >
      <div className="tv-dropzone__thumb">IMG</div>
      <div className="tv-dropzone__body">
        <div className="tv-dropzone__title">Select source image</div>
        <div className="tv-dropzone__copy">
          PNG, JPG, or WebP. Used as the first frame for image-to-video generation.
        </div>
      </div>
    </button>
  );
}
