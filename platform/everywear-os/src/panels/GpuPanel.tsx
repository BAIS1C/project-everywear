import { useEffect, useState } from 'react';
import {
  getGpuStatus,
  listModelAssessments,
  type AssessmentStatus,
  type ComputeBackend,
  type ModelAssessment,
  type SystemGpuState,
} from '../lib/transport';

function backendLabel(b: ComputeBackend): string {
  switch (b.type) {
    case 'Cuda':
      return `CUDA ${b.cuda.driver_version}`;
    case 'Vulkan':
      return `Vulkan${b.vulkan.api_version ? ` ${b.vulkan.api_version}` : ''}`;
    case 'Cpu':
      return `CPU${b.has_blas ? ' + OpenBLAS' : ''}`;
  }
}

function backendBadgeClass(b: ComputeBackend): string {
  switch (b.type) {
    case 'Cuda': return 'ew-badge--cuda';
    case 'Vulkan': return 'ew-badge--vulkan';
    case 'Cpu': return 'ew-badge--cpu';
  }
}

function assessmentBadgeClass(status: AssessmentStatus): string {
  switch (status) {
    case 'Ready':
      return 'ew-badge--ready';
    case 'Reduced':
      return 'ew-badge--reduced';
    case 'SetupRequired':
      return 'ew-badge--setup';
    case 'Unsupported':
      return 'ew-badge--unsupported';
  }
}

function assessmentLabel(status: AssessmentStatus): string {
  switch (status) {
    case 'Ready':
      return 'Ready';
    case 'Reduced':
      return 'Reduced Fit';
    case 'SetupRequired':
      return 'Setup Required';
    case 'Unsupported':
      return 'Unsupported';
  }
}

