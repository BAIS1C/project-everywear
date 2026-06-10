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
  safety_class?: string;
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

export interface MyMaitSettingsState {
  model_groups: MyMaitModelGroup[];
  model_resolution: MyMaitModelResolution[];
  model_preference: MyMaitModelPreference;
  residency: MyMaitResidencyState;
  vram_status: MyMaitVramStatus;
  companion: MyMaitCompanionState;
  manifests: MaitManifestSummary[];
}

export interface MyMaitModelGroup {
  id: string;
  label: string;
  min_vram_mb: number;
  total_vram_mb: number;
  fits_total_vram: boolean;
  recommended: boolean;
  models: MyMaitModelRequirement[];
}

export interface MyMaitModelRequirement {
  key: string;
  role: string;
  required: boolean;
  vram_mb: number;
  filename?: string | null;
  hf_repo?: string | null;
  hf_file?: string | null;
  size_bytes?: number | null;
}

export interface MyMaitModelResolution {
  everywear_model_id: string;
  status: 'available' | 'found_locally' | 'needs_download' | 'incompatible' | string;
  source: string;
  details: string;
}

export interface MyMaitModelPreference {
  selection_mode: 'auto' | 'manual' | string;
  preferred_group_id?: string | null;
  preferred_model_keys: string[];
}

export type MyMaitResidencyPolicy = 'auto' | 'unload_on_close' | 'keep_hot' | 'ask_on_close';

export interface MyMaitResidencyState {
  policy: MyMaitResidencyPolicy;
  max_vram_mb?: number | null;
  can_keep_hot: boolean;
  guardrail?: string | null;
}

export interface MyMaitVramStatus {
  total_mb: number;
  free_mb: number;
  used_mb: number;
  nvml_free_mb?: number | null;
  nvml_used_mb?: number | null;
  budget_free_mb: number;
  budget_allocated_mb: number;
  active_applet?: string | null;
  active_engine_applet?: string | null;
  my_mait_resident: boolean;
  allocations: Array<{
    applet_id: string;
    model_key: string;
    role: string;
    vram_mb: number;
  }>;
}

export interface MyMaitCompanionState {
  active_manifest_id?: string | null;
  presence_tier: 'hidden' | 'portrait' | 'desktop_widget' | string;
  widget_visible: boolean;
  voice_enabled: boolean;
}

export interface MyMaitCompanionStateInput {
  manifest_id?: string | null;
  presence_tier?: 'hidden' | 'portrait' | 'desktop_widget' | string;
  widget_visible?: boolean;
  voice_enabled?: boolean;
}

