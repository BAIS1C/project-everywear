# Vault Note: Everywear Vault Cross-Applet AI Repository Canon

Date: 2026-05-24

## Canon

Everywear Vault is the full cross-applet AI repository for all reusable assets, sources, outputs, memory artifacts, and relationships across Everywear. It is not a flat media folder and it is not Gener8's song library.

The Vault should index assets where they live by default. It should copy or move files only when Everywear owns the output or the user explicitly imports/copies an asset into Vault storage. Engine compatibility needs, such as ACE-Step requiring a reference or cover file in a specific job location, should be handled by temporary staging copies or links under `~/.everywear/staging/`, not by moving the user's original files.

## Required Sections

- Media: generated songs, stems, riffs, samples, references, cover sources, videos, images, and character art.
- Audio Library Views: Gener8 Songs, Stems, Riffs, Samples, References, Cover Sources, Local Audio.
- Patches and Models: Style Patches, Visual Patches, LoRAs, adapters, embeddings, and model packs.
- Creator Studio Assets: DAW projects, timelines, generation sessions, training sets, prompts, presets, and patch training material.
- Character Studio Assets: characters, turnarounds, expression sheets, rigs, voices, outfits, props, visual references, and visual patches.
- Mait and Agent Assets: Trait Shards, Skill Shards, identity manifests, voice shards, presence shards, animation shards, and tool packs.
- Knowledge: PDFs, documents, notes, web captures, YouTube transcripts, article extracts, RAG chunks, and local reference files.
- Conversations: My Mait chats, Kasai threads, LLM sessions, project-linked histories, and applet-specific conversations.
- Activity: generation jobs, logs, audit trails, provenance, prompt history, training runs, and diagnostics.
- Relationships: source links such as "song used reference", "cover came from source", "patch trained on assets", "conversation produced document", and "DAW project uses riffs/stems/samples".

## Gener8 Bug-Fix Implications

- Gener8's Songs list must show finished generated songs only.
- Stem files such as `track_1.mp3`, `track_8.mp3`, etc. must not appear as top-level songs. They belong in a Stems subsection grouped under parent song/session/project.
- Riffs are short reusable musical building blocks for DAW composition.
- Samples are uploaded or captured short audio clips, one-shots, FX, chops, vocal snippets, percussion hits, or short stem clips.
- References and Cover Sources should appear in their own sections and should preserve the original file location where possible.
- Local Audio should represent user-owned tracks indexed in place, distinct from Vault-owned generated outputs.
- Style Patches are user-facing LoRA/adapter assets for Gener8/Style Forge, not generic presets.
- Visual Patches are LoRAs/adapters/embeddings/style modules for Character Studio, 1magen, and video tools.

## Current Port Gap

The current Everywear Gener8 port has treated "all Vault audio" as "songs". That caused imported stem files to appear as top-level library rows named `track_#`. It also means the old S3 `library.json` semantics have not been fully reproduced in the Vault-backed UI.

The next implementation pass must define a typed Vault taxonomy and make Gener8's old library a view over that taxonomy, rather than flattening every audio document into the song library.

