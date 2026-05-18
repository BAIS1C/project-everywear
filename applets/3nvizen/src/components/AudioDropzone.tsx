import React, { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

export interface AudioDropzoneProps {
  audioPath: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioDropzone({ audioPath, onChange, disabled }: AudioDropzoneProps) {
  const [duration, setDuration] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Read duration client-side using HTMLAudioElement (no backend call)
  useEffect(() => {
    if (!audioPath) {
      setDuration(null);
      return;
    }
    // The backend consumes local paths directly. Playback preview still uses
    // the path as provided by the dialog until Tauri asset conversion is needed.
    const audio = new Audio();
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(formatDuration(audio.duration));
      }
    });
    audio.addEventListener("error", () => {
      setDuration("duration unknown");
    });

    // Try Tauri asset protocol path
    audio.src = audioPath;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [audioPath]);

  const handlePick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac"] }],
      });
      if (typeof selected === "string") {
        onChange(selected);
      }
    } catch {
      // User cancelled dialog
    }
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange(null);
    setDuration(null);
  }, [onChange]);

  if (audioPath) {
    return (
      <div className="tv-dropzone tv-dropzone--filled">
        <div className="tv-dropzone__thumb tv-dropzone__thumb--audio">AUD</div>
        <div className="tv-dropzone__body">
          <div className="tv-dropzone__title">{fileNameFromPath(audioPath)}</div>
          <div className="tv-dropzone__copy">
            {duration ? `Duration: ${duration}` : "Audio file loaded"}
          </div>
        </div>
        <button
          className="tv-dropzone__clear"
          onClick={handleClear}
          disabled={disabled}
          title="Remove audio"
          aria-label="Remove audio"
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
      <div className="tv-dropzone__thumb">AUD</div>
      <div className="tv-dropzone__body">
        <div className="tv-dropzone__title">Select audio file</div>
        <div className="tv-dropzone__copy">
          MP3, WAV, OGG, FLAC. Audio track for lip-synced video generation.
        </div>
      </div>
    </button>
  );
}
