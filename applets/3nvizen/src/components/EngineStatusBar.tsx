import React, { useCallback, useEffect, useState } from 'react';
import type { GpuInfo, ModelStatusResponse } from '../transport';
import * as api from '../transport';

export interface EngineStatusBarProps {
  online: boolean;
}

export function EngineStatusBar({ online }: EngineStatusBarProps) {
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusResponse | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Fetch GPU info on mount + when online status changes
  useEffect(() => {
    if (!online) {
      setGpuInfo(null);
      return;
    }
    api.getGpuInfo()
      .then(setGpuInfo)
      .catch(() => setGpuInfo(null));
  }, [online]);

  // Fetch model status on mount + when online status changes
  const refreshModels = useCallback(() => {
    if (!online) {
      setModelStatus(null);
      return;
    }
    api.getModelStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
  }, [online]);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const handleDownload = useCallback((modelId: string) => {
    if (downloadingModel) return;
    setDownloadingModel(modelId);
    setDownloadProgress(0);
    setDownloadError(null);

    const handle = api.downloadModelWithProgress(
      modelId,
      (pct) => setDownloadProgress(pct),
      () => {
        setDownloadingModel(null);
        setDownloadProgress(0);
        refreshModels();
      },
      (error) => {
        setDownloadError(error);
        setDownloadingModel(null);
      },
    );

    // Cleanup not strictly needed here since downloadModelWithProgress
    // self-terminates, but good practice
    return () => handle.stop();
  }, [downloadingModel, refreshModels]);

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!modelId) return;
    try {
      setDownloadError(null);
      await api.loadModel(modelId);
      refreshModels();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshModels]);

  const currentModel = modelStatus?.current_model;
  const models = modelStatus?.models ?? [];

  return (
    <div className="tv-engine-bar">
      {/* GPU Badge */}
      <div className="tv-engine-bar__gpu">
        {!online ? (
          <span className="tv-badge tv-badge--danger">Engine Offline</span>
        ) : gpuInfo ? (
          <span className={`tv-badge ${gpuInfo.cuda_available ? "tv-badge--ok" : "tv-badge--danger"}`}>
            {gpuInfo.cuda_available
              ? `${gpuInfo.gpu_name} · ${gpuInfo.vram_free_gb.toFixed(1)} GB free`
              : "CPU Mode"}
          </span>
        ) : (
          <span className="tv-badge">GPU: loading...</span>
        )}
      </div>

      {/* Model Selector */}
      <div className="tv-engine-bar__models">
        {online && models.length > 0 && (
          <div className="tv-model-select-wrap">
            <select
              className="tv-model-select"
              value={currentModel ?? ""}
              onChange={(event) => void handleModelChange(event.target.value)}
              disabled={!!downloadingModel}
            >
              {!currentModel && <option value="">No model loaded</option>}
              {models.map((m) => {
                const known = api.KNOWN_MODELS[m.model_id];
                const label = known
                  ? `${known.label} (${known.sizeGb} GB)`
                  : `${m.model_id}${m.size_gb ? ` (${m.size_gb} GB)` : ""}`;
                return (
                  <option key={m.model_id} value={m.model_id} disabled={m.status === "not_downloaded"}>
                    {label} {m.status === "not_downloaded" ? " [not downloaded]" : ""}
                  </option>
                );
              })}
            </select>

            {/* Download button for models that need it */}
            {models.some((m) => m.status === "not_downloaded") && !downloadingModel && (
              <div className="tv-engine-bar__download-actions">
                {models
                  .filter((m) => m.status === "not_downloaded")
                  .map((m) => (
                    <button
                      key={m.model_id}
                      className="tv-btn tv-btn--primary tv-btn--sm"
                      onClick={() => handleDownload(m.model_id)}
                    >
                      Download {api.KNOWN_MODELS[m.model_id]?.label ?? m.model_id}
                    </button>
                  ))}
              </div>
            )}

            {/* Download progress */}
            {downloadingModel && (
              <div className="tv-download-progress">
                <div className="tv-download-progress__label">
                  Downloading {api.KNOWN_MODELS[downloadingModel]?.label ?? downloadingModel}
                </div>
                <div className="tv-progress-track">
                  <div
                    className="tv-progress-fill"
                    style={{ width: `${(downloadProgress * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="tv-download-progress__pct">
                  {(downloadProgress * 100).toFixed(0)}%
                </div>
              </div>
            )}

            {downloadError && (
              <div className="tv-error-inline">{downloadError}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
