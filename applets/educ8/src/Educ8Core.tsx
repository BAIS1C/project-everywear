import React from 'react';
import { CONTENT_PACKS, ContentPack, IGCSE_MODULES, PEDAGOGY } from './learningContent';
import { MY_MAITS_LITE_HOST_CONTRACTS } from '@everywear/transport';

export interface Educ8CoreProps {
  skin?: string;
  mode?: string;
}

// Internal implementation-status panels (migration phases, source maps, port rules)
// are diagnostics only. Keep this false for the user-facing build.
const SHOW_DEV_STATUS = false;

type PhaseState = 'active' | 'planned' | 'blocked';

interface MigrationPhase {
  id: string;
  title: string;
  state: PhaseState;
  source: string;
  target: string;
  nextStep: string;
}

const PHASES: MigrationPhase[] = [
  {
    id: '01',
    title: 'My Maits Lite teacher bridge',
    state: 'active',
    source: 'Ollama Docker, OpenAI-compatible chat, embeddings',
    target: 'loom-teacher over the shared My Maits Lite headless runtime',
    nextStep: 'Bind lesson planning, model scan, embeddings, and benchmark contracts.',
  },
  {
    id: '02',
    title: 'SQLite foundation',
    state: 'active',
    source: 'Legacy learning database models and schema notes',
    target: 'loom-db with consolidated schema and future schema updates',
    nextStep: 'Create schema module for chats, resources, chunks, notes, and jobs.',
  },
  {
    id: '03',
    title: 'Vector retrieval',
    state: 'planned',
    source: 'Qdrant service and payload indexes',
    target: 'usearch vectors plus SQLite chunk metadata',
    nextStep: 'Build the vector index wrapper after loom-db lands.',
  },
  {
    id: '04',
    title: 'Offline library',
    state: 'planned',
    source: 'Kiwix server, ZIM catalog, educational packs',
    target: 'native ZIM reader, content manifests, Axum routes',
    nextStep: 'Show manifest, size, checksum, learner fit, and explicit accept controls before any download.',
  },
  {
    id: '05',
    title: 'Axum service surface',
    state: 'planned',
    source: 'AdonisJS controllers and Inertia pages',
    target: 'loom-server handlers and Everywear-hosted applet UI',
    nextStep: 'Translate controller contracts into typed Axum handler modules.',
  },
  {
    id: '06',
    title: 'Maps, tools, notes',
    state: 'planned',
    source: 'PMTiles, CyberChef, FlatNotes containers',
    target: 'loom-maps, loom-datatools, loom-notes',
    nextStep: 'Keep each feature crate thin and file-backed where possible.',
  },
  {
    id: '07',
    title: 'Everywear integration',
    state: 'blocked',
    source: 'Legacy standalone admin panel',
    target: 'Everywear app registration, vault search, licence gate',
    nextStep: 'Unblock after backend contracts expose searchable documents.',
  },
];

const DOCS = [
  'Loom_Architecture_v1.md',
  'Loom_Transfer_01_MyMaitsLite_teacher_runtime.md',
  'Loom_Transfer_02_learning_store_sqlite.md',
  'Loom_Transfer_03_vectors_usearch.md',
  'Loom_Transfer_04_content_packs_zim.md',
  'Loom_Transfer_05_service_handlers_axum.md',
  'Loom_Transfer_06_maps_content_tools.md',
  'Loom_Transfer_07_notes_and_datatools.md',
];

interface NativeEduc8Resource {
  id: string;
  title: string;
  url?: string | null;
  filename?: string | null;
  sizeBytes: number;
  sha256?: string | null;
}

interface NativeEduc8Pack {
  id: string;
  module: string;
  title: string;
  packType: ContentPack['type'];
  status: ContentPack['status'];
  source: string;
  resolver: string;
  tooltip: string;
  resources: NativeEduc8Resource[];
}

interface NativeEduc8Plan {
  packs: NativeEduc8Pack[];
  downloadRoot: string;
  canonicalLink: string;
  linkStatus: string;
  totalSizeBytes: number;
  downloadableSizeBytes: number;
  missingDownloadRoot: boolean;
}

