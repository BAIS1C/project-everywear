---
name: ooda-codebase
description: |
  OODA loop for codebase context-fitness analysis and drift prevention. Observes any codebase by
  measuring every file against a context-window budget, orients by mapping dependencies and wiki
  coverage, decides on split/refactor priorities, and acts by proposing or executing changes.
  Primary aim: prevent context drift, where agent-maintained code silently diverges from its
  architectural documentation. Triggers on: "OODA the codebase", "analyze the codebase",
  "check for drift", "codebase health", "module audit", "context fitness", "scan the project",
  "what needs splitting", "are we drifting", "codebase review", "architecture audit",
  "run OODA", "check module sizes", any request to assess or audit codebase structure.
  Also triggers when starting work on an unfamiliar codebase, onboarding to a new project,
  or after a large refactor to verify structural integrity.
---

# OODA Codebase Analysis

Run an Observe-Orient-Decide-Act loop on a codebase to assess its fitness for context-bounded
agent maintenance and to detect or prevent context drift.

**Context drift** is the silent divergence between what the wiki/architecture docs describe and
what the code actually does. It is the primary failure mode of agent-maintained codebases. Every
session that edits code without updating the wiki increases drift. Enough drift and the wiki
becomes fiction; agents hallucinate because their reference material is wrong.

This skill detects drift, measures it, and produces actionable fixes.

## Prerequisites

This skill works with the **context-protocol** skill (modular development discipline) and the
**MyMory vault** (cross-session memory). If context-protocol is loaded, this skill validates
compliance. If MyMory is available, findings are recorded to the vault for cross-session tracking.

Neither is strictly required. This skill works standalone on any codebase.

## The OODA Loop

### Phase 1: OBSERVE (Scan and Measure)

Gather raw data. No judgments yet.

#### 1.1 File census

Scan every source file in the codebase (excluding vendored deps, node_modules, target/, dist/,
.venv/, build/). For each file, record:

- Path
- Language
- Line count
- Estimated token count (lines x 4, conservative)
- Last modified date

```bash
find . -type f \( -name "*.rs" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" \) \
  ! -path "*/node_modules/*" ! -path "*/target/*" ! -path "*/.venv/*" \
  ! -path "*/dist/*" ! -path "*/build/*" | while read f; do
  lines=$(wc -l < "$f")
  tokens=$((lines * 4))
  echo "$tokens $lines $f"
done | sort -rn
```

#### 1.2 Distribution analysis

Bucket files by token count against the canonical 65k budget:

| Bucket          | Meaning                                           |
|-----------------|---------------------------------------------------|
| <= 2k tokens    | Comfortable. No action needed.                    |
| 2k - 8k tokens  | Normal. Standard module size.                     |
| 8k - 16k tokens | Watch list. Approaching code budget ceiling.      |
| 16k - 28k tokens| Split candidate. Exceeds Kasai Q4 35B usable.    |
| 28k - 65k tokens| Hard split. Exceeds all local model budgets.      |
| > 65k tokens    | Critical. Cannot be loaded by any agent in full.  |

Report: total files, total tokens, files per bucket, percentage fitting each budget tier.

#### 1.3 Wiki census

Check for architecture documentation:

- Does WIKI.md / ARCHITECTURE.md exist?
- How many modules have wiki entries?
- How many source files have NO corresponding wiki entry?
- When was the wiki last modified vs when was the code last modified?

#### 1.4 Pipe diagram census

- Do Mermaid pipe diagrams exist in the wiki?
- Which cross-module flows are documented?
- Which cross-module imports have no corresponding pipe diagram?

### Phase 2: ORIENT (Map and Assess)

Interpret the observations. Identify patterns and risks.

#### 2.1 Oversized module analysis

For every file exceeding 8k tokens (the "watch list" threshold):

1. Read the file
2. Identify logical sections (structs, impl blocks, function groups, component sections)
3. Assess: is this one module doing too much, or is it legitimately cohesive?
4. If splittable, identify the natural split boundaries

#### 2.2 Drift detection

For every module that has both code and a wiki entry:

1. Read the wiki entry
2. Read the code
3. Check for drift indicators:
   - **Structural drift**: wiki says module has N public functions, code has M
   - **Naming drift**: wiki uses different names than the code
   - **Dependency drift**: wiki describes pipe connections that don't exist in code, or code
     has connections the wiki doesn't mention
   - **Stale references**: wiki references files, functions, or types that no longer exist
   - **Ghost modules**: wiki describes modules that have been deleted or moved

