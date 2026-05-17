import React from 'react';

export interface Resolution {
  label: string;
  width: number;
  height: number;
}

const PRESETS: Resolution[] = [
  { label: '1920x1080', width: 1920, height: 1080 },
  { label: '1080x1920', width: 1080, height: 1920 },
  { label: '1024x1024', width: 1024, height: 1024 },
  { label: '1024x768',  width: 1024, height: 768  },
  { label: '768x1024',  width: 768,  height: 1024 },
  { label: '1280x720',  width: 1280, height: 720  },
  { label: '720x1280',  width: 720,  height: 1280 },
  { label: '512x512',   width: 512,  height: 512  },
];

interface Props {
  selected: Resolution;
  onChange: (res: Resolution) => void;
}

export function ResolutionPicker({ selected, onChange }: Props) {
  const selectedValue = `${selected.width}x${selected.height}`;

  return (
    <select
      className="imagen-select"
      value={selectedValue}
      onChange={(event) => {
        const next = PRESETS.find((preset) => preset.label === event.target.value);
        if (next) onChange(next);
      }}
    >
      {PRESETS.map((res) => (
        <option key={res.label} value={res.label}>
          {res.label}
        </option>
      ))}
    </select>
  );
}

export { PRESETS as RESOLUTION_PRESETS };