interface NativeEduc8Root {
  downloadRoot: string;
  canonicalLink: string;
  linkStatus: string;
}

interface Educ8Progress {
  packId: string;
  resourceId: string;
  downloadedBytes: number;
  totalBytes: number;
  pct: number;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function packSize(pack: Pick<NativeEduc8Pack, 'resources'>) {
  return pack.resources.reduce((total, resource) => total + resource.sizeBytes, 0);
}

function nativeToContentPack(pack: NativeEduc8Pack): ContentPack {
  return {
    id: pack.id,
    module: pack.module,
    title: pack.title,
    type: pack.packType,
    status: pack.status,
    size: formatBytes(packSize(pack)),
    source: pack.source,
    resolver: pack.resolver,
    tooltip: pack.tooltip,
    resources: pack.resources,
  };
}

async function invokeEduc8<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function stateLabel(state: PhaseState) {
  if (state === 'active') return 'Active';
  if (state === 'planned') return 'Plan first';
  return 'Blocked';
}

export function Educ8Core({ skin, mode }: Educ8CoreProps) {
  const teacherContract = MY_MAITS_LITE_HOST_CONTRACTS.loom_teacher;
  const [contentPacks, setContentPacks] = React.useState<ContentPack[]>(CONTENT_PACKS);
  const [selectedPacks, setSelectedPacks] = React.useState<Set<string>>(
    () => new Set(CONTENT_PACKS.filter((pack) => pack.status !== 'optional').map((pack) => pack.id)),
  );
  const [activeModuleId, setActiveModuleId] = React.useState(IGCSE_MODULES[0]?.id ?? '');
  const [setupMessage, setSetupMessage] = React.useState('Ready to build an offline IGCSE teacher pack.');
  const [planAccepted, setPlanAccepted] = React.useState(false);
  const [nativePlan, setNativePlan] = React.useState<NativeEduc8Plan | null>(null);
  const [downloadRoot, setDownloadRoot] = React.useState<NativeEduc8Root | null>(null);
  const [progress, setProgress] = React.useState<Educ8Progress | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const active = PHASES.filter((phase) => phase.state === 'active').length;
  const planned = PHASES.filter((phase) => phase.state === 'planned').length;
  const blocked = PHASES.filter((phase) => phase.state === 'blocked').length;
  const activeModule = IGCSE_MODULES.find((module) => module.id === activeModuleId) ?? IGCSE_MODULES[0];
  const activePackIds = new Set(activeModule?.packIds ?? []);
  const modulePacks = contentPacks.filter((pack) => activePackIds.has(pack.id));
  const selectedPackIds = React.useMemo(() => Array.from(selectedPacks), [selectedPacks]);

  React.useEffect(() => {
    let cancelled = false;
    invokeEduc8<NativeEduc8Pack[]>('educ8_get_content_manifest')
      .then((packs) => {
        if (cancelled) return;
        setContentPacks(packs.map(nativeToContentPack));
      })
      .catch(() => {
        if (!cancelled) {
          setSetupMessage('Desktop content manager unavailable; showing the built-in Educ8 content plan.');
        }
      });
    invokeEduc8<NativeEduc8Root>('educ8_get_download_root')
      .then((root) => {
        if (!cancelled) setDownloadRoot(root);
      })
      .catch(() => undefined);
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<Educ8Progress>('educ8-download-progress', (event) => {
        if (!cancelled) setProgress(event.payload);
      }))
      .then((unlisten) => {
        if (cancelled) unlisten();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    invokeEduc8<NativeEduc8Plan>('educ8_get_content_plan', { packIds: selectedPackIds })
      .then((plan) => {
        if (!cancelled) setNativePlan(plan);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedPackIds]);

  function togglePack(id: string) {
    setSelectedPacks((current) => {
      const next = new Set(current);
      const pack = contentPacks.find((item) => item.id === id);
      if (pack?.status === 'required') return next;
      if (next.has(id)) {
        next.delete(id);
        setSetupMessage(`Removed ${pack?.title ?? 'pack'} from the download plan.`);
      } else {
        next.add(id);
        setSetupMessage(`Added ${pack?.title ?? 'pack'} to the download plan.`);
      }
      return next;
    });
  }

  function planDownload() {
    const selected = contentPacks.filter((pack) => selectedPacks.has(pack.id));
    const bytes = nativePlan?.downloadableSizeBytes ?? selected.reduce((sum, pack) => {
      const resources = pack.resources ?? [];
      return sum + resources.reduce((inner, resource) => inner + resource.sizeBytes, 0);
    }, 0);
    setSetupMessage(
      `Planned ${selected.length} item${selected.length === 1 ? '' : 's'}: ${formatBytes(bytes)} downloadable via ${downloadRoot?.downloadRoot ?? nativePlan?.downloadRoot ?? 'the Educ8 content root'}.`,
    );
    setPlanAccepted(false);
  }

  function acceptPlan() {
    const selected = contentPacks.filter((pack) => selectedPacks.has(pack.id));
    setPlanAccepted(true);
    setSetupMessage(
      `Accepted ${selected.length} item${selected.length === 1 ? '' : 's'} for download review. Exact URLs, sizes, and the symlink target are visible before transfer.`,
    );
  }

  async function chooseDownloadRoot() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title: 'Choose Educ8 download location' });
    if (typeof selected !== 'string') return;
    const root = await invokeEduc8<NativeEduc8Root>('educ8_set_download_root', { path: selected });
    setDownloadRoot(root);
    setSetupMessage(`Educ8 content root linked: ${root.canonicalLink}`);
  }

  async function downloadSelected() {
    setIsDownloading(true);
    try {
      await invokeEduc8('educ8_download_packs', { request: { packIds: selectedPackIds } });
      setSetupMessage('Educ8 downloads complete and visible through the canonical content link.');
    } catch (error) {
      setSetupMessage(`Educ8 download blocked: ${String(error)}`);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="educ8-root" data-skin={skin} data-mode={mode}>
      <section className="educ8-header">
        <div>
          <p className="educ8-kicker">Agentic education for the home</p>
          <h1>Educ8</h1>
          <p className="educ8-tagline">Weaving Agentic Education into your Home.</p>
        </div>
        {SHOW_DEV_STATUS && (
          <div className="educ8-meter" aria-label="Diagnostics: implementation status">
            <span><strong>{active}</strong> active</span>
            <span><strong>{planned}</strong> planned</span>
            <span><strong>{blocked}</strong> blocked</span>
          </div>
        )}
      </section>

      {SHOW_DEV_STATUS && (
        <section className="educ8-grid" aria-label="Diagnostics: implementation phases">
          {PHASES.map((phase) => (
            <article className={`educ8-phase educ8-phase--${phase.state}`} key={phase.id}>
              <header className="educ8-phase__header">
                <span className="educ8-phase__id">{phase.id}</span>
                <span className="educ8-phase__state">{stateLabel(phase.state)}</span>
              </header>
              <h2>{phase.title}</h2>
              <dl>
                <div>
                  <dt>From</dt>
                  <dd>{phase.source}</dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>{phase.target}</dd>
                </div>
              </dl>
              <p className="educ8-phase__next">{phase.nextStep}</p>
            </article>
          ))}
        </section>
      )}

      <section className="educ8-setup" aria-label="IGCSE setup and content selection">
        <div className="educ8-panel-head">
          <div>
            <p className="educ8-kicker">Learner Setup</p>
            <h2>IGCSE Teacher Pack</h2>
          </div>
          <button
            type="button"
            className="educ8-action"
            onClick={planDownload}
            title="Creates a transparent download plan. The real downloader must show exact URLs, file sizes, checksums, and ask before fetching large files."
          >
            Plan Downloads
          </button>
          <button
            type="button"
            className="educ8-action educ8-action--secondary"
            onClick={chooseDownloadRoot}
            title="Chooses where large Educ8 files are stored. Everywear creates a canonical symlink to this location."
          >
            Choose Location
          </button>
          <button
            type="button"
            className="educ8-action educ8-action--secondary"
            onClick={acceptPlan}
            title="Accepts the visible plan for manifest review only. It does not download files yet."
          >
            Accept Plan
          </button>
          <button
            type="button"
            className="educ8-action"
            onClick={downloadSelected}
            disabled={!planAccepted || isDownloading}
            title="Starts shell-owned downloads for accepted content packs."
          >
            {isDownloading ? 'Downloading' : 'Download'}
          </button>
        </div>

        {(nativePlan || downloadRoot) && (
          <div className="educ8-storage">
            <span>
              <strong>{formatBytes(nativePlan?.downloadableSizeBytes ?? 0)}</strong> downloadable
            </span>
            <span>{downloadRoot?.downloadRoot ?? nativePlan?.downloadRoot}</span>
            <span>{downloadRoot?.linkStatus ?? nativePlan?.linkStatus}</span>
          </div>
        )}

        {progress && (
          <div className="educ8-progress" aria-label="Download progress">
            <span>{progress.resourceId}</span>
            <strong>{progress.pct}%</strong>
            <em>{formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}</em>
          </div>
        )}

        <div className="educ8-notice" role="status">
          <strong>Educ8 says:</strong> {setupMessage}
          {planAccepted && <span className="educ8-plan-state"> Accepted for manifest review.</span>}
        </div>

        <div className="educ8-module-tabs" role="tablist" aria-label="IGCSE subjects">
          {IGCSE_MODULES.map((module) => (
            <button
              key={module.id}
              type="button"
              role="tab"
              aria-selected={module.id === activeModuleId}
              className={module.id === activeModuleId ? 'active' : ''}
              onClick={() => {
                setActiveModuleId(module.id);
                setSetupMessage(`Showing ${module.subject}: ${module.code}.`);
              }}
              title={`Switch to ${module.subject}. Tracks ${module.code}; exam years: ${module.years}.`}
            >
              {module.subject}
            </button>
          ))}
        </div>

        {activeModule && (
          <article className="educ8-syllabus">
            <div>
              <span className="educ8-syllabus__code">{activeModule.code}</span>
              <h3>{activeModule.subject}</h3>
              <p>{activeModule.years}</p>
            </div>
            <ul>
              {activeModule.focus.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        )}

        <div className="educ8-pack-list">
          {modulePacks.map((pack) => (
            <label
              className={`educ8-pack educ8-pack--${pack.status}`}
              key={pack.id}
              title={pack.tooltip}
            >
              <input
                type="checkbox"
                checked={selectedPacks.has(pack.id)}
                disabled={pack.status === 'required'}
                onChange={() => togglePack(pack.id)}
              />
              <span className="educ8-pack__body">
                <span className="educ8-pack__top">
                  <strong>{pack.title}</strong>
                  <em>{pack.status}</em>
                </span>
                <span>{pack.module} · {pack.type.toUpperCase()} · {pack.size}</span>
                <span className="educ8-pack__resolver">{pack.resolver}</span>
                {pack.resources && pack.resources.length > 0 && (
                  <span className="educ8-pack__resources">
                    {pack.resources.map((resource) => `${resource.title}: ${formatBytes(resource.sizeBytes)}`).join(' · ')}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="educ8-teacher" aria-label="Teacher pedagogy model">
        <div className="educ8-panel-head">
          <div>
            <p className="educ8-kicker">{SHOW_DEV_STATUS ? teacherContract.label : 'AI Tutor'}</p>
            <h2>Pedagogy Model</h2>
          </div>
        </div>
        <div className="educ8-principles">
          {PEDAGOGY.map((principle) => (
            <article
              key={principle.title}
              className="educ8-principle"
              title={`Your AI tutor uses this principle when planning lessons, feedback, and revision prompts: ${principle.summary}`}
            >
              <h3>{principle.title}</h3>
              <p>{principle.summary}</p>
            </article>
          ))}
        </div>
      </section>

      {SHOW_DEV_STATUS && (
        <aside className="educ8-rail" aria-label="Diagnostics: sources and rules">
          <section>
            <h2>Source Maps</h2>
            <ul>
              {DOCS.map((doc) => (
                <li key={doc}>{doc}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Port Rules</h2>
            <p>
              Single binary bias, offline-first storage, My Maits Lite for teacher-agent planning, SQLite for durable state,
              usearch for vectors, ZIM files as primary content packs, and Everywear owns the applet boundary.
            </p>
          </section>
        </aside>
      )}
    </main>
  );
}
