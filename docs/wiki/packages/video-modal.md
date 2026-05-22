# Video Modal Package Module Contract

### pkg-video-modal (`packages/video-modal/`)

**Purpose**: Provide the shared Gener8/Vid video generation modal, render worker, lyric parsing utilities, silhouette renderer, and canvas visualizer primitives.

**Budget**: Key files: `components/VideoGeneratorModal.tsx` 3,642 lines, `workers/videoRenderWorker.ts` 1,059 lines, `render/canvasVisualizers.ts` 814 lines, `lib/silhouetteEngine.ts` 372 lines, `lib/lrcParser.ts` 128 lines. The package is under the module-unit budget when loaded as the shared video surface, but `VideoGeneratorModal.tsx` is near the practical per-file ceiling and should be split before major feature additions.

**Pipes in**:

- Gener8 modal wrapper -> shared `VideoGeneratorModal` (`data, process-local`)
- Vid modal wrapper -> shared `VideoGeneratorModal` (`data, process-local`)
- Browser worker messages -> `videoRenderWorker.ts` (`data, process-local`)

**Pipes out**:

- Shared modal -> render worker for export rendering (`control, process-local`)
- Shared modal -> Pexels media search/download APIs when used (`data, online-dep`)
- Shared modal -> applet-provided `registerVideo` callback when supplied (`event, process-local`)
- Render worker -> canvas visualizers, lyric parser, silhouette engine (`data, process-local`)

**Public API**:

- `VideoGeneratorModal`
- `VideoModalSong`
- `VideoModalTier`
- `VaultVideoRegistration`
- `parseLrc(raw) -> LrcLine[]`
- `getCurrentLine(parsed, currentTime) -> string`
- `srtToLrc(srt) -> string`
- `naiveLrcFromLyrics(lyrics, durationSec) -> string`
- `drawS3Hero(...)`
- `drawDJAtWork(...)`

Additional internal render exports live in `render/canvasVisualizers.ts` and are used by the modal/worker.

**State**:

- The React modal owns video configuration UI state and export state.
- `silhouetteEngine.ts` owns module-level silhouette smoothing/cache state, resettable through `resetSilhouetteEngine()`.
- Render worker owns per-render job state while active.

**Tests**: No dedicated unit tests. Verified by `npm run build` for the affected workspaces during the modularisation pass per `CONTEXT.md`.

**Pipe diagram**:

```mermaid
graph LR
  Gener8["Gener8 wrapper"] -- "data, process-local" --> Modal["VideoGeneratorModal"]
  Vid["Vid wrapper"] -- "data, process-local" --> Modal
  Modal -- "control, process-local" --> Worker["videoRenderWorker"]
  Worker -- "data, process-local" --> Visualizers["canvasVisualizers"]
  Worker -- "data, process-local" --> Lyrics["lrcParser"]
  Worker -- "data, process-local" --> Silhouette["silhouetteEngine"]
  Modal -- "data, online-dep" --> Pexels["Pexels API"]
  Modal -. "event, process-local" .-> VaultCallback["registerVideo callback"]
```

**Last verified**: 2026-05-22, Codex post-modularisation repair pass.

**Backlog**: Split `components/VideoGeneratorModal.tsx` before adding more S3-derived modal features.
