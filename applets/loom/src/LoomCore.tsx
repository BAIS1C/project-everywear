import React from 'react';
import { CONTENT_PACKS, IGCSE_MODULES, PEDAGOGY } from './learningContent';

export interface LoomCoreProps {
  skin?: string;
  mode?: string;
}

type PhaseState = 'active' | 'queued' | 'blocked';

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
    title: 'Kasai inference bridge',
    state: 'active',
    source: 'Ollama Docker, OpenAI-compatible chat, embeddings',
    target: 'loom-kasai over the existing Kasai Local runtime',
    nextStep: 'Bind chat, model scan, embeddings, and benchmark contracts.',
  },
  {
    id: '02',
    title: 'SQLite foundation',
    state: 'active',
    source: 'NOMAD MySQL models and Knex migrations',
    target: 'loom-db with consolidated schema and future migrations',
    nextStep: 'Create schema module for chats, resources, chunks, notes, and jobs.',
  },
  {
    id: '03',
    title: 'Vector retrieval',
    state: 'queued',
    source: 'Qdrant service and payload indexes',
    target: 'usearch vectors plus SQLite chunk metadata',
    nextStep: 'Build the vector index wrapper after loom-db lands.',
  },
  {
    id: '04',
    title: 'Offline library',
    state: 'queued',
    source: 'Kiwix server, ZIM catalog, educational packs',
    target: 'native ZIM reader, content manifests, Axum routes',
    nextStep: 'Port ZIM listing and article serving once the server crate exists.',
  },
  {
    id: '05',
    title: 'Axum service surface',
    state: 'queued',
    source: 'AdonisJS controllers and Inertia pages',
    target: 'loom-server handlers and Everywear-hosted applet UI',
    nextStep: 'Translate controller contracts into typed Axum handler modules.',
  },
  {
    id: '06',
    title: 'Maps, tools, notes',
    state: 'queued',
    source: 'PMTiles, CyberChef, FlatNotes containers',
    target: 'loom-maps, loom-datatools, loom-notes',
    nextStep: 'Keep each feature crate thin and file-backed where possible.',
  },
  {
    id: '07',
    title: 'Everywear integration',
    state: 'blocked',
    source: 'Standalone NOMAD admin panel',
    target: 'Everywear app registration, vault search, licence gate',
    nextStep: 'Unblock after backend contracts expose searchable documents.',
  },
];

const DOCS = [
  'NOMAD_Everywear_Rust_Port_Architecture_v1.md',
  'Loom_Transfer_01_Ollama_to_KasaiLocal.md',
  'Loom_Transfer_02_MySQL_to_SQLite.md',
  'Loom_Transfer_03_Qdrant_to_usearch.md',
  'Loom_Transfer_04_Kiwix_to_zimrs.md',
  'Loom_Transfer_05_AdonisJS_to_Axum.md',
  'Loom_Transfer_06_Maps_to_loom_maps.md',
  'Loom_Transfer_07_CyberChef_to_datatools.md',
  'Loom_Transfer_08_FlatNotes_to_loom_notes.md',
];

function stateLabel(state: PhaseState) {
  if (state === 'active') return 'Active';
  if (state === 'queued') return 'Queued';
  return 'Blocked';
}

