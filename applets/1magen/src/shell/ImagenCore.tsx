import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ResolutionPicker, RESOLUTION_PRESETS, type Resolution } from '../components/ResolutionPicker';
import * as api from '../lib/transport';
import { LockedFeatureCard, getLogger } from '@everywear/shared';
import { vaultRegisterImage } from '@everywear/transport';

const log = getLogger('1magen');

function joinPath(dir: string, filename: string) {
  if (dir.endsWith('\\') || dir.endsWith('/')) return `${dir}${filename}`;
  return `${dir}\\${filename}`;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function ImagenCore() {
  const [prompt, setPrompt] = useState(
    'A cinematic editorial portrait of Kasai, local-first AI consigliere, sharp gaze, subtle half-smile, black technical jacket with amber and cyan interface glows, rain-sheened city bokeh, premium concept art, grounded dramatic lighting, highly detailed skin and eyes.',
  );
  const [negativePrompt, setNegativePrompt] = useState(
    'blurry, duplicate face, extra limbs, deformed hands, text, watermark, logo, muddy contrast, flat lighting',
  );
  const [resolution, setResolution] = useState<Resolution>(RESOLUTION_PRESETS[0]);
  const [outputDir, setOutputDir] = useState('');
  const [sourceImagePath, setSourceImagePath] = useState<string | null>(null);
  const [seedText, setSeedText] = useState('42');
  const [status, setStatus] = useState<api.EngineStatus | null>(null);
  const [recommended, setRecommended] = useState<api.RecommendedStack | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.GenerationResult | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [vaultSaveState, setVaultSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null);
  const [runtimeCommandsReady, setRuntimeCommandsReady] = useState<boolean | null>(null);
  const [runtimeBridgeError, setRuntimeBridgeError] = useState<string | null>(null);
  const [autoSaveToVault, setAutoSaveToVault] = useState<boolean>(() => {
    try { return localStorage.getItem('1magen:auto_save_vault') === '1'; } catch { return false; }
  });

  const refreshStatus = useCallback(async () => {
    const next = await api.getStatus();
    setStatus(next);
    return next;
  }, []);

  const refreshRecommendation = useCallback(async () => {
    const next = await api.getRecommendedStack();
    setRecommended(next);
    return next;
  }, []);

  useEffect(() => {
    refreshStatus().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    refreshRecommendation().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    api.getDefaultOutputDir().then(setOutputDir).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [refreshRecommendation, refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    api.listModels()
      .then(() => {
        if (cancelled) return;
        setRuntimeCommandsReady(true);
        setRuntimeBridgeError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setRuntimeCommandsReady(false);
        setRuntimeBridgeError(
          message.includes('Command list_models not found')
            ? 'The 1magen engine handoff is not connected yet. Generation will unlock when the local runtime process is active.'
            : message,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ model_key: string; downloaded: number; total: number; pct: number }>('download-progress', (event) => {
      setDownloadLabel(`${event.payload.model_key} · ${event.payload.pct}%`);
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {
      // Browser preview or non-Tauri context.
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const downloadedKeys = useMemo(() => new Set(
    status?.available_models.filter((model) => model.downloaded).map((model) => model.key) ?? [],
  ), [status]);

  const stackReady = useMemo(() => {
    if (!recommended) return false;
    return recommended.required_model_keys.every((key) => downloadedKeys.has(key));
  }, [downloadedKeys, recommended]);

  const runtimeBlocked = runtimeCommandsReady === false;
  const runtimeChecking = runtimeCommandsReady === null;
  const generateDisabled = generating || !prompt.trim() || !outputDir || runtimeCommandsReady !== true;
  const generateButtonLabel = generating
    ? 'Generating...'
    : runtimeBlocked
      ? 'Runtime Handoff Pending'
      : runtimeChecking
        ? 'Checking Runtime'
        : sourceImagePath ? 'Transform Image' : 'Generate Image';

  const provisionRecommendedStack = useCallback(async () => {
    if (!recommended || provisioning || runtimeCommandsReady !== true) return;
    setProvisioning(true);
    setError(null);
    try {
      for (const key of recommended.required_model_keys) {
        if (!downloadedKeys.has(key)) {
          setDownloadLabel(`${key} · queued`);
          await api.downloadModel(key);
          await refreshStatus();
        }
      }
      setDownloadLabel('Local image stack ready');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setProvisioning(false);
    }
  }, [downloadedKeys, provisioning, recommended, refreshStatus, runtimeCommandsReady]);

  const ensureModelLoaded = useCallback(async () => {
    const recommendation = recommended ?? await refreshRecommendation();
    if (!stackReady) {
      await provisionRecommendedStack();
    }

    const current = await refreshStatus();
    const model = current.available_models.find((entry) => entry.key === recommendation.primary_model_key);
    if (!model?.downloaded) {
      throw new Error('Recommended local image stack is still unavailable after provisioning.');
    }

    if (current.engine_loaded && current.loaded_model?.includes(model.filename)) {
      return model;
    }

    log.info('model', 'Loading model', { model_key: model.key });
    await api.loadModel(model.key);
    await refreshStatus();
    log.info('model', 'Model loaded', { model_key: model.key });
    return model;
  }, [provisionRecommendedStack, recommended, refreshRecommendation, refreshStatus, stackReady]);

  const pickSourceImage = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (typeof selected === 'string') {
      setSourceImagePath(selected);
    }
  }, []);

  const pickOutputFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: outputDir || undefined,
        title: 'Select Output Folder',
      });
      if (typeof selected === 'string') {
        setOutputDir(selected);
      } else if (Array.isArray(selected) && typeof selected[0] === 'string') {
        setOutputDir(selected[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [outputDir]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || !outputDir || generating) return;
    if (runtimeCommandsReady !== true) {
      setError(runtimeBridgeError || 'The 1magen engine handoff is still being checked.');
      return;
    }
    setGenerating(true);
    setError(null);
    setSavedPath(null);

    const mode = sourceImagePath ? 'image-to-image' : 'text-to-image';
    const traceId = log.beginTrace('generation', 'Starting image generation', { mode });
    log.info('generation', 'Generate request', {
      mode,
      prompt: prompt.slice(0, 100),
      width: resolution.width,
      height: resolution.height,
    });

    try {
      await ensureModelLoaded();
      const parsedSeed = Number(seedText);
      const seed = Number.isFinite(parsedSeed) ? parsedSeed : undefined;

      const next = sourceImagePath
        ? await api.editImage({
            imagePath: sourceImagePath,
            prompt: prompt.trim(),
            seed,
          })
        : await api.generateImage({
            prompt: prompt.trim(),
            negativePrompt: negativePrompt.trim() || undefined,
            width: resolution.width,
            height: resolution.height,
            seed,
          });

      setResult(next);
      setVaultSaveState('idle');
      setVaultSaveError(null);

      const filename = `1magen-${Date.now()}-${next.seed}.png`;
      const fullPath = joinPath(outputDir, filename);
      await api.saveImage(next.image_base64, fullPath);
      setSavedPath(fullPath);

      log.endTrace('generation', 'Image generated successfully', {
        output_path: fullPath,
        width: resolution.width,
        height: resolution.height,
        duration_secs: next.elapsed_secs,
        seed: next.seed,
      });

      // Auto-save to vault if enabled
      if (autoSaveToVault) {
        try {
          await vaultRegisterImage({
            title: `Image ${new Date().toISOString().slice(0, 10)} ${prompt.trim().slice(0, 40)}`,
            filePath: fullPath,
            width: resolution.width,
            height: resolution.height,
            prompt: prompt.trim(),
            tags: ['1magen', 'image'],
            sourceAppId: '1magen',
            appletScope: '1magen',
            libraryScope: 'images',
          });
          setVaultSaveState('saved');
          log.info('vault', 'Image auto-saved to vault', { path: fullPath });
        } catch (err) {
          setVaultSaveState('error');
          setVaultSaveError(err instanceof Error ? err.message : 'Vault save failed');
          log.error('vault', 'Vault auto-save failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      log.error('generation', 'Image generation failed', { error: errMsg, trace_id: traceId });
    } finally {
      setGenerating(false);
    }
  }, [ensureModelLoaded, generating, negativePrompt, outputDir, prompt, resolution, runtimeBridgeError, runtimeCommandsReady, seedText, sourceImagePath]);

  const modeLabel = sourceImagePath ? 'Image to Image / Edit' : 'Text to Image';

  return (
    <div className="imagen-workbench">
      <div className="imagen-workbench__header">
        <div>
          <div className="imagen-workbench__eyebrow">Everywear Applet</div>
          <h1 className="imagen-workbench__title">1magen</h1>
          <p className="imagen-workbench__subtitle">
            Prompt, optional source image, resolution, output. The machine logic stays behind the scenes.
          </p>
        </div>
        <div className="imagen-workbench__status">
          <span className={`imagen-badge ${stackReady ? 'imagen-badge--ready' : 'imagen-badge--warn'}`}>
            {runtimeCommandsReady === false
              ? 'Runtime handoff pending'
              : runtimeCommandsReady === null
                ? 'Checking runtime'
                : stackReady ? 'Local stack ready' : provisioning ? 'Provisioning local stack' : 'Will auto-provision'}
          </span>
          <span className="imagen-badge">{modeLabel}</span>
        </div>
      </div>

      <div className="imagen-workbench__body">
        <section className="imagen-controls">
          <div className="imagen-field">
            <label className="imagen-field__label">Prompt</label>
            <textarea
              className="prompt-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the image you want to create..."
              disabled={generating}
            />
          </div>

          <div className="imagen-field">
            <label className="imagen-field__label">Source Image</label>
            <div className="imagen-source-row">
              <button className="imagen-secondary-btn" onClick={pickSourceImage} disabled={generating}>
                {sourceImagePath ? 'Replace Image' : 'Choose Image'}
              </button>
              {sourceImagePath && (
                <button className="imagen-secondary-btn" onClick={() => setSourceImagePath(null)} disabled={generating}>
                  Clear
                </button>
              )}
            </div>
            <div className="imagen-field__hint">
              {sourceImagePath
                ? `Using ${fileNameFromPath(sourceImagePath)} as the source frame for image editing / image-to-image.`
                : 'Leave empty for pure text-to-image generation.'}
            </div>
          </div>

          {!sourceImagePath && (
            <div className="imagen-field">
              <label className="imagen-field__label">Negative Prompt</label>
              <textarea
                className="prompt-input prompt-input--compact"
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
                placeholder="Things to avoid..."
                disabled={generating}
              />
            </div>
          )}

          <div className="imagen-field">
            <label className="imagen-field__label">Resolution</label>
            <ResolutionPicker selected={resolution} onChange={setResolution} />
            {sourceImagePath && (
              <div className="imagen-field__hint">
                Resolution presets are primarily for text-to-image. Source-image mode keeps the source framing path.
              </div>
            )}
          </div>

          <div className="imagen-field">
            <label className="imagen-field__label">Style Patch (LoRA)</label>
            <LockedFeatureCard
              title="LoRA Style Patches"
              description="Drag-and-drop style patches for LoRA-flavoured generation modifiers. Train and apply custom aesthetic presets."
              icon="🎨"
              tier="pro"
              progress="in-development"
            />
          </div>

          <div className="imagen-field">
            <label className="imagen-field__label">Task Shard (Workflow)</label>
            <LockedFeatureCard
              title="Task Shard Workflows"
              description="Drop a task shard to inject structured generation instructions. Workflow thumbnails drive multi-step generation pipelines."
              icon="🔧"
              tier="pro"
              progress="planned"
            />
          </div>

          <div className="imagen-field">
            <label className="imagen-field__label">Output Folder</label>
            <div className="imagen-output-row">
              <input
                className="imagen-input"
                value={outputDir}
                onChange={(event) => setOutputDir(event.target.value)}
                placeholder="Pictures\\Everywear"
              />
              <button className="imagen-secondary-btn" onClick={pickOutputFolder} disabled={generating}>
                Browse
              </button>
            </div>
            <div className="imagen-field__hint">Default save target is Pictures\Everywear.</div>
          </div>

          <div className="imagen-field">
            <label className="imagen-field__label">Seed</label>
            <input
              className="imagen-input"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
              placeholder="42"
            />
          </div>

          {runtimeBlocked && runtimeBridgeError && (
            <div className="imagen-runtime-note" role="status">
              {runtimeBridgeError}
            </div>
          )}

          <div className="imagen-action-bar">
            <button
              className={`imagen-primary-btn imagen-primary-btn--hero ${runtimeBlocked ? 'imagen-primary-btn--blocked' : ''}`}
              onClick={handleGenerate}
              disabled={generateDisabled}
              title={runtimeBlocked ? 'Generation unlocks when the local 1magen runtime process is connected.' : undefined}
            >
              {generateButtonLabel}
            </button>
          </div>

          {recommended && !runtimeBlocked && (
            <div className="imagen-field__hint">
              {recommended.rationale}
            </div>
          )}
          {downloadLabel && !runtimeBlocked && <div className="imagen-field__hint">{downloadLabel}</div>}
          {savedPath && <div className="imagen-field__hint">Saved to {savedPath}</div>}
          <label className="imagen-field__hint" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoSaveToVault}
              onChange={(e) => {
                setAutoSaveToVault(e.target.checked);
                try { localStorage.setItem('1magen:auto_save_vault', e.target.checked ? '1' : '0'); } catch {}
              }}
            />
            Auto-save to vault
          </label>
          {error && <div className="imagen-error">{error}</div>}
        </section>

        <section className="imagen-output">
          {result ? (
            <>
              <img
                className="imagen-output__image"
                src={`data:image/png;base64,${result.image_base64}`}
                alt={prompt}
              />
              <div className="imagen-output__meta">
                <span>{sourceImagePath ? 'Image to image' : `${resolution.width}×${resolution.height}`}</span>
                <span>{result.elapsed_secs.toFixed(1)}s</span>
                <span>seed:{result.seed}</span>
              </div>
              {/* Save to Vault */}
              {savedPath && (
                <div className="imagen-output__vault-actions">
                  {vaultSaveState === 'saved' ? (
                    <span className="imagen-vault-saved" style={{ color: 'var(--ew-status-green)' }}>
                      Saved to Vault
                    </span>
                  ) : vaultSaveState === 'saving' ? (
                    <span style={{ color: 'var(--ew-text-muted)', fontSize: '11px' }}>
                      Saving to vault...
                    </span>
                  ) : (
                    <button
                      className="imagen-secondary-btn"
                      onClick={async () => {
                        setVaultSaveState('saving');
                        setVaultSaveError(null);
                        try {
                          await vaultRegisterImage({
                            title: `Image ${new Date().toISOString().slice(0, 10)} ${prompt.trim().slice(0, 40)}`,
                            filePath: savedPath,
                            width: resolution.width,
                            height: resolution.height,
                            prompt: prompt.trim(),
                            tags: ['1magen', 'image'],
                            sourceAppId: '1magen',
                            appletScope: '1magen',
                            libraryScope: 'images',
                          });
                          setVaultSaveState('saved');
                          setTimeout(() => setVaultSaveState('idle'), 3000);
                        } catch (err) {
                          setVaultSaveState('error');
                          setVaultSaveError(err instanceof Error ? err.message : 'Vault save failed');
                        }
                      }}
                    >
                      Save to Vault
                    </button>
                  )}
                  {vaultSaveState === 'error' && vaultSaveError && (
                    <span style={{ color: 'var(--ew-status-red)', fontSize: '10px' }}>
                      {vaultSaveError}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="imagen-output__empty">
              <div className="imagen-output__empty-title">Output preview</div>
              <div className="imagen-output__empty-copy">
                Your generated image will appear here and be saved automatically to the selected output folder.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