export function GpuPanel() {
  const [gpu, setGpu] = useState<SystemGpuState | null>(null);
  const [assessments, setAssessments] = useState<ModelAssessment[]>([]);

  useEffect(() => {
    const refresh = () => {
      getGpuStatus().then(setGpu).catch(console.error);
      listModelAssessments().then(setAssessments).catch(console.error);
    };

    refresh();
    const interval = setInterval(() => {
      refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!gpu) return <div style={{ color: 'var(--ew-text-muted)' }}>Detecting compute backend...</div>;

  const backend = gpu.backend;
  const isCpu = backend.type === 'Cpu';
  const imageAssessment = assessments.find((item) => item.applet_id === '1magen');

  return (
    <div className="ew-gpu-panel">
      <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
        Hardware
      </h2>

      {/* Backend summary bar */}
      <div className="ew-section" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span
            className={`ew-badge ${backendBadgeClass(backend)}`}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--ew-font-mono)',
            }}
          >
            {backendLabel(backend)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ew-text-muted)' }}>
            {gpu.vram_tier.replace('CpuFallback', 'CPU Fallback')} tier
          </span>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ew-text-muted)', lineHeight: 1.8 }}>
          {backend.type === 'Cuda' && (
            <>
              <div>cuBLAS: {backend.cuda.cublas_available ? 'Available' : 'Not found (needs provisioning)'}</div>
              {backend.cuda.toolkit_version && <div>CUDA Toolkit: {backend.cuda.toolkit_version}</div>}
              {backend.cuda.compute_capability && (
                <div>Compute Capability: SM {backend.cuda.compute_capability[0]}.{backend.cuda.compute_capability[1]}</div>
              )}
              <div>Flash Attention: {
                backend.cuda.compute_capability && backend.cuda.compute_capability[0] >= 7
                  ? 'Supported (SM 7.0+)' : 'Not supported'
              }</div>
              <div>MoE Offloading: Supported</div>
            </>
          )}
          {backend.type === 'Vulkan' && (
            <>
              {backend.vulkan.api_version && <div>Vulkan API: {backend.vulkan.api_version}</div>}
              <div>MoE Offloading: Supported</div>
            </>
          )}
          {backend.type === 'Cpu' && (
            <>
              <div>System RAM: {backend.ram_mb.toLocaleString()} MB</div>
              <div>OpenBLAS: {backend.has_blas ? 'Available' : 'Not found'}</div>
              <div>MoE Offloading: Not available</div>
            </>
          )}
        </div>
      </div>

      {imageAssessment && (
        <div className="ew-section" style={{ marginBottom: 20 }}>
          <div className="ew-section__title">Base Model Assessment</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'var(--ew-font-display)', fontSize: 16, color: 'var(--ew-text)' }}>
              {imageAssessment.applet_name}
            </div>
            <span
              className={`ew-badge ${assessmentBadgeClass(imageAssessment.status)}`}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--ew-font-mono)',
              }}
            >
              {assessmentLabel(imageAssessment.status)}
            </span>
            {imageAssessment.recommended_group && (
              <span style={{ fontSize: 12, color: 'var(--ew-text-muted)' }}>
                Recommended: {imageAssessment.recommended_group}
              </span>
            )}
          </div>

          <div style={{ fontSize: 13, color: 'var(--ew-text-muted)', lineHeight: 1.7 }}>
            <div>{imageAssessment.rationale}</div>
            {imageAssessment.recommended_primary_model && (
              <div>Primary local weight: {imageAssessment.recommended_primary_model}</div>
            )}
            {imageAssessment.recommended_vram_mb && (
              <div>
                Local target VRAM: {imageAssessment.recommended_vram_mb.toLocaleString()} MB
                {' '}of {imageAssessment.total_vram_mb.toLocaleString()} MB detected
              </div>
            )}
            <div>Smallest supported local group: {imageAssessment.min_required_vram_mb.toLocaleString()} MB</div>
          </div>
        </div>
      )}

      {/* CPU-only warning */}
      {isCpu && (
        <div className="ew-section" style={{ borderColor: 'var(--ew-warning)' }}>
          <div className="ew-section__title" style={{ color: 'var(--ew-warning)' }}>
            CPU-Only Mode
          </div>
          <p style={{ fontSize: 14, color: 'var(--ew-text-muted)', lineHeight: 1.6 }}>
            No GPU detected. Inference will run on CPU and be significantly slower.
            Install NVIDIA drivers for CUDA, or ensure Vulkan drivers are available.
          </p>
        </div>
      )}

      {/* VRAM summary */}
      {!isCpu && (
        <div style={{ fontSize: 13, color: 'var(--ew-text-muted)', marginBottom: 20 }}>
          Total VRAM: {gpu.total_vram_mb.toLocaleString()} MB &middot;
          Free: {gpu.total_free_mb.toLocaleString()} MB
        </div>
      )}

      {/* Per-GPU cards */}
      {gpu.gpus.map((g) => {
        const usedPct = g.vram_total_mb > 0 ? (g.vram_used_mb / g.vram_total_mb) * 100 : 0;
        return (
          <div key={g.index} className="ew-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div className="ew-gpu__name">{g.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ew-text-faint)', marginTop: 4 }}>
                  Driver: {g.driver_version} &middot; CUDA: {g.cuda_version} &middot;
                  Compute: {g.compute_capability}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {g.temperature_c > 0 && (
                  <div style={{ fontFamily: 'var(--ew-font-mono)', fontSize: 13 }}>
                    {g.temperature_c}&deg;C
                  </div>
                )}
                {g.utilization_gpu > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--ew-text-faint)' }}>
                    GPU {g.utilization_gpu}%
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--ew-text-muted)' }}>VRAM</span>
                <span className="ew-gpu__label">
                  {g.vram_used_mb.toLocaleString()} / {g.vram_total_mb.toLocaleString()} MB
                </span>
              </div>
              <div className="ew-gpu__bar-track">
                <div
                  className="ew-gpu__bar-fill"
                  style={{
                    width: `${usedPct}%`,
                    background: usedPct > 90 ? 'var(--ew-danger)' : usedPct > 70 ? 'var(--ew-warning)' : 'var(--ew-primary)',
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
