# Pipe Diagram Examples

Reference examples for Mermaid pipe diagrams following the context-protocol conventions.

## Basic Flow (Single Product)

```mermaid
graph LR
  subgraph "everywear-os (shell)"
    auth["auth.rs"]
    gpu["gpu.rs"]
    launcher["launcher.rs"]
    router["engine_router.rs"]
    vram["vram_scheduler.rs"]
  end

  subgraph "applet (3nvizen)"
    ipc_3nv["runtime_ipc.rs"]
    sidecar["ltx-runtime (Python)"]
  end

  auth -- "data, process-local" --> launcher
  gpu -- "capability, process-local" --> vram
  vram -- "state, process-local" --> router
  launcher -- "control, process-local" --> router
  router -- "data, device-local" --> ipc_3nv
  ipc_3nv -- "data, process-local" --> sidecar
```

## Pipe Category Quick Reference

### Data pipe (stateless transform)
```mermaid
graph LR
  A -- "data, process-local" --> B
```
Test at boundaries. Input X always produces output Y.

### Event pipe (fire-and-forget)
```mermaid
graph LR
  A -. "event, device-local" .-> B
```
Dashed = async. Emitter doesn't wait. Verify listener is registered.

### State pipe (shared mutable)
```mermaid
graph LR
  A -- "state, process-local" --> B
```
Most dangerous. No silent mutation. Changes require audit trail.

### Control pipe (lifecycle/orchestration)
```mermaid
graph LR
  A -- "control, process-local" --> B
```
Order matters. Sequence violations cause hard failures.

### Capability pipe (negotiation)
```mermaid
graph LR
  A -- "capability, process-local" --> B
```
Declare need, declare ability, resolve at runtime. Test all resolution paths.

## Multi-Product Flow

```mermaid
graph TB
  subgraph "Everywear OS"
    shell["Shell Runtime"]
  end

  subgraph "Applets"
    kasai["Kasai (AI Chat)"]
    gen8["Gener8 (Music)"]
    threenvizen["3nvizen (Video)"]
    imagen["1magen (Image)"]
  end

  shell -- "control, process-local" --> kasai
  shell -- "control, process-local" --> gen8
  shell -- "control, process-local" --> threenvizen
  shell -- "control, process-local" --> imagen

  shell -- "capability, process-local" --> kasai
  shell -- "capability, process-local" --> gen8

  kasai -. "event, process-local" .-> shell
  gen8 -. "event, process-local" .-> shell
  threenvizen -. "event, device-local" .-> shell
```

## Annotation Conventions

- **Solid line** (`-->`): synchronous, caller blocks
- **Dashed line** (`-.->` or `-.->`): asynchronous, fire-and-forget
- **Edge label**: always `"category, locality"`
- **Subgraphs**: group by crate, applet, or deployment boundary
- **Online dependencies**: use red or bold styling to flag: `A -- "data, online-dep" --> B`