export interface MaitManifestSummary {
  id: string;
  display_name: string;
  shard_count: number;
  source_schema?: string | null;
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
      icon: 'memory', summary: 'Everywear Vault retrieval before answering tasks',
      description: 'Searches Everywear Vault records through the MyMory-compatible substrate before responding.',
      status: 'live', tag: 'memory', token_cost: 2400, safety_class: 'ReadOnly',
    },
    {
      id: 'mymory-remember', name: 'MyMory Remember', path: '/skills/mymory-remember',
      icon: 'memory-plus', summary: 'Append decisions to Everywear Vault',
      description: 'Captures decisions, architecture changes, and facts into Everywear Vault without importing a development vault.',
      status: 'idle', tag: 'memory', token_cost: 800, safety_class: 'Mutation',
    },
    {
      id: 'mymory-graph', name: 'MyMory Graph', path: '/skills/mymory-graph',
      icon: 'graph', summary: 'Inspect the Everywear Vault graph projection',
      description: 'Checks MyMory-compatible graph projection outputs inside Everywear Vault when present.',
      status: 'idle', tag: 'memory', token_cost: 1200, safety_class: 'ReadOnly',
    },
    {
      id: 'code-review', name: 'Code Review', path: '/skills/code-review',
      icon: '🔍', summary: 'Structured code review with wiki cross-reference',
      description: 'Reviews code changes against architectural wiki, checks for drift, suggests improvements.',
      status: 'idle', tag: 'dev', token_cost: 3200, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-article-executive-summary', name: 'Article Executive Summary', path: 'builtin://capture-article-executive-summary',
      icon: 'document', summary: 'Summarize an article, PDF excerpt, or web page into an executive brief.',
      description: 'Extract and organize important information from pasted article text, a URL, or a PDF excerpt. Separate what the source says from interpretation.',
      status: 'idle', tag: 'capture', token_cost: 110, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-study-pack', name: 'Study Pack Generator', path: 'builtin://capture-study-pack',
      icon: 'book', summary: 'Turn a video, article, or thread into notes, flashcards, and quiz prompts.',
      description: 'Convert source material into a learning pack for retention. Prefer precise definitions, examples, misconceptions, and review questions over generic summaries.',
      status: 'idle', tag: 'capture', token_cost: 96, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-thread-distiller', name: 'Thread Distiller', path: 'builtin://capture-thread-distiller',
      icon: 'thread', summary: 'Distill an X, LinkedIn, Reddit, or comment thread into signal.',
      description: 'Analyze a pasted social thread or comment section. Identify the main argument, strongest replies, disagreement clusters, sentiment, and useful links or entities.',
      status: 'idle', tag: 'capture', token_cost: 104, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-yt-executive-summary', name: 'YT -> Executive Summary', path: 'builtin://capture-yt-executive-summary',
      icon: 'play', summary: 'Turn a YouTube video or transcript into a concise executive brief.',
      description: 'Analyze a YouTube video URL or pasted transcript. Extract the thesis, key points, evidence, caveats, notable quotes, and practical takeaways without adding unsupported facts.',
      status: 'idle', tag: 'capture', token_cost: 119, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-yt-to-linkedin', name: 'YT -> LinkedIn Post', path: 'builtin://capture-yt-to-linkedin',
      icon: 'briefcase', summary: 'Repurpose a YouTube video or transcript into a professional LinkedIn post.',
      description: 'Convert a YouTube video URL or pasted transcript into a LinkedIn post with a useful business or learning angle. Keep the tone grounded and avoid engagement bait.',
      status: 'idle', tag: 'capture', token_cost: 104, safety_class: 'ReadOnly',
    },
    {
      id: 'capture-yt-to-x-thread', name: 'YT -> X Thread', path: 'builtin://capture-yt-to-x-thread',
      icon: 'thread', summary: 'Convert a YouTube video or transcript into a clear X thread draft.',
      description: 'Transform a YouTube video URL or pasted transcript into a concise X thread that preserves the original argument, flags uncertainty, and avoids fake citations.',
      status: 'idle', tag: 'capture', token_cost: 99, safety_class: 'ReadOnly',
    },
  ],
  list_watched_projects: [
    {
      id: 'proj-everywear', name: 'Project Everywear', path: 'C:\\Users\\MAG MSI\\Project Everywear',
      wing: 'everywear', watch_enabled: true,
      structure: { project_type: 'monorepo', docs: [], source_roots: ['src'], package_files: ['package.json'] },
    },
    {
      id: 'proj-everywear-vault', name: 'Everywear Vault', path: 'C:\\Users\\MAG MSI\\Documents\\Everywear Vault',
      wing: 'vault', watch_enabled: true,
      structure: {
        project_type: 'everywear-vault',
        docs: ['_templates'],
        source_roots: ['Audio', 'Images', 'Videos', 'Contexts', 'Conversations', 'Maits', 'Shards'],
        package_files: [],
      },
    },
  ],
  list_chat_sessions: [],
  load_chat_history: { schema_version: 1, messages: [] },
  save_chat_history: null,
  clear_chat_history: null,
  get_mymory_status: {
    root: 'C:\\Users\\MAG MSI\\Documents\\Everywear Vault',
    exists: true,
    wings: ['Audio', 'Images', 'Videos', 'Contexts', 'Maits', 'Shards'],
    markdown_files: 0,
    memory_layers: ['Everywear Vault records', 'MyMory-compatible metadata', 'Applet-scoped indexes', 'User-approved ingest'],
    graph_projection_json: null,
    graph_projection_mermaid: null,
    schema_template: null,
  },
  get_my_mait_settings: {
    model_groups: [
      {
        id: 'my-mait-local-32gb-qwen3-6-35b-a3b-q4-orchestrator-qwen3-5-9b-q8-agent',
        label: 'My Mait Local 32GB',
        min_vram_mb: 32768,
        total_vram_mb: 29700,
        fits_total_vram: true,
        recommended: true,
        models: [
          { key: 'kasai-orchestrator-qwen3-6-35b-a3b-q4km', role: 'Primary', required: true, vram_mb: 20500, filename: 'Qwen3.6-35B-A3B-Q4_K_M.gguf' },
          { key: 'kasai-agent-qwen3-5-9b-q8', role: 'Encoder', required: true, vram_mb: 9200, filename: 'Qwen3.5-9B-Q8_0.gguf' },
        ],
      },
      {
        id: 'my-mait-local-16gb-qwen3-5-9b-high-quality-orchestrator-4b-worker',
        label: 'My Mait Local 16GB',
        min_vram_mb: 16384,
        total_vram_mb: 9500,
        fits_total_vram: true,
        recommended: false,
        models: [
          { key: 'kasai-orchestrator-qwen3-5-9b-q5km', role: 'Primary', required: true, vram_mb: 6500, filename: 'Qwen3.5-9B-Q5_K_M.gguf' },
          { key: 'kasai-worker-qwen3-4b-q4km', role: 'Encoder', required: true, vram_mb: 3000, filename: 'Qwen3-4B-Q4_K_M.gguf' },
        ],
      },
    ],
    model_resolution: [
      { everywear_model_id: 'kasai-orchestrator-qwen3-6-35b-a3b-q4km', status: 'needs_download', source: 'HuggingFace', details: 'Remote artifact declared in applet manifest' },
      { everywear_model_id: 'kasai-agent-qwen3-5-9b-q8', status: 'found_locally', source: 'LmStudio', details: 'Local compatible GGUF found' },
    ],
    model_preference: {
      selection_mode: 'auto',
      preferred_group_id: null,
      preferred_model_keys: [],
    },
    residency: {
      policy: 'auto',
      max_vram_mb: null,
      can_keep_hot: true,
      guardrail: null,
    },
    vram_status: {
      total_mb: 32768,
      free_mb: 27500,
      used_mb: 5268,
      nvml_free_mb: 27500,
      nvml_used_mb: 5268,
      budget_free_mb: 32768,
      budget_allocated_mb: 0,
      active_applet: null,
      active_engine_applet: null,
      my_mait_resident: false,
      allocations: [],
    },
    companion: {
      active_manifest_id: null,
      presence_tier: 'portrait',
      widget_visible: false,
      voice_enabled: false,
    },
    manifests: [],
  },
};

function cloneMock<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

    if (
      command === 'set_my_mait_model_preference'
      || command === 'clear_my_mait_model_preference'
      || command === 'set_my_mait_residency_policy'
      || command === 'set_my_mait_companion_state'
      || command === 'import_character_studio_avatar'
    ) {
      return cloneMock(MOCK_RESPONSES.get_my_mait_settings) as T;
    }

    if (command === 'get_my_mait_vram_status') {
      return cloneMock((MOCK_RESPONSES.get_my_mait_settings as MyMaitSettingsState).vram_status) as T;
    }

    if (command === 'list_mait_manifests') {
      return cloneMock((MOCK_RESPONSES.get_my_mait_settings as MyMaitSettingsState).manifests) as T;
    }

    if (command in MOCK_RESPONSES) {
      return cloneMock(MOCK_RESPONSES[command]) as T;
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
      return 'I have 10 skills loaded: the MyMory memory tools, Code Review, and the donor content-capture pack for YouTube, articles, threads, LinkedIn, and study notes. Select one from the sidebar to see details, or mention it by name and I will prepare a run.';
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
