/**
 * KasaiCore — Portable three-pane agent hub.
 *
 * Layout: Sidebar (skills, chat history, node card) | Center (chat + composer) | Right (skill detail / project access)
 *
 * Designed as a portable Core component following the Everywear OS pattern.
 * Transport-agnostic via KasaiTransport (Tauri IPC or mock).
 * Consumes EWDS tokens for all styling.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getTransport } from '../lib/transport';
import { ToolCallGroup, type ToolCallInfo, type ToolCallStatus, type AuditResult } from './ToolCallCard';
import { SlotStatusPanel } from './SlotStatusPanel';
import { getLogger } from '@everywear/shared';

const log = getLogger('kasai');

// ── Think-tag stripping ────────────────────────────────────────────���

const HIDDEN_BLOCK_REGEX = /<(think|thinking|tool_code)>[\s\S]*?<\/\1>/gi;
const HIDDEN_OPEN_REGEX = /<(think|thinking|tool_code)>[\s\S]*$/i;
const HIDDEN_TAGS = ['think', 'thinking', 'tool_code'];

interface ParsedResponse { visible: string; reasoning: string | null; }

function parseThinkTags(raw: string): ParsedResponse {
  if (!raw) return { visible: '', reasoning: null };
  const hiddenBlocks: string[] = [];
  const stripped = raw.replace(HIDDEN_BLOCK_REGEX, (match, tag) => {
    const inner = match.replace(new RegExp(`</?${String(tag).toLowerCase()}>`, 'gi'), '').trim();
    if (inner && String(tag).toLowerCase() !== 'tool_code') hiddenBlocks.push(inner);
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
    if (!open) { result += text.slice(i); break; }
    result += text.slice(i, open.index);
    const closeToken = `</${open.tag}>`;
    const closeIdx = text.toLowerCase().indexOf(closeToken, open.index + open.tag.length + 2);
    if (closeIdx === -1) break;
    i = closeIdx + closeToken.length;
  }
  return result.trim();
}

// ── Types ───────────────────────────────────────────────────────────

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

// Legacy ToolCallCard shape (used by inline tool-call rendering in ChatMessage)
interface LegacyToolCallCard {
  name: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  duration?: number;
}

// Event payload from Codex K1-K6 tool-call system
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

interface Skill {
  id: string;
  name: string;
  icon: string;
  summary: string;
  description: string;
  status: 'live' | 'idle' | 'error';
  tag: string;
  token_cost: number;
}

interface NodeInfo {
  models: { slot: string; name: string }[];
  vramUsed: number;
  vramTotal: string;
  uptime: string;
  gpu: string;
  ram: string;
}

interface LoadedSlotInfo { slot: string; model_name: string; }

interface AgentEvent {
  type: string;
  content?: string;
  domain?: string;
  query?: string;
  confidence?: string;
  best_score?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatVram(mib: number): string {
  return `${Math.round(mib / 1024)} GB`;
}

function formatTokenCost(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tok` : `${tokens} tok`;
}

// ── Sidebar ─────────────────────────────────────────────────────────

function Sidebar({
  skills,
  nodeInfo,
  activeSkillId,
  onSelectSkill,
}: {
  skills: Skill[];
  nodeInfo: NodeInfo | null;
  activeSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
}) {
  return (
    <aside className="kc-side">
      <div className="kc-section-head">
        <span className="kc-section-title">Skills <span className="kc-count">{skills.length}</span></span>
      </div>
      <div className="kc-skill-list">
        {skills.map(s => (
          <button
            key={s.id}
            type="button"
            className={`kc-skill ${s.id === activeSkillId ? 'active' : ''}`}
            onClick={() => onSelectSkill(s.id === activeSkillId ? null : s.id)}
            title={`${s.name}\n${s.description}`}
          >
            <span className="kc-skill-icon">{s.icon}</span>
            <span className="kc-skill-info">
              <span className="kc-skill-name">{s.name}</span>
              <span className="kc-skill-desc">{s.summary}</span>
            </span>
            <span className="kc-skill-badges">
              <span className={`kc-status-dot ${s.status}`} />
              {s.token_cost > 0 && <span className="kc-token-badge">{formatTokenCost(s.token_cost)}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="kc-divider" />

      {/* Node Card */}
      {nodeInfo && (
        <div className="kc-node-card">
          <div className="kc-node-label">
            <span className="kc-node-led" />
            HOME-NODE
          </div>
          <div className="kc-node-gpu">{nodeInfo.gpu} · {nodeInfo.ram}</div>
          <div className="kc-node-slots">
            {nodeInfo.models.map(m => (
              <div key={m.slot} className="kc-node-slot">
                <span className="kc-slot-role">{m.slot}</span>
                <span className="kc-slot-model">{m.name}</span>
              </div>
            ))}
          </div>
          <div className="kc-node-vram">
            VRAM: {nodeInfo.vramUsed} / {nodeInfo.vramTotal}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Chat Message ────────────────────────────────────────────────────

function ChatMessage({ msg, toolCalls }: { msg: Message; toolCalls?: Map<number, ToolCallInfo> }) {
  // Tool-call group message: render the ToolCallGroup component
  if (msg.type === 'tool-calls') {
    return (
      <div className="kc-msg">
        <div className="kc-msg-avatar tool">{'>'}_</div>
        <div className="kc-msg-body">
          <ToolCallGroup
            toolCalls={toolCalls ?? new Map()}
            initiatedCount={msg.initiatedCount}
          />
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
    <div className="kc-msg">
      <div className={`kc-msg-avatar ${msg.role}`}>
        {msg.role === 'user' ? 'YOU' : 'K'}
      </div>
      <div className="kc-msg-body">
        <div className="kc-msg-who">
          {msg.role === 'user' ? <b>You</b> : <span className="kc-agent-name"><b>Kasai</b></span>}
          <span className="kc-msg-ts">
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {confidence && confidence !== 'green' && (
            <span className={`kc-confidence ${confidence}`}>{confidence.toUpperCase()}</span>
          )}
        </div>
        {reasoning && (
          <button type="button" className="kc-reasoning-toggle" onClick={() => setShowReasoning(p => !p)}>
            {showReasoning ? '▾' : '▸'} Reasoning
          </button>
        )}
        {reasoning && showReasoning && <div className="kc-reasoning-block">{reasoning}</div>}
        <div className="kc-msg-text">{visibleContent}</div>
      </div>
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────

function Composer({ onSend, isGenerating, transportMode }: {
  onSend: (text: string) => void;
  isGenerating: boolean;
  transportMode: string;
}) {
  const [val, setVal] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!val.trim() || isGenerating) return;
    onSend(val.trim());
    setVal('');
    textareaRef.current?.focus();
  }, [val, isGenerating, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  return (
    <div className="kc-composer">
      <div className="kc-composer-inner">
        <div className="kc-composer-box">
          <textarea
            ref={textareaRef}
            placeholder="Ask Kasai anything, or run a skill..."
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={isGenerating}
          />
          <div className="kc-composer-row">
            <div className="kc-ctx-chips">
              <button type="button" className="kc-ctx-chip" onClick={() => { setVal(p => p + '@'); textareaRef.current?.focus(); }}>@ SKILL</button>
            </div>
            <button
              className="kc-send"
              onClick={handleSend}
              disabled={!val.trim() || isGenerating}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="kc-composer-foot">
          <span><b>Enter</b> send · <b>Shift+Enter</b> new line</span>
          <span>Running on <b>HOME-NODE</b> · {transportMode === 'tauri' ? 'LOCAL' : 'DEV'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Right Pane (Skill Detail) ───────────────────────────────────────

function RightPane({ skill, onRunSkill, isGenerating }: {
  skill: Skill | null;
  onRunSkill: (skill: Skill) => void;
  isGenerating: boolean;
}) {
  if (!skill) {
    return (
      <aside className="kc-right">
        <div className="kc-right-empty">
          <div className="kc-right-empty-icon">K</div>
          <p>Select a skill to view details</p>
          <p className="kc-right-empty-sub">Or start chatting in the center pane</p>
        </div>
        <SlotStatusPanel />
      </aside>
    );
  }

  return (
    <aside className="kc-right">
      <div className="kc-right-head">
        <div className="kc-right-kicker">
          <span className="kc-skill-icon-lg">{skill.icon}</span> SKILL
        </div>
        <h2 className="kc-right-title">{skill.name}</h2>
        <div className="kc-right-desc">{skill.description}</div>
        {skill.token_cost > 0 && (
          <div className="kc-right-meta">Context cost: ~{skill.token_cost.toLocaleString()} tokens</div>
        )}
        <div className="kc-right-actions">
          <button className="kc-btn primary" onClick={() => onRunSkill(skill)} disabled={isGenerating}>
            {isGenerating ? 'PREPARING' : 'PREPARE RUN'}
          </button>
        </div>
      </div>
      <div className="kc-right-body">
        <div className="kc-r-section">STATUS</div>
        <div className="kc-right-status-row">
          <span className={`kc-status-dot lg ${skill.status}`} />
          <span>{skill.status === 'live' ? 'Loaded in context' : skill.status === 'idle' ? 'Available' : 'Error'}</span>
        </div>
        <div className="kc-r-section">TAG</div>
        <span className="kc-tag">{skill.tag}</span>
      </div>
      <SlotStatusPanel />
    </aside>
  );
}

// ── KasaiCore ───────────────────────────────────────────────────────

export function KasaiCore() {
  const transport = getTransport();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);

  // ── Tool-call state (K1-K6 event system) ──
  const [toolCalls, setToolCalls] = useState<Map<number, ToolCallInfo>>(new Map());

  const activeSkill = skills.find(s => s.id === activeSkillId) || null;

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent]);

  // Fetch engine status + skills on mount
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
            .filter(s => s.slot !== 'Embedder')
            .map(s => ({ slot: s.slot, name: s.model_name }));

          setNodeInfo({
            models: models.length ? models : [{ slot: 'Model', name: 'Loading...' }],
            vramUsed: Math.round(status.gpu.vram_mb * 0.6 / 1024 * 10) / 10,
            vramTotal: formatVram(status.gpu.vram_mb),
            uptime: 'Just started',
            gpu: status.gpu.name,
            ram: `${formatVram(status.gpu.vram_mb)} VRAM`,
          });
        }
      } catch { /* backend not ready */ }
    };

    const fetchSkills = async () => {
      try {
        const installed = await transport.invoke<Array<{
          id: string; name: string; icon: string; summary: string;
          description?: string; status: string; tag: string; token_cost: number;
        }>>('list_installed_skills');
        if (installed) {
          setSkills(installed.map(s => ({
            id: s.id, name: s.name, icon: s.icon,
            summary: s.summary,
            description: s.description || s.summary,
            status: (s.status as 'live' | 'idle' | 'error') || 'idle',
            tag: s.tag, token_cost: s.token_cost || 0,
          })));
        }
      } catch { /* skills not available yet */ }
    };

    fetchStatus();
    fetchSkills();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [transport]);

  // Agent event listener
  useEffect(() => {
    const unlisten = transport.listen<AgentEvent>('agent-event', (data) => {
      switch (data.type) {
        case 'Token':
          setStreamingContent(prev => prev + (data.content || ''));
          break;
        case 'KnowledgeGap':
          setMessages(prev => [...prev, {
            type: 'assistant' as const,
            id: crypto.randomUUID(), role: 'agent' as const,
            content: `Knowledge gap: "${data.domain}" — ${data.query} (confidence: ${data.confidence})`,
            timestamp: Date.now(),
            confidence: (data.confidence?.toLowerCase() as 'green' | 'orange' | 'red') || 'red',
          }]);
          break;
        case 'TurnComplete':
          setIsGenerating(false);
          setStreamingContent('');
          break;
      }
    });
    return () => { unlisten(); };
  }, [transport]);

  // ── Tool-call event listeners (K1-K6 system) ──
  useEffect(() => {
    // kasai://tool-call/update — fired for each new or updated tool call
    const unlistenUpdate = transport.listen<ToolCallEventPayload>(
      'kasai://tool-call/update',
      (payload) => {
        log.info('applet', 'Tool call started', {
          tool_name: payload.tool_name,
          tool_args: payload.tool_args,
          index: payload.index,
        });
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
      },
    );

    // kasai://tool-call/complete — fired when a tool call reaches terminal state
    const unlistenComplete = transport.listen<ToolCallEventPayload>(
      'kasai://tool-call/complete',
      (payload) => {
        log.info('applet', 'Tool call completed', {
          tool_name: payload.tool_name,
          status: payload.status,
          duration_ms: payload.duration_ms,
        });
        setToolCalls(prev => {
          const next = new Map(prev);
          const existing = next.get(payload.index);
          if (existing) {
            next.set(payload.index, {
              ...existing,
              status: payload.status,
              result: payload.result,
              error: payload.error,
              duration_ms: payload.duration_ms,
              audit_result: payload.audit_result,
            });
          } else {
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
          }
          return next;
        });
      },
    );

    return () => {
      unlistenUpdate();
      unlistenComplete();
    };
  }, [transport]);

  // Send handler
  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      type: 'user',
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setStreamingContent('');
    log.info('generation', 'Chat message sent', { message_length: text.length });

    // Reset tool-call map for new turn
    setToolCalls(new Map());

    try {
      const raw = await transport.invoke<string>('send_message', { message: text });
      setIsGenerating(false);
      setStreamingContent('');
      if (raw) {
        const parsed = parseThinkTags(raw);
        setMessages(prev => [...prev, {
          type: 'assistant' as const,
          id: crypto.randomUUID(),
          role: 'agent' as const,
          content: parsed.visible,
          timestamp: Date.now(),
          reasoning: parsed.reasoning || undefined,
        }]);
      }
    } catch (e) {
      setIsGenerating(false);
      setStreamingContent('');
      log.error('generation', 'Chat send failed', { error: String(e) });
      setMessages(prev => [...prev, {
        type: 'assistant' as const,
        id: crypto.randomUUID(),
        role: 'agent' as const,
        content: `Error: ${e}`,
        timestamp: Date.now(),
      }]);
    }
  }, [transport]);

  const handleRunSkill = useCallback((skill: Skill) => {
    if (isGenerating) return;
    handleSend(`Prepare the "${skill.name}" skill.\n\n${skill.description}`);
  }, [handleSend, isGenerating]);

  return (
    <div className="kc-root">
      <Sidebar
        skills={skills}
        nodeInfo={nodeInfo}
        activeSkillId={activeSkillId}
        onSelectSkill={setActiveSkillId}
      />

      <main className="kc-center">
        <div className="kc-chat-body">
          <div className="kc-chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="kc-empty">
                <div className="kc-empty-icon">K</div>
                <p className="kc-empty-title">Kasai is ready</p>
                <p className="kc-empty-sub">Local AI, no cloud, no limits. Type anything to begin.</p>
              </div>
            )}
            {messages.map(msg => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                toolCalls={msg.type === 'tool-calls' ? toolCalls : undefined}
              />
            ))}

            {isGenerating && streamingContent && (
              <div className="kc-msg">
                <div className="kc-msg-avatar agent">K</div>
                <div className="kc-msg-body">
                  <div className="kc-msg-who"><span className="kc-agent-name"><b>Kasai</b></span></div>
                  <div className="kc-msg-text streaming">{stripThinkTags(streamingContent)}</div>
                </div>
              </div>
            )}

            {isGenerating && !streamingContent && (
              <div className="kc-msg">
                <div className="kc-msg-avatar agent">K</div>
                <div className="kc-msg-body">
                  <div className="kc-thinking"><span /><span /><span /></div>
                </div>
              </div>
            )}
          </div>
          <Composer onSend={handleSend} isGenerating={isGenerating} transportMode={transport.mode} />
        </div>
      </main>

      <RightPane skill={activeSkill} onRunSkill={handleRunSkill} isGenerating={isGenerating} />
    </div>
  );
}
