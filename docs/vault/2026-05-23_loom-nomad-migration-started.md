# Loom NOMAD Migration Started

Date: 2026-05-23

Started the Project NOMAD to Everywear Rust migration as a first visible applet slice.

## Source Material

- `C:\Users\MAG MSI\Project Claude\Kasai-Local\NOMAD_Everywear_Rust_Port_Architecture_v1.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_01_Ollama_to_KasaiLocal.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_02_MySQL_to_SQLite.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_03_Qdrant_to_usearch.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_04_Kiwix_to_zimrs.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_05_AdonisJS_to_Axum.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_06_Maps_to_loom_maps.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_07_CyberChef_to_datatools.md`
- `C:\Users\MAG MSI\Project Claude\Kasai-Local\Loom_Transfer_08_FlatNotes_to_loom_notes.md`

## Everywear Slice

- Added `applets/loom` as a frontend-only migration cockpit on port 3008.
- Registered `loom` in the Everywear shell applet registry and browser fallback.
- Added lazy shell mounting through `AppletViewRouter`.
- Added applet icon colors and monogram.

## Current Migration Track

1. `loom-teacher-agent`: replace Ollama Docker and HTTP hops with My Maits Lite runtime contracts.
2. `loom-db`: replace NOMAD MySQL/Knex with consolidated SQLite plus future migration tracking.
3. `loom-vector`: replace Qdrant with usearch and SQLite chunk metadata.
4. `loom-zim`: replace Kiwix server with native ZIM reading and Axum routes.
5. `loom-server`: translate AdonisJS controllers into typed Axum handlers.
6. `loom-maps`, `loom-datatools`, `loom-notes`: port PMTiles, CyberChef, and FlatNotes.
7. Everywear integration: global search, vault registration, licence gate, packaged content.

## Verification

- `npm run build --workspace @everywear/loom` passed.
- `npm run build` in `platform/everywear-os` passed with the existing Vite chunk warning.
- `cargo check -p everywear-os` passed with existing dead-code warnings.
- Dev servers are listening on ports 5173, 3001, 3002, 3003, 3006, 3007, and 3008.
- Browser verification launched The Loom inside the Everywear shell and found 7 migration phase cards.

## Follow-Up: IGCSE Teacher Pack

- Added a guided IGCSE content selection scene to The Loom.
- Added required/recommended/optional pack messaging for Kasai, loom-db, ZIM archives, maps, and skills.
- Added pedagogical principles for the teacher agent: diagnostics, mastery, retrieval, scaffolding,
  cognitive load, UDL, flexible learning preferences, formative feedback, and metacognition.
- Added `skills/igcse-teacher/SKILL.md` as the Kasai teacher skill artifact.
- Added `docs/loom-igcse-teacher-pack.md` as the curriculum/content-pack plan.
