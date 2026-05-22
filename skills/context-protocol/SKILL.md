---
name: context-protocol
description: |
  Context-bounded development protocol for agent-maintainable codebases. Enforces a 65k token
  module budget, wiki-first editing discipline, Mermaid pipe-diagram awareness, and MyMory vault
  integration at every stage. Load this skill before touching ANY codebase file. Mandatory triggers:
  any code editing, refactoring, module creation, architecture discussion, file creation, crate or
  package work, cross-module changes, or reviewing code structure. Also triggers on: "edit code",
  "refactor", "new module", "split this file", "architecture", "add a crate", "wire up", "connect
  these modules". If you are about to read or write code, this skill applies.
---

# Context-Bounded Development Protocol

You are operating under a strict context-window budget. Every module in the codebase is sized so
that a single agent, including local models with limited KV-cache, can load the module in full,
reason about it completely, and edit it atomically without chunking, RAG retrieval, or partial views.

This eliminates the dominant class of agent-induced bugs: hallucinations from working on fragments.

## 1. Context Budget Contract

**Canonical budget: 65,536 tokens per module unit.**

This is the ceiling, not the target. A module unit includes everything an agent needs loaded
simultaneously to work on that module:

| Slot              | Budget    | What goes here                                        |
|-------------------|-----------|-------------------------------------------------------|
| System prompt     | ~4k       | Agent instructions, persona, safety rules             |
| Wiki section      | ~2k       | This module's architecture entry from WIKI.md         |
| Pipe interfaces   | ~3k       | Pub API / type signatures of adjacent modules         |
| Code              | ~16k      | The module source (the thing you're editing)           |
| Tests             | ~6k       | Unit/integration tests for this module                |
| Conversation      | ~34k      | Task description, back-and-forth, tool results        |
| **Total**         | **~65k**  |                                                       |

**Effective code ceiling: ~16,000 tokens (~4,000 lines).** Any source file approaching this limit
is a candidate for splitting. Files exceeding it are a hard failure; split before editing.

**Why 65k and not 200k?** The budget targets the smallest capable agent that may touch the code.
Cloud models (Claude, Codex) have 200k+. Local models (Kasai Q8 9B, Q4 35B with VRAM-constrained
KV-cache) operate in the 28-65k range. Designing for the tighter window means every agent in the
ecosystem can maintain every module. The constraint is a feature.

## 2. What Counts as a Module

A **module** is the atomic unit of agent work. It maps to:

- **Rust**: one `.rs` file or one `mod.rs` + its private submodules within a single directory
- **TypeScript/React**: one `.tsx`/`.ts` file (component + its hooks + its types + its styles)
- **Python**: one `.py` file

A module's **public interface** is what crosses the boundary: `pub fn`, `export`, function
signatures, type definitions. Everything else is private implementation.

**The test**: can a fresh agent, with zero prior context, load this module's wiki entry + source +
tests + adjacent interfaces and fully understand it? If yes, the module is correctly bounded. If
no, it's too large or its boundaries are wrong.

### When a module legitimately exceeds the budget

Some constructs resist modularisation: auth flows, state machines, render pipelines. For these:

1. The wiki section becomes the agent's working context (a thorough architectural description
   of the full flow, with explicit call chains and data shapes).
2. The code is read in focused passes (one function or block at a time, guided by the wiki).
3. Edits are single-site: change one function, verify, commit, move to the next.
4. Flag the exception in the wiki: `<!-- OVERSIZED MODULE: exceeds 65k budget, pass-based editing required -->`.

## 3. Wiki-First Protocol

**Hard rule: no code edits without reading the wiki first.**

Before modifying, creating, or refactoring any code file:

1. **Locate** the wiki or architecture reference for that codebase (WIKI.md, ARCHITECTURE.md,
   or README.md with architecture section). Check the project root, then `/docs`.
2. **Read** the section covering the module you are about to touch.
3. **State** which section you referenced before proposing any change.
4. **Cross-reference**: does the file on disk match what the wiki describes? If mismatch, flag
   it. Do not silently edit assuming the code or the wiki is correct.
5. **After editing**, update the wiki section to reflect the change. Wiki and code move together.

**If no wiki exists**: stop. Do not edit. Scaffold the wiki first by reading the codebase
structure and documenting what exists. Architecture-blind edits are the source of compounding
drift.

**If wiki is stale**: note the discrepancy, update the wiki section first, then proceed with the
code change.

## 4. Pipe Diagram Protocol

