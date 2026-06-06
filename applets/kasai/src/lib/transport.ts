/**
 * KasaiTransport — unified interface for Tauri IPC and mock dev mode.
 *
 * When the Kasai Rust backend is compiled and running, uses Tauri IPC.
 * In browser dev mode, uses a mock transport that simulates responses.
 *
 * ─── CODEX_INTERFACE: Kasai IPC Commands ─────────────────────────────
 * The Rust backend (everywear-kasai binary) must implement these commands:
 *
 * COMMANDS (invoke):
 *   get_engine_status    → EngineStatus
 *   list_installed_skills → Skill[]
 *   list_watched_projects → WatchedProject[]
 *   list_chat_sessions   → ChatSession[]
 *   load_chat_history    → ChatHistory
 *   save_chat_history    → null (args: { session_id, messages })
 *   clear_chat_history   → null (args: { session_id })
 *   send_message         → string (args: { message, session_id?, skill_id? })
 *   get_mymory_status    → MymoryStatus
 *
 * EVENTS (listen):
 *   agent-event          → AgentEvent { type: 'Token' | 'KnowledgeGap' | 'TurnComplete', ... }
 *
 * See MockTransport.MOCK_RESPONSES for shape reference.
 * ────────────────────────────────────────────────────────────────────── */

// ── Response Types ─────────────────────────────────────────────────────

export interface EngineStatus {
  gpu: { name: string; vram_mb: number };
  tier: string;
  loaded_slots: Array<{ slot: string; model_name: string }>;
  version: string;
}

export interface Skill {
  id: string;
  name: string;
  path: string;
  icon: string;
  summary: string;
  description: string;
  status: 'live' | 'idle' | 'error';
  tag: string;
  token_cost: number;
}

export interface WatchedProject {
  id: string;
  name: string;
  path: string;
  wing: string;
  watch_enabled: boolean;
  structure: {
    project_type: string;
    docs: string[];
    source_roots: string[];
    package_files: string[];
  };
}

export interface MymoryStatus {
  root: string;
  exists: boolean;
  wings: string[];
  markdown_files: number;
  memory_layers?: string[];
  graph_projection_json?: string | null;
  graph_projection_mermaid?: string | null;
  schema_template?: string | null;
}

export interface AgentEvent {
  type: 'Token' | 'KnowledgeGap' | 'TurnComplete';
  token?: string;
  gap?: { query: string; sources_checked: string[] };
  turn?: { assistant_response: string; tokens_per_second: number };
}

export type EventCallback<T = unknown> = (payload: T) => void;
export type Unsubscribe = () => void;

export interface KasaiTransport {
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T = unknown>(event: string, callback: EventCallback<T>): Unsubscribe;
  readonly connected: boolean;
  readonly mode: 'tauri' | 'mock';
  destroy(): void;
}

// ── Tauri Transport ─────────────────────────────────────────────────

class TauriTransport implements KasaiTransport {
  readonly mode = 'tauri' as const;
  readonly connected = true;
  private unsubscribers: Array<() => void> = [];

  async invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  listen<T = unknown>(event: string, callback: EventCallback<T>): Unsubscribe {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      listen<T>(event, (e) => callback(e.payload)).then((fn) => {
        if (cancelled) { fn(); } else {
          unlistenFn = fn;
          this.unsubscribers.push(fn);
        }
      });
    });

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        this.unsubscribers = this.unsubscribers.filter((f) => f !== unlistenFn);
      }
    };
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
  }
}

// ── Mock Transport (dev mode) ───────────────────────────────────────