Rate each module's drift: **clean** (wiki matches code), **minor** (cosmetic differences),
**major** (structural mismatch), **critical** (wiki is fiction).

#### 2.3 Orphan detection

Identify:

- **Undocumented modules**: source files with no wiki entry
- **Dead wiki entries**: wiki sections describing modules that no longer exist
- **Unconnected modules**: files that import nothing and are imported by nothing
- **Duplicate logic**: files with suspiciously similar content (copy-paste modules)

#### 2.4 Cross-module coupling analysis

For files that import from many other modules:

- Count unique import sources per file
- Files importing from 5+ other modules are coupling hotspots
- Files imported BY 5+ other modules are stability-critical (changes ripple)

### Phase 3: DECIDE (Prioritize)

Rank findings by impact and produce a prioritized action list.

#### Priority ranking

1. **Critical drift** (wiki is fiction): fix first, everything else is built on sand
2. **Oversized modules** (>16k tokens): split before next edit session
3. **Major drift** (structural mismatch): update wiki to match reality
4. **Undocumented modules**: add wiki entries for files touched frequently
5. **Missing pipe diagrams**: document cross-module flows that are complex or fragile
6. **Minor drift**: batch-fix during a dedicated wiki maintenance pass
7. **Coupling hotspots**: flag for future architectural consideration, don't block work

#### Decision output format

```markdown
## OODA Decision Report: [project-name]
**Date**: [timestamp]
**Codebase**: [path]
**Total files**: N | **Total tokens**: N | **Fits 65k budget**: N%

### Critical (fix now)
1. [finding]: [action]

### High (fix before next edit session)
1. [finding]: [action]

### Medium (schedule)
1. [finding]: [action]

### Low (backlog)
1. [finding]: [action]
```

### Phase 4: ACT (Execute or Propose)

Based on the decision report, take action. The appropriate action depends on the severity and
the user's preference.

#### For critical and high priority items

**If the user has authorized edits**: execute the fixes directly.

- Update stale wiki entries to match current code
- Add wiki entries for undocumented modules (read the module, write the entry)
- Split oversized modules along identified boundaries
- Update pipe diagrams to reflect actual connections
- After each action, append to MyMory vault with category `architecture`

**If assessment-only mode**: produce the decision report and specific fix proposals. Each
proposal should include the exact wiki text to add/change, or the exact module split plan
(which functions move where, how imports change).

#### For medium and low priority items

Always propose, never auto-execute. These go into the decision report as backlog items.

#### Vault recording

After completing the OODA loop, file the results:

1. **Append** a summary line to the vault: `"OODA pass on [project]: [N] files, [drift-count]
   drift items found, [split-count] split candidates"`
2. **File** the full decision report as a dated vault note if findings are significant
3. **Update** CONTEXT.md (or equivalent project context) with the current structural state

## Running a Targeted OODA

The full loop is comprehensive but expensive. For targeted checks:

### Drift-only scan
Skip observe phase file census. Read only the wiki and the files it references. Check for
drift between them. Fast, focused on the highest-risk failure mode.

### Single-module audit
Run the full loop on one module: read its wiki entry, read its code, check its tests, verify
its pipe connections, measure its token count. Useful before editing a module you haven't
touched recently.

### Post-refactor verification
After a large change: re-measure affected files, verify wiki entries are updated, check that
pipe diagrams still reflect reality. Confirms the refactor didn't introduce new drift.

## Drift Prevention Discipline

The OODA loop detects drift. These practices prevent it:

1. **Wiki moves with code**: every PR/commit that changes module structure also changes the wiki.
2. **Periodic OODA passes**: schedule a monthly full scan. Drift is cumulative; catching it
   early is cheaper than letting it compound.
3. **New module protocol**: fill the module contract template BEFORE writing code. The template
   is the design doc; if you can't fill it, you don't understand the module well enough to build it.
4. **Agent session hygiene**: every agent session that edits code must read the wiki first and
   update it after. This is enforced by context-protocol; OODA verifies compliance.
5. **Vault as audit trail**: the MyMory vault records what changed and when. During an OODA pass,
   vault history reveals which modules are changing without corresponding wiki updates.