export function LoomCore({ skin, mode }: LoomCoreProps) {
  const [selectedPacks, setSelectedPacks] = React.useState<Set<string>>(
    () => new Set(CONTENT_PACKS.filter((pack) => pack.status !== 'optional').map((pack) => pack.id)),
  );
  const [activeModuleId, setActiveModuleId] = React.useState(IGCSE_MODULES[0]?.id ?? '');
  const [setupMessage, setSetupMessage] = React.useState('Ready to build an offline IGCSE teacher pack.');
  const active = PHASES.filter((phase) => phase.state === 'active').length;
  const queued = PHASES.filter((phase) => phase.state === 'queued').length;
  const blocked = PHASES.filter((phase) => phase.state === 'blocked').length;
  const activeModule = IGCSE_MODULES.find((module) => module.id === activeModuleId) ?? IGCSE_MODULES[0];
  const activePackIds = new Set(activeModule?.packIds ?? []);
  const modulePacks = CONTENT_PACKS.filter((pack) => activePackIds.has(pack.id));

  function togglePack(id: string) {
    setSelectedPacks((current) => {
      const next = new Set(current);
      const pack = CONTENT_PACKS.find((item) => item.id === id);
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
    const selected = CONTENT_PACKS.filter((pack) => selectedPacks.has(pack.id));
    setSetupMessage(
      `Planned ${selected.length} item${selected.length === 1 ? '' : 's'}: resolve manifests, check disk, show sizes, then ask before downloading.`,
    );
  }

  return (
    <main className="loom-root" data-skin={skin} data-mode={mode}>
      <section className="loom-header">
        <div>
          <p className="loom-kicker">Project NOMAD to Everywear Rust</p>
          <h1>The Loom</h1>
        </div>
        <div className="loom-meter" aria-label="Migration status">
          <span><strong>{active}</strong> active</span>
          <span><strong>{queued}</strong> queued</span>
          <span><strong>{blocked}</strong> blocked</span>
        </div>
      </section>

      <section className="loom-grid" aria-label="Migration phases">
        {PHASES.map((phase) => (
          <article className={`loom-phase loom-phase--${phase.state}`} key={phase.id}>
            <header className="loom-phase__header">
              <span className="loom-phase__id">{phase.id}</span>
              <span className="loom-phase__state">{stateLabel(phase.state)}</span>
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
            <p className="loom-phase__next">{phase.nextStep}</p>
          </article>
        ))}
      </section>

      <section className="loom-setup" aria-label="IGCSE setup and content selection">
        <div className="loom-panel-head">
          <div>
            <p className="loom-kicker">Learner Setup</p>
            <h2>IGCSE Teacher Pack</h2>
          </div>
          <button
            type="button"
            className="loom-action"
            onClick={planDownload}
            title="Creates a transparent download plan. The real downloader must show exact URLs, file sizes, checksums, and ask before fetching large files."
          >
            Plan Downloads
          </button>
        </div>

        <div className="loom-notice" role="status">
          <strong>Loom says:</strong> {setupMessage}
        </div>

        <div className="loom-module-tabs" role="tablist" aria-label="IGCSE subjects">
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
          <article className="loom-syllabus">
            <div>
              <span className="loom-syllabus__code">{activeModule.code}</span>
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

        <div className="loom-pack-list">
          {modulePacks.map((pack) => (
            <label
              className={`loom-pack loom-pack--${pack.status}`}
              key={pack.id}
              title={pack.tooltip}
            >
              <input
                type="checkbox"
                checked={selectedPacks.has(pack.id)}
                disabled={pack.status === 'required'}
                onChange={() => togglePack(pack.id)}
              />
              <span className="loom-pack__body">
                <span className="loom-pack__top">
                  <strong>{pack.title}</strong>
                  <em>{pack.status}</em>
                </span>
                <span>{pack.module} · {pack.type.toUpperCase()} · {pack.size}</span>
                <span className="loom-pack__resolver">{pack.resolver}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="loom-teacher" aria-label="Teacher pedagogy model">
        <div className="loom-panel-head">
          <div>
            <p className="loom-kicker">Kasai Teacher Agent</p>
            <h2>Pedagogy Model</h2>
          </div>
        </div>
        <div className="loom-principles">
          {PEDAGOGY.map((principle) => (
            <article
              key={principle.title}
              className="loom-principle"
              title={`Kasai uses this principle when planning lessons, feedback, and revision prompts: ${principle.summary}`}
            >
              <h3>{principle.title}</h3>
              <p>{principle.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <aside className="loom-rail" aria-label="Migration sources and rules">
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
            Single binary bias, offline-first storage, Kasai for inference, SQLite for durable state,
            usearch for vectors, ZIM files as primary content packs, and Everywear owns the applet boundary.
          </p>
        </section>
      </aside>
    </main>
  );
}
