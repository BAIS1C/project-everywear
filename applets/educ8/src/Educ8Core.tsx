import React from 'react';
import { CONTENT_PACKS, IGCSE_MODULES, PEDAGOGY } from './learningContent';
import { MY_MAITS_LITE_HOST_CONTRACTS } from '@everywear/transport';

export interface Educ8CoreProps {
  skin?: string;
  mode?: string;
}

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

function stateLabel(state: PhaseState) {
  if (state === 'active') return 'Active';
  if (state === 'planned') return 'Plan first';
  return 'Blocked';
}

export function Educ8Core({ skin, mode }: Educ8CoreProps) {
  const teacherContract = MY_MAITS_LITE_HOST_CONTRACTS.loom_teacher;
  const [selectedPacks, setSelectedPacks] = React.useState<Set<string>>(
    () => new Set(CONTENT_PACKS.filter((pack) => pack.status !== 'optional').map((pack) => pack.id)),
  );
  const [activeModuleId, setActiveModuleId] = React.useState(IGCSE_MODULES[0]?.id ?? '');
  const [setupMessage, setSetupMessage] = React.useState('Ready to build an offline IGCSE teacher pack.');
  const [planAccepted, setPlanAccepted] = React.useState(false);
  const active = PHASES.filter((phase) => phase.state === 'active').length;
  const planned = PHASES.filter((phase) => phase.state === 'planned').length;
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
    setPlanAccepted(false);
  }

  function acceptPlan() {
    const selected = CONTENT_PACKS.filter((pack) => selectedPacks.has(pack.id));
    setPlanAccepted(true);
    setSetupMessage(
      `Accepted ${selected.length} item${selected.length === 1 ? '' : 's'} for manifest review. Downloads stay blocked until exact URLs, sizes, and checksums are visible.`,
    );
  }

  return (
    <main className="educ8-root" data-skin={skin} data-mode={mode}>
      <section className="educ8-header">
        <div>
          <p className="educ8-kicker">Agentic education for the home</p>
          <h1>Educ8</h1>
          <p className="educ8-tagline">Weaving Agentic Education into your Home.</p>
        </div>
        <div className="educ8-meter" aria-label="Migration status">
          <span><strong>{active}</strong> active</span>
          <span><strong>{planned}</strong> planned</span>
          <span><strong>{blocked}</strong> blocked</span>
        </div>
      </section>

      <section className="educ8-grid" aria-label="Migration phases">
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
            onClick={acceptPlan}
            title="Accepts the visible plan for manifest review only. It does not download files yet."
          >
            Accept Plan
          </button>
        </div>

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
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="educ8-teacher" aria-label="Teacher pedagogy model">
        <div className="educ8-panel-head">
          <div>
            <p className="educ8-kicker">{teacherContract.label}</p>
            <h2>Pedagogy Model</h2>
          </div>
        </div>
        <div className="educ8-principles">
          {PEDAGOGY.map((principle) => (
            <article
              key={principle.title}
              className="educ8-principle"
              title={`My Maits Lite uses this principle when planning lessons, feedback, and revision prompts: ${principle.summary}`}
            >
              <h3>{principle.title}</h3>
              <p>{principle.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <aside className="educ8-rail" aria-label="Migration sources and rules">
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
    </main>
  );
}
