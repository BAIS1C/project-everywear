/**
 * KasaiCore, Everywear-adapted Agent Hub surface.
 *
 * This ports the standalone My Mait AgentHubCore visual contract into the
 * Everywear applet boundary. Everywear keeps ownership of shell chrome,
 * provider state, applet lifecycle, and transport.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getTransport, type MymoryStatus, type WatchedProject } from '../lib/transport';
import { ToolCallGroup, type ToolCallInfo, type ToolCallStatus, type AuditResult } from './ToolCallCard';
import { SlotStatusPanel } from './SlotStatusPanel';
import { MyMaitSkillIcon } from './MyMaitSkillIcon';
import { MyMaitSettings } from './MyMaitSettings';
import '../styles/agent-hub.css';

const HIDDEN_BLOCK_REGEX = /<(think|thinking|tool_code)>[\s\S]*?<\/\1>/gi;
const HIDDEN_OPEN_REGEX = /<(think|thinking|tool_code)>[\s\S]*$/i;
const HIDDEN_TAGS = ['think', 'thinking', 'tool_code'];

interface ParsedResponse {
  visible: string;
  reasoning: string | null;
}

function parseThinkTags(raw: string): ParsedResponse {
  if (!raw) return { visible: '', reasoning: null };
  const hiddenBlocks: string[] = [];
  const stripped = raw.replace(HIDDEN_BLOCK_REGEX, (match, tag) => {
    const tagName = String(tag).toLowerCase();
    const inner = match.replace(new RegExp(`</?${tagName}>`, 'gi'), '').trim();
    if (inner && tagName !== 'tool_code') hiddenBlocks.push(inner);
    return '';
  });
  const cleaned = stripped.replace(HIDDEN_OPEN_REGEX, '').trim();
  return { visible: cleaned, reasoning: hiddenBlocks.length > 0 ? hiddenBlocks.join('\n\n') : null };
}

function findHiddenOpen(text: string, from: number): { index: number; tag: string } | null {
  const lower = text.toLowerCase();
  let best: { index: number; tag: string } | null = null;
  for (const tag of HIDDEN_TAGS) {
    const index = lower.indexOf(`<${tag}>`, from);
    if (index !== -1 && (!best || index < best.index)) best = { index, tag };
  }
  return best;
}

function stripThinkTags(text: string): string {
  if (!text) return '';
  let result = '';
  let i = 0;
  while (i < text.length) {
    const open = findHiddenOpen(text, i);
    if (!open) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, open.index);
    const closeToken = `</${open.tag}>`;
    const closeIdx = text.toLowerCase().indexOf(closeToken, open.index + open.tag.length + 2);
    if (closeIdx === -1) break;
    i = closeIdx + closeToken.length;
  }
  return result.trim();
}

type Message =
  | {
      type: 'user';
      id: string;
      role: 'user';
      content: string;
      timestamp: number;
    }
  | {
      type: 'assistant';
      id: string;
      role: 'agent';
      content: string;
      timestamp: number;
      confidence?: 'green' | 'orange' | 'red';
      reasoning?: string;
    }
  | {
      type: 'tool-calls';
      id: string;
      role: 'tool';
      content: string;
      timestamp: number;
      initiatedCount: number;
    };

interface Skill {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  status: 'live' | 'idle' | 'error';
  tag: string;
  token_cost: number;
  safety_class?: string;
}

interface Connection {
  id: string;
  name: string;
  status: 'on' | 'off' | 'pending';
  tone: 'primary' | 'warm' | 'premium' | 'expressive' | 'text';
}

interface NodeInfo {
  models: { slot: string; name: string }[];
  vramUsed: number;
  vramTotal: string;
  uptime: string;
  gpu: string;
  ram: string;
}

interface LoadedSlotInfo {
  slot: string;
  model_name: string;
}

interface AgentEvent {
  type: string;
  content?: string;
  token?: string;
  domain?: string;
  query?: string;
  confidence?: string;
  best_score?: number;
  gap?: { query?: string; sources_checked?: string[] };
  turn?: { id?: string; assistant_response?: string; tokens_per_second?: number };
}

interface ReasoningTracePayload {
  event?: string;
  reasoning?: string;
  trace?: string;
  content?: string;
  message?: string;
  turn_id?: string;
  session_id?: string;
  timestamp?: number;
}

interface ToolCallEventPayload {
  index: number;
  session_id: string;
  timestamp: number;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  source_slot?: string;
  audit_result?: AuditResult;
}

const TOOL_CALL_STATUSES: ToolCallStatus[] = ['Pending', 'Executing', 'Success', 'Failed', 'Timeout', 'Rejected'];
const AUDIT_RESULTS: AuditResult[] = ['Pending', 'Approved', 'Rejected'];
const MIN_SKILL_RUN_VISIBLE_MS = 700;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown, malformed: boolean): ToolCallStatus {
  if (typeof value === 'string' && TOOL_CALL_STATUSES.includes(value as ToolCallStatus)) {
    return value as ToolCallStatus;
  }
  return malformed ? 'Failed' : 'Pending';
}

function normalizeAudit(value: unknown): AuditResult | undefined {
  if (typeof value === 'string' && AUDIT_RESULTS.includes(value as AuditResult)) {
    return value as AuditResult;
  }
  return undefined;
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { malformedArgs: value ?? null };
}

function normalizeReasoningTracePayload(raw: unknown): ReasoningTracePayload {
  if (!isRecord(raw)) {
    return { message: `Malformed reasoning trace payload: ${String(raw ?? 'empty payload')}` };
  }
  return {
    event: typeof raw.event === 'string' ? raw.event : undefined,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    trace: typeof raw.trace === 'string' ? raw.trace : undefined,
    content: typeof raw.content === 'string' ? raw.content : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    turn_id: typeof raw.turn_id === 'string' ? raw.turn_id : undefined,
    session_id: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : undefined,
  };
}

function reasoningTraceText(payload: ReasoningTracePayload): string {
  const direct = payload.reasoning || payload.trace || payload.content || payload.message;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return JSON.stringify(payload, null, 2);
}

function normalizeToolCallPayload(raw: unknown, fallbackIndex: number): ToolCallInfo {
  const payload = isRecord(raw) && isRecord(raw.tool_call) ? raw.tool_call : raw;
  if (!isRecord(payload)) {
    return {
      index: fallbackIndex,
      session_id: '',
      timestamp: Date.now(),
      tool_name: 'Malformed tool event',
      tool_args: { raw: payload ?? null },
      status: 'Failed',
      error: 'Tool event payload was not an object',
    };
  }

  const malformed: string[] = [];
  const index = typeof payload.index === 'number' ? payload.index : fallbackIndex;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const timestamp = typeof payload.timestamp === 'number' && payload.timestamp > 0 ? payload.timestamp : Date.now();
  const toolName = typeof payload.tool_name === 'string' && payload.tool_name.trim()
    ? payload.tool_name
    : 'Malformed tool event';
  if (toolName === 'Malformed tool event') malformed.push('missing tool_name');
  if (!isRecord(payload.tool_args)) malformed.push('tool_args was not an object');

  const existingError = typeof payload.error === 'string' ? payload.error : undefined;
  const error = malformed.length > 0
    ? [existingError, `Malformed tool event: ${malformed.join(', ')}`].filter(Boolean).join(' | ')
    : existingError;

  return {
    index,
    session_id: sessionId,
    timestamp,
    tool_name: toolName,
    tool_args: normalizeToolArgs(payload.tool_args),
    status: normalizeStatus(payload.status, malformed.length > 0),
    result: payload.result,
    error,
    duration_ms: typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
    source_slot: typeof payload.source_slot === 'string' ? payload.source_slot : undefined,
    audit_result: normalizeAudit(payload.audit_result),
  };
}

const CONNECTIONS: Connection[] = [
  { id: 'mymory', name: 'Everywear Vault', status: 'on', tone: 'primary' },
  { id: 'files', name: 'Local Files', status: 'on', tone: 'text' },
  { id: 'browser', name: 'Browser', status: 'pending', tone: 'warm' },
];

const STATUS_LABEL: Record<Connection['status'], string> = {
  on: 'CONNECTED',
  off: 'NOT LINKED',
  pending: 'READY',
};

function formatVram(mib: number): string {
  return `${Math.round(mib / 1024)} GB`;
}

function formatTokenCost(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tok` : `${tokens} tok`;
}

function toneColor(tone: Connection['tone'], status: Connection['status']): string {
  if (status === 'off') return 'var(--ew-text-faint)';
  switch (tone) {
    case 'warm': return 'var(--ew-warning, var(--ew-warm, #f9b960))';
    case 'premium': return 'var(--ew-premium, var(--ew-accent, #c7b8ff))';
    case 'expressive': return 'var(--ew-expressive, var(--ew-accent, #ff78c4))';
    case 'text': return 'var(--ew-text)';
    default: return 'var(--ew-primary)';
  }
}

function safeInitial(value: string): string {
  return value.trim().slice(0, 2).toUpperCase() || 'MM';
}

function Sidebar({
  skills,
  chatCount,
  connections,
  nodeInfo,
  runningSkillId,
  activeSkillId,
  onSelectSkill,
  onOpenSettings,
}: {
  skills: Skill[];
  chatCount: number;
  connections: Connection[];
  nodeInfo: NodeInfo | null;
  runningSkillId: string | null;
  activeSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="ah-side">
      <div className="ah-section-head">
        <span className="ah-section-title">Everywear Skills <span className="ah-count">{skills.length}</span></span>
      </div>
      <div className="ah-skill-list ah-split-list">
        {skills.map(skill => {
          const isRunning = skill.id === runningSkillId;
          return (
            <button
              key={skill.id}
              type="button"
              className={`ah-skill ${skill.id === activeSkillId ? 'active' : ''} ${isRunning ? 'running' : ''}`}
              onClick={() => onSelectSkill(skill.id === activeSkillId ? null : skill.id)}
              title={`${skill.name}\n\n${skill.description}`}
            >
              <MyMaitSkillIcon skill={skill} />
              <span className="ah-skill-info">
                <span className="ah-skill-name">{skill.name}</span>
                <span className="ah-skill-desc">{skill.summary}</span>
              </span>
              <span className="ah-skill-badges">
                <span className={`ah-status-dot ${isRunning ? 'executing' : skill.status}`} />
                <span className="ah-token-badge">
                  {isRunning ? 'RUNNING' : skill.token_cost > 0 ? formatTokenCost(skill.token_cost) : skill.status}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="ah-divider" />

      <div className="ah-section-head">
        <span className="ah-section-title">Chat History <span className="ah-count">{chatCount}</span></span>
      </div>
      <div className="ah-chat-session-list">
        <button type="button" className="ah-chat-session active">
          <span className="ah-session-title">Current session</span>
          <span className="ah-session-preview">Everywear platform mount, local transport boundary.</span>
          <span className="ah-session-meta">{chatCount} msgs</span>
        </button>
      </div>

      <div className="ah-divider" />

      <div className="ah-section-head">
        <span className="ah-section-title">Connections <span className="ah-count">{connections.length}</span></span>
      </div>
      <div className="ah-conn-list">
        {connections.map(connection => (
          <div key={connection.id} className={`ah-conn ${connection.status}`}>
            <div className="ah-conn-icon" style={{ color: toneColor(connection.tone, connection.status) }}>
              {safeInitial(connection.name)}
            </div>
            <div className="ah-conn-name">{connection.name}</div>
            <div className="ah-conn-status">{STATUS_LABEL[connection.status]}</div>
          </div>
        ))}
      </div>

      {nodeInfo && (
        <div className="ah-node-card">
          <div className="ah-node-label">
            <span className="ah-node-led" />
            HOME-NODE ONLINE
          </div>
          <div className="ah-node-machine">{nodeInfo.gpu} / {nodeInfo.ram}</div>
          <div className="ah-node-models">
            {nodeInfo.models.map(model => (
              <button
                key={model.slot}
                type="button"
                className="ah-node-model"
                onClick={onOpenSettings}
                title="Open My Mait settings to choose and manage local models"
              >
                <span>{model.slot}</span>
                <b>{model.name}</b>
              </button>
            ))}
          </div>
          <div className="ah-node-stats">
            <span>VRAM</span>
            <b>{nodeInfo.vramUsed} / {nodeInfo.vramTotal}</b>
            <span>Uptime</span>
            <b>{nodeInfo.uptime}</b>
          </div>
        </div>
      )}
    </aside>
  );
}

function ChatMessage({ msg, toolCalls }: { msg: Message; toolCalls?: Map<number, ToolCallInfo> }) {
  if (msg.type === 'tool-calls') {
    return (
      <div className="ah-msg">
        <div className="ah-msg-avatar tool">{'>'}</div>
        <div className="ah-msg-body">
          <ToolCallGroup toolCalls={toolCalls ?? new Map()} initiatedCount={msg.initiatedCount} />
        </div>
      </div>
    );
  }

  const parsed = msg.role === 'agent' ? parseThinkTags(msg.content) : null;
  const reasoning = (msg.type === 'assistant' ? msg.reasoning : undefined) || parsed?.reasoning || null;
  const confidence = msg.type === 'assistant' ? msg.confidence : undefined;
  const visibleContent = parsed ? parsed.visible : msg.content;
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <div className="ah-msg">
      <div className={`ah-msg-avatar ${msg.role}`}>{msg.role === 'user' ? 'YOU' : 'MM'}</div>
      <div className="ah-msg-body">
        <div className="ah-msg-who">
          {msg.role === 'user' ? <b>You</b> : <span className="ah-agent-name"><b>My Mait</b></span>}
          <span className="ah-msg-ts">
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {confidence && confidence !== 'green' && (
            <span className={`ah-confidence ${confidence}`}>{confidence.toUpperCase()}</span>
          )}
        </div>
        {reasoning && (
          <button type="button" className="ah-reasoning-toggle" onClick={() => setShowReasoning(prev => !prev)}>
            {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
          </button>
        )}
        {reasoning && showReasoning && <div className="ah-reasoning-block">{reasoning}</div>}
        <div className="ah-msg-text">{visibleContent}</div>
      </div>
    </div>
  );
}

function Composer({
  onSend,
  isGenerating,
  transportMode,
}: {
  onSend: (text: string) => void;
  isGenerating: boolean;
  transportMode: string;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!value.trim() || isGenerating) return;
    onSend(value.trim());
    setValue('');
    textareaRef.current?.focus();
  }, [isGenerating, onSend, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="ah-composer">
      <div className="ah-composer-inner">
        <div className="ah-composer-box">
          <textarea
            ref={textareaRef}
            placeholder="Ask My Mait, invoke a skill, or hand off a local task..."
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={isGenerating}
          />
          <div className="ah-composer-row">
            <div className="ah-ctx-chips">
              <button type="button" className="ah-ctx-chip" onClick={() => { setValue(prev => `${prev}@skill `); textareaRef.current?.focus(); }}>@ SKILL</button>
              <button type="button" className="ah-ctx-chip" onClick={() => { setValue(prev => `${prev}#vault `); textareaRef.current?.focus(); }}># VAULT</button>
            </div>
            <button className="ah-send" onClick={handleSend} disabled={!value.trim() || isGenerating} aria-label="Send message">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="ah-composer-foot">
          <span><b>Enter</b> send / <b>Shift+Enter</b> new line</span>
          <span>{transportMode === 'tauri' ? 'LOCAL IPC' : 'BROWSER PREVIEW'} / HOME-NODE</span>
        </div>
      </div>
    </div>
  );
}

function RightPane({
  skill,
  isGenerating,
  onRunSkill,
  runningSkillId,
  mymoryStatus,
  watchedProjects,
}: {
  skill: Skill | null;
  isGenerating: boolean;
  onRunSkill: (skill: Skill) => void;
  runningSkillId: string | null;
  mymoryStatus: MymoryStatus | null;
  watchedProjects: WatchedProject[];
}) {
  const vaultProject = watchedProjects.find(project => project.id === 'proj-everywear-vault');
  const activeSkillRunning = Boolean(skill && skill.id === runningSkillId);

  if (!skill) {
    return (
      <aside className="ah-right">
        <div className="ah-right-head">
          <div className="ah-right-kicker">NODE RUNTIME</div>
          <h2 className="ah-right-title">My Mait Agent Hub</h2>
          <div className="ah-right-desc">
            Everywear-hosted My Mait surface. Shell chrome, provider state, applet lifecycle, and transport stay platform-owned.
          </div>
        </div>
        <div className="ah-right-body">
          <div className="ah-r-section">SLOT STATE</div>
          <SlotStatusPanel />
          <div className="ah-r-section">SAFETY RAILS</div>
          <div className="ah-toggle-row">
            <div>
              <div className="ah-toggle-label">Ask before acting</div>
              <div className="ah-toggle-sub">Irreversible work remains approval-gated</div>
            </div>
            <div className="ah-toggle on" />
          </div>
          <div className="ah-toggle-row">
            <div>
              <div className="ah-toggle-label">Everywear boundary</div>
              <div className="ah-toggle-sub">No standalone window commands in this mount</div>
            </div>
            <div className="ah-toggle on" />
          </div>
          <div className="ah-r-section">EVERYWEAR VAULT</div>
          <div className="ah-fact-list">
            <div className="ah-fact">
              <div className="ah-fact-lbl">Status</div>
              <div className="ah-fact-val">{mymoryStatus?.exists ? 'Live' : 'Unavailable'}</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Root</div>
              <div className="ah-fact-val">{mymoryStatus?.root || 'Not mounted'}</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Records</div>
              <div className="ah-fact-val">{mymoryStatus ? `${mymoryStatus.markdown_files.toLocaleString()} markdown` : 'Unknown'}</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Engine</div>
              <div className="ah-fact-val">Powered by MyMory</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Layers</div>
              <div className="ah-fact-val">{mymoryStatus?.memory_layers?.join(', ') || 'Unknown'}</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Graph</div>
              <div className="ah-fact-val">
                {mymoryStatus?.graph_projection_json || mymoryStatus?.graph_projection_mermaid ? 'Projection available' : 'Projection pending'}
              </div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Schema</div>
              <div className="ah-fact-val">{mymoryStatus?.schema_template ? 'Vault schema found' : 'Schema pending'}</div>
            </div>
            <div className="ah-fact">
              <div className="ah-fact-lbl">Install vault</div>
              <div className="ah-fact-val">{vaultProject?.path || 'Everywear Vault not discovered'}</div>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ah-right">
      <div className="ah-right-head">
        <div className="ah-right-kicker">
          <MyMaitSkillIcon skill={skill} inline />
          SKILL
        </div>
        <h2 className="ah-right-title">{skill.name}</h2>
        <div className="ah-right-desc">{skill.description || skill.summary}</div>
        {skill.token_cost > 0 && (
          <div className="ah-right-token-info">Context cost: about {skill.token_cost.toLocaleString()} tokens</div>
        )}
        <div className="ah-right-actions">
          <button className="ah-btn primary" onClick={() => onRunSkill(skill)} disabled={isGenerating || activeSkillRunning}>
            {activeSkillRunning ? 'RUNNING' : isGenerating ? 'PREPARING' : 'PREPARE RUN'}
          </button>
        </div>
      </div>
      <div className="ah-right-body">
        <div className="ah-r-section">WHAT IT DOES</div>
        <div className="ah-fact-list">
          <div className="ah-fact">
            <div className="ah-fact-lbl">Summary</div>
            <div className="ah-fact-val">{skill.summary}</div>
          </div>
          <div className="ah-fact">
            <div className="ah-fact-lbl">Tag</div>
            <div className="ah-fact-val">{skill.tag}</div>
          </div>
          <div className="ah-fact">
            <div className="ah-fact-lbl">Status</div>
            <div className="ah-fact-val">{activeSkillRunning ? 'Running now' : skill.status === 'live' ? 'Loaded in context' : skill.status}</div>
          </div>
        </div>
        <div className="ah-r-section">SLOT STATE</div>
        <SlotStatusPanel />
        <div className="ah-r-section">BACKING VAULT</div>
        <div className="ah-fact-list">
          <div className="ah-fact">
            <div className="ah-fact-lbl">Status</div>
            <div className="ah-fact-val">{mymoryStatus?.exists ? 'Everywear Vault live' : 'Everywear Vault unavailable'}</div>
          </div>
          <div className="ah-fact">
            <div className="ah-fact-lbl">Root</div>
            <div className="ah-fact-val">{vaultProject?.path || mymoryStatus?.root || 'Everywear Vault not discovered'}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function KasaiCore() {
  const transport = getTransport();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [mymoryStatus, setMymoryStatus] = useState<MymoryStatus | null>(null);
  const [watchedProjects, setWatchedProjects] = useState<WatchedProject[]>([]);
  const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<Map<number, ToolCallInfo>>(new Map());
  const [showSettings, setShowSettings] = useState(false);
  const assistantResponseCommittedRef = useRef(false);
  const syntheticToolIndexRef = useRef(0);

  const activeSkill = useMemo(
    () => skills.find(skill => skill.id === activeSkillId) || null,
    [activeSkillId, skills],
  );
  const connections = useMemo(
    () => CONNECTIONS.map(connection => (
      connection.id === 'mymory'
        ? { ...connection, status: mymoryStatus?.exists ? 'on' as const : 'off' as const }
        : connection
    )),
    [mymoryStatus],
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await transport.invoke<{
          gpu: { name: string; vram_mb: number } | null;
          tier: string | null;
          loaded_slots: LoadedSlotInfo[];
        }>('get_engine_status');

        if (status?.gpu) {
          const models = (status.loaded_slots || [])
            .filter(slot => slot.slot !== 'Embedder')
            .map(slot => ({ slot: slot.slot, name: slot.model_name }));

          setNodeInfo({
            models: models.length ? models : [{ slot: 'Model', name: 'Loading...' }],
            vramUsed: Math.round(status.gpu.vram_mb * 0.6 / 1024 * 10) / 10,
            vramTotal: formatVram(status.gpu.vram_mb),
            uptime: 'Just started',
            gpu: status.gpu.name,
            ram: `${formatVram(status.gpu.vram_mb)} VRAM`,
          });
        }
      } catch {
        setNodeInfo(null);
      }
    };

    const fetchSkills = async () => {
      try {
        const installed = await transport.invoke<Array<{
          id: string;
          name: string;
          icon: string;
          summary: string;
          description?: string;
          status: string;
          tag: string;
          token_cost: number;
          safety_class?: string;
        }>>('list_installed_skills');

        if (installed) {
          setSkills(installed.map(skill => ({
            id: skill.id,
            name: skill.name,
            icon: skill.icon,
            summary: skill.summary,
            description: skill.description || skill.summary,
            status: (skill.status as 'live' | 'idle' | 'error') || 'idle',
            tag: skill.tag,
            token_cost: skill.token_cost || 0,
            safety_class: skill.safety_class,
          })));
        }
      } catch {
        setSkills([]);
      }
    };

    const fetchMymory = async () => {
      try {
        const [status, projects] = await Promise.all([
          transport.invoke<MymoryStatus>('get_mymory_status'),
          transport.invoke<WatchedProject[]>('list_watched_projects'),
        ]);
        setMymoryStatus(status);
        setWatchedProjects(projects || []);
      } catch {
        setMymoryStatus(null);
        setWatchedProjects([]);
      }
    };

    fetchStatus();
    fetchSkills();
    fetchMymory();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [transport]);

  const ensureToolCallMessage = useCallback((initiatedCount: number) => {
    setMessages(prev => {
      if (prev.some(message => message.type === 'tool-calls')) {
        return prev.map(message => (
          message.type === 'tool-calls'
            ? { ...message, initiatedCount: Math.max(message.initiatedCount, initiatedCount) }
            : message
        ));
      }
      return [...prev, {
        type: 'tool-calls',
        id: `tool-calls-${Date.now()}`,
        role: 'tool',
        content: 'Tool calls running',
        timestamp: Date.now(),
        initiatedCount,
      }];
    });
  }, []);

  useEffect(() => {
    const unlistenAgent = transport.listen<AgentEvent>('agent-event', (data) => {
      switch (data.type) {
        case 'Token':
          setStreamingContent(prev => prev + (data.content || data.token || ''));
          break;
        case 'KnowledgeGap':
          setMessages(prev => [...prev, {
            type: 'assistant',
            id: crypto.randomUUID(),
            role: 'agent',
            content: `Knowledge gap: ${data.domain || 'unknown'} / ${data.query || data.gap?.query || 'No query supplied'} (confidence: ${data.confidence || 'red'})`,
            timestamp: Date.now(),
            confidence: (data.confidence?.toLowerCase() as 'green' | 'orange' | 'red') || 'red',
          }]);
          break;
        case 'TurnComplete':
          setIsGenerating(false);
          setStreamingContent('');
          if (data.turn?.assistant_response && !assistantResponseCommittedRef.current) {
            const parsed = parseThinkTags(data.turn.assistant_response);
            assistantResponseCommittedRef.current = true;
            setMessages(prev => [...prev, {
              type: 'assistant',
              id: data.turn?.id || crypto.randomUUID(),
              role: 'agent',
              content: parsed.visible,
              timestamp: Date.now(),
              reasoning: parsed.reasoning || undefined,
            }]);
          }
          break;
      }
    });

    const unlistenUpdate = transport.listen<ToolCallEventPayload>('kasai://tool-call/update', (rawPayload) => {
      const payload = normalizeToolCallPayload(rawPayload, syntheticToolIndexRef.current++);
      ensureToolCallMessage(payload.index + 1);
      setToolCalls(prev => {
        const next = new Map(prev);
        next.set(payload.index, {
          index: payload.index,
          session_id: payload.session_id,
          timestamp: payload.timestamp,
          tool_name: payload.tool_name,
          tool_args: payload.tool_args,
          status: payload.status,
          result: payload.result,
          error: payload.error,
          duration_ms: payload.duration_ms,
          source_slot: payload.source_slot,
          audit_result: payload.audit_result,
        });
        return next;
      });
    });

    const unlistenComplete = transport.listen<ToolCallEventPayload>('kasai://tool-call/complete', (rawPayload) => {
      const payload = normalizeToolCallPayload(rawPayload, syntheticToolIndexRef.current++);
      ensureToolCallMessage(payload.index + 1);
      setToolCalls(prev => {
        const next = new Map(prev);
        const existing = next.get(payload.index);
        next.set(payload.index, {
          index: payload.index,
          session_id: payload.session_id,
          timestamp: payload.timestamp,
          tool_name: payload.tool_name,
          tool_args: payload.tool_args,
          status: payload.status,
          result: payload.result ?? existing?.result,
          error: payload.error ?? existing?.error,
          duration_ms: payload.duration_ms ?? existing?.duration_ms,
          source_slot: payload.source_slot ?? existing?.source_slot,
          audit_result: payload.audit_result ?? existing?.audit_result,
        });
        return next;
      });
    });

    const unlistenReasoningTrace = transport.listen<unknown>('kasai://reasoning-trace', (rawPayload) => {
      const payload = normalizeReasoningTracePayload(rawPayload);
      const reasoning = reasoningTraceText(payload);
      setMessages(prev => [...prev, {
        type: 'assistant',
        id: `reasoning-trace-${payload.turn_id || payload.session_id || crypto.randomUUID()}-${Date.now()}`,
        role: 'agent',
        content: 'Reasoning trace received from local runtime.',
        timestamp: typeof payload.timestamp === 'number' && payload.timestamp > 0 ? payload.timestamp : Date.now(),
        reasoning,
      }]);
    });

    return () => {
      unlistenAgent();
      unlistenUpdate();
      unlistenComplete();
      unlistenReasoningTrace();
    };
  }, [ensureToolCallMessage, transport]);

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      type: 'user',
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev.filter(message => message.type !== 'tool-calls'), userMsg]);
    setToolCalls(new Map());
    setIsGenerating(true);
    setStreamingContent('');
    assistantResponseCommittedRef.current = false;

    try {
      const raw = await transport.invoke<string>('send_message', { message: text });
      setIsGenerating(false);
      setStreamingContent('');
      if (raw && !assistantResponseCommittedRef.current) {
        const parsed = parseThinkTags(raw);
        assistantResponseCommittedRef.current = true;
        setMessages(prev => [...prev, {
          type: 'assistant',
          id: crypto.randomUUID(),
          role: 'agent',
          content: parsed.visible,
          timestamp: Date.now(),
          reasoning: parsed.reasoning || undefined,
        }]);
      }
    } catch (error) {
      setIsGenerating(false);
      setStreamingContent('');
      setMessages(prev => [...prev, {
        type: 'assistant',
        id: crypto.randomUUID(),
        role: 'agent',
        content: `Error: ${error}`,
        timestamp: Date.now(),
      }]);
    }
  }, [transport]);

  const handleRunSkill = useCallback(async (skill: Skill) => {
    if (isGenerating) return;
    setRunningSkillId(skill.id);
    const startedAt = Date.now();
    try {
      await handleSend(`Prepare the "${skill.name}" skill.\n\n${skill.description}`);
    } finally {
      const remaining = MIN_SKILL_RUN_VISIBLE_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      setRunningSkillId(null);
    }
  }, [handleSend, isGenerating]);

  const activeChatTitle = activeSkill ? activeSkill.name : 'Current session';

  return (
    <div className="ah-root">
      <Sidebar
        skills={skills}
        chatCount={messages.length}
        connections={connections}
        nodeInfo={nodeInfo}
        runningSkillId={runningSkillId}
        activeSkillId={activeSkillId}
        onSelectSkill={setActiveSkillId}
        onOpenSettings={() => setShowSettings(true)}
      />

      {showSettings ? (
        <main className="ah-center">
          <header className="ah-center-head">
            <div className="ah-crumbs">
              HOME <span className="ah-sep">/</span>
              MY MAIT <span className="ah-sep">/</span> <span className="ah-crumb-current">SETTINGS</span>
            </div>
            <div className="ah-chat-tools">
              <button
                type="button"
                className="ah-mini-action ah-settings-btn"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings and return to chat"
              >
                BACK TO CHAT
              </button>
            </div>
          </header>
          <div className="ah-settings-host">
            <MyMaitSettings />
          </div>
        </main>
      ) : (
        <>
      <main className="ah-center">
        <header className="ah-center-head">
          <div className="ah-crumbs">
            HOME <span className="ah-sep">/</span>
            {activeSkill
              ? <>SKILLS <span className="ah-sep">/</span> <span className="ah-crumb-current">{activeChatTitle.toUpperCase()}</span></>
              : <>CHAT <span className="ah-sep">/</span> <span className="ah-crumb-current">MY MAIT</span></>
            }
          </div>
          <div className="ah-chat-tools">
            <span className={`ah-history-state ${transport.mode === 'tauri' ? 'saved' : 'loading'}`}>
              {transport.mode === 'tauri' ? 'Platform IPC' : 'Browser preview'}
            </span>
            <button
              type="button"
              className="ah-mini-action ah-settings-btn"
              onClick={() => setShowSettings(true)}
              aria-label="Open My Mait settings"
              title="Model selection, residency, and Mait settings"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              SETTINGS
            </button>
          </div>
        </header>

        <div className="ah-chat-body">
          <div className="ah-chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="ah-empty">
                <div className="ah-empty-icon">MM</div>
                <p className="ah-empty-title">My Mait is ready</p>
                <p className="ah-empty-sub">Local agent surface, mounted inside Everywear.</p>
              </div>
            )}

            {messages.map(message => (
              <ChatMessage
                key={message.id}
                msg={message}
                toolCalls={message.type === 'tool-calls' ? toolCalls : undefined}
              />
            ))}

            {isGenerating && streamingContent && (
              <div className="ah-msg">
                <div className="ah-msg-avatar agent">MM</div>
                <div className="ah-msg-body">
                  <div className="ah-msg-who"><span className="ah-agent-name"><b>My Mait</b></span></div>
                  <div className="ah-msg-text streaming">{stripThinkTags(streamingContent) || 'Working...'}</div>
                </div>
              </div>
            )}

            {isGenerating && !streamingContent && (
              <div className="ah-msg">
                <div className="ah-msg-avatar agent">MM</div>
                <div className="ah-msg-body">
                  <div className="ah-thinking"><span /><span /><span /></div>
                </div>
              </div>
            )}
          </div>

          <Composer onSend={handleSend} isGenerating={isGenerating} transportMode={transport.mode} />
        </div>
      </main>

      <RightPane
        skill={activeSkill}
        isGenerating={isGenerating}
        onRunSkill={handleRunSkill}
        runningSkillId={runningSkillId}
        mymoryStatus={mymoryStatus}
        watchedProjects={watchedProjects}
      />
        </>
      )}
    </div>
  );
}
