/**
 * Migrated out of @ts-nocheck on 2026-05-27 (Track C Gener8
 * web type-bridge migration, batch 1). Inspection found no
 * real type errors; the pragma was port-time blanket noise.
 */
import React, { useState } from 'react';
import { FileDown } from 'lucide-react';
import { lrcToSrt } from '../lib/lrcParser';

interface LrcExportProps {
  lrcData: string;
  title: string;
}

export const LrcExport: React.FC<LrcExportProps> = ({ lrcData, title }) => {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportSrt = async () => {
    try {
      setIsExporting(true);
      const srtContent = lrcToSrt(lrcData);

      if (!srtContent) {
        console.error('Failed to convert LRC to SRT');
        return;
      }

      // Create blob and trigger download
      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title || 'subtitles'}.srt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting SRT:', error);
    } finally {
      setIsExporting(false);
    }
  };

  if (!lrcData) return null;

  return (
    <button
      onClick={handleExportSrt}
      disabled={isExporting}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      title="Export LRC as SRT subtitle file"
    >
      <FileDown size={14} />
      <span>Export SRT</span>
    </button>
  );
};

export default LrcExport;