Cross-module relationships are documented as Mermaid pipe diagrams in the wiki. Before any work
that touches more than one module, read the pipe diagram for that flow.

### Pipe categories

Every inter-module connection is one of five types. Name the type in the wiki and in diagram
edge labels so any agent knows what discipline to apply:

| Category       | What it carries                          | Agent discipline                        |
|----------------|------------------------------------------|-----------------------------------------|
| **Data**       | Request/response, payload transforms     | Stateless, test at boundaries           |
| **Event**      | Fire-and-forget signals, pub/sub         | Verify listener registration            |
| **State**      | Shared mutable state, store updates      | No silent mutation, audit trail          |
| **Control**    | Lifecycle signals, orchestration cmds    | Order-of-operations matters             |
| **Capability** | Need/ability negotiation, runtime select | Test all resolution paths               |

### Pipe locality

Annotate every pipe with its locality. This determines failure modes:

| Locality            | Meaning                                  | Failure mode          |
|---------------------|------------------------------------------|-----------------------|
| **process-local**   | Within one running app on one device     | Panics, type errors   |
| **device-local**    | Between apps on the same machine         | IPC timeouts, crashes |
| **federated-peer**  | Between user devices, peer-to-peer       | Network, latency      |
| **online-dep**      | Crosses to a remote server               | Outage, latency, cost |

**Online dependencies are strategic liabilities.** Any pipe labelled `online-dep` requires
explicit justification in the wiki. Minimise this count.

### Mermaid conventions

```
graph LR
  A -- "data, process-local" --> B
  B -. "event, device-local" .-> C
  C -- "capability, process-local" --> D
```

Solid line = synchronous. Dashed line = asynchronous. Edge label = `category, locality`.

Keep pipe diagrams in the wiki alongside the modules they connect. Update the diagram whenever
a module boundary changes.

## 5. MyMory Integration

This protocol integrates with the MyMory vault at every stage. The vault is the cross-session
memory; without it, each session starts from zero and architectural decisions get re-litigated.

### Before any substantive work

**Recall**: query the vault for prior context on the module, crate, or flow you are about to
touch. Use `vault_query` or `mymory-recall` skill. If the vault returns relevant decisions,
architecture notes, or blockers, incorporate them. Asking the user a question the vault can
answer is a protocol failure.

### During work

**Remember**: after every decision, architecture change, locked choice, entity reference, or
blocker, append a single timestamped line to the vault via `vault_append` or `mymory-remember`.
Categories: `decision`, `architecture`, `fact`, `entity`, `correction`, `blocker`, `next`.
No ceremony; consolidation happens later.

### After work

**File**: at session end or when significant decisions have accumulated, file a structured
session note via `mymory-file-session`. This creates a graph-dense vault entry that links to
referenced entities and sources.

**Update wiki**: ensure the module's wiki section reflects what changed. Wiki and vault are
complementary: wiki is the current-state reference, vault is the decision history.

## 6. Edit Discipline

When editing code under this protocol:

1. **Read the wiki section** for the target module.
2. **Read the source file in full.** Never edit a file you have not read in the current session.
3. **Map the call chain** if the edit touches cross-module boundaries. Write the chain in chat:
   `A calls B calls C`, with input/output types. Get confirmation before editing any link.
4. **One edit per confirmed step** when in deep code. No bulk edits across multiple files without
   walking through each one.
5. **Verify** the edit: syntax check, type check, or test run as appropriate.
6. **Append to vault**: log what changed and why.
7. **Update wiki**: reflect the change in the module's wiki section.

### Anti-hallucination guardrails

- Never assume function signatures, import paths, or auth flows from memory. Re-read.
- If you lose track of where you are in a file or flow, say so: "I have lost position in
  [file/flow]. Re-reading now." Do not guess.
- When ship pressure is high, the protocol becomes more important, not less. Cutting corners
  on context causes multi-hour debugging sessions.

## 7. Module Contract Template

Every module's wiki entry follows this structure:

```markdown
### [module-name] (path/to/file.ext)

**Purpose**: One sentence.
**Budget**: [token count] tokens ([line count] lines)
**Pipes in**: [list of incoming pipes with category and source module]
**Pipes out**: [list of outgoing pipes with category and destination module]
**Public API**: [exported functions/types with signatures]
**State**: [what mutable state this module owns, if any]
**Tests**: [path to test file, what's covered]
**Last verified**: [date, by whom/which agent]
```

When creating a new module, fill this template before writing the code. The template is the
design doc. When the template is complete and reviewed, the code writes itself.