const MOCK_RESPONSES: Record<string, unknown> = {
  get_engine_status: {
    gpu: { name: 'RTX 5090', vram_mb: 32768 },
    tier: 'My Mait Local Ultra 32GB',
    loaded_slots: [
      { slot: 'Primary', model_name: 'Qwen3.6 35B-A3B Q4' },
      { slot: 'Encoder', model_name: 'Qwen3.5 9B Q8' },
    ],
    version: '0.1.0',
  },
  list_installed_skills: [
    {
      id: 'mymory-recall', name: 'MyMory Recall', path: '/skills/mymory-recall',
      icon: '🧠', summary: 'Vault-first retrieval before answering tasks',
      description: 'Searches the MyMory vault for prior decisions, context, and entity references before responding.',
      status: 'live', tag: 'memory', token_cost: 2400,
    },
    {
      id: 'mymory-remember', name: 'MyMory Remember', path: '/skills/mymory-remember',
      icon: '📝', summary: 'Append decisions to the rolling vault note',
      description: 'Captures decisions, architecture changes, and facts into the active wing transient note.',
      status: 'idle', tag: 'memory', token_cost: 800,
    },
    {
      id: 'mymory-graph', name: 'MyMory Graph', path: '/skills/mymory-graph',
      icon: 'MG', summary: 'Refresh and inspect the MKV graph projection',
      description: 'Checks the MyMory graph projection outputs that map MKV L1, L2, and L3 memory units.',
      status: 'idle', tag: 'memory', token_cost: 1200,
    },
    {
      id: 'code-review', name: 'Code Review', path: '/skills/code-review',
      icon: '🔍', summary: 'Structured code review with wiki cross-reference',
      description: 'Reviews code changes against architectural wiki, checks for drift, suggests improvements.',
      status: 'idle', tag: 'dev', token_cost: 3200,
    },
    {
      id: 'igcse-teacher', name: 'IGCSE Teacher', path: '/skills/igcse-teacher',
      icon: 'IG', summary: 'Pedagogy-aware tutor for Cambridge IGCSE learning',
      description: 'Plans lessons with diagnostic checks, scaffolding, retrieval practice, mastery learning, formative feedback, metacognition, and flexible learning supports.',
      status: 'idle', tag: 'education', token_cost: 3600,
    },
    {
      id: 'file-organizer', name: 'File Organizer', path: '/skills/file-organizer',
      icon: '📁', summary: 'Sort and structure project files by convention',
      description: 'Analyzes project structure and proposes file organization following established patterns.',
      status: 'idle', tag: 'ops', token_cost: 1600,
    },
  ],
  list_watched_projects: [
    {
      id: 'proj-everywear', name: 'Project Everywear', path: 'C:\\Users\\MAG MSI\\Project Everywear',
      wing: 'everywear', watch_enabled: true,
      structure: { project_type: 'monorepo', docs: [], source_roots: ['src'], package_files: ['package.json'] },
    },
    {
      id: 'proj-mymory', name: 'Project MyMory', path: 'C:\\Users\\MAG MSI\\Project Mymory',
      wing: 'mymory', watch_enabled: true,
      structure: {
        project_type: 'obsidian-vault',
        docs: ['CONTEXT.md', 'AGENTS.md', 'mymory_pipeline_spec.md'],
        source_roots: ['mymory', '_graph', '_templates'],
        package_files: ['kks_manifest.yaml'],
      },
    },
  ],
  list_chat_sessions: [],
  load_chat_history: { schema_version: 1, messages: [] },
  save_chat_history: null,
  clear_chat_history: null,
  get_mymory_status: {
    root: 'C:\\Users\\MAG MSI\\Project Mymory',
    exists: true,
    wings: ['strands', 'uddin', 'claude', 'ace', 'fintrek', 'mymory'],
    markdown_files: 2191,
    memory_layers: ['MKV-L0 raw evidence', 'MKV-L1 atoms', 'MKV-L2 scenarios', 'MKV-L3 canon'],
    graph_projection_json: 'C:\\Users\\MAG MSI\\Project Mymory\\_graph\\mkv_projection.json',
    graph_projection_mermaid: 'C:\\Users\\MAG MSI\\Project Mymory\\_graph\\mkv_projection.mmd',
    schema_template: 'C:\\Users\\MAG MSI\\Project Mymory\\_templates\\mkv_memory_unit_schema.md',
  },
};

class MockTransport implements KasaiTransport {
  readonly mode = 'mock' as const;
  readonly connected = true;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  async invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    await new Promise(r => setTimeout(r, 80 + Math.random() * 120));

    if (command === 'send_message') {
      const message = (args?.message as string) || '';
      // Simulate streaming via events
      const response = this.generateMockResponse(message);
      setTimeout(() => this.emit('agent-event', { type: 'TurnComplete', turn: { assistant_response: response, tokens_per_second: 42.5 } }), 600);
      return response as T;
    }

    if (command in MOCK_RESPONSES) {
      return MOCK_RESPONSES[command] as T;
    }

    return null as T;
  }

  listen<T = unknown>(event: string, callback: EventCallback<T>): Unsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event)!;
    const wrapped = callback as EventCallback;
    set.add(wrapped);
    return () => { set.delete(wrapped); };
  }

  private emit(event: string, data: unknown) {
    const set = this.listeners.get(event);
    if (set) set.forEach(cb => cb(data));
  }

  private generateMockResponse(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi')) {
      return 'Hello. My Mait is running on your home node with the Qwen3.6 35B-A3B orchestrator loaded. VRAM allocation is nominal. What would you like to work on?';
    }
    if (lower.includes('status') || lower.includes('model')) {
      return 'Engine status: Qwen3.6 35B-A3B Q4 (Primary, 20.5 GB) and Qwen3.5 9B Q8 (Agent, 9.2 GB) are loaded. Total VRAM usage: 29.7 / 32 GB. Inference is ready on both slots.';
    }
    if (lower.includes('skill')) {
      return 'I have 6 skills loaded: MyMory Recall (vault retrieval), MyMory Remember (decision capture), MyMory Graph (projection inspection), Code Review (wiki-referenced review), IGCSE Teacher, and File Organizer. Select one from the sidebar to see details, or mention it by name and I will prepare a run.';
    }
    return `Acknowledged. I am processing your request locally on the RTX 5090. The orchestrator is reasoning through your query now.\n\nYour message: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"\n\nThis is a mock response; the full inference pipeline will be active once the My Mait engine binary is compiled and the IPC bridge is live.`;
  }

  destroy(): void {
    this.listeners.clear();
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let instance: KasaiTransport | null = null;

export function getTransport(): KasaiTransport {
  if (instance) return instance;

  // Detect Tauri environment
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    instance = new TauriTransport();
  } else {
    instance = new MockTransport();
  }

  return instance;
}
