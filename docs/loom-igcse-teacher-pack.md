# Loom IGCSE Teacher Pack

Date: 2026-05-23

This is the first curriculum plan for The Loom as an offline IGCSE tutor applet using Kasai as
the teacher agent.

## Syllabus Baseline

Primary baseline: Cambridge IGCSE, because the current transfer request uses IGCSE generically
and Cambridge provides official public syllabus pages.

- Mathematics 0580: current public Cambridge page lists 2025-2027 and 2028-2030 syllabuses.
  Source: https://www.cambridgeinternational.org/0580
- Biology 0610: Cambridge lists the 2026-2028 syllabus.
  Source: https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/
- Chemistry 0620: Cambridge lists the 2026-2028 syllabus.
  Source: https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-chemistry-0620/
- Physics 0625: Cambridge lists the 2026-2028 syllabus.
  Source: https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/

English and Computer Science should be confirmed against the learner's exact syllabus code and
exam year before exam-entry advice.

## Offline Content Packs

The Loom should not silently download large files. The learner sees:

1. Required local skill and database setup.
2. Reused Kasai model slot if a suitable model is already available.
3. Recommended ZIM packs from the Kiwix library.
4. Optional literature, computing, and map packs.
5. Exact URL, size, checksum, and destination before a real download starts.

Recommended starter ZIM categories:

- compact school encyclopedia
- science reference
- mathematics / Wikibooks
- Project Gutenberg literature
- programming or computer science Q&A subset

Primary ZIM discovery sources:

- https://library.kiwix.org/
- https://download.kiwix.org/zim/

## Teacher Behaviour

Kasai should teach through:

- diagnostic checks
- mastery learning
- retrieval practice and spaced review
- scaffolding with fading support
- cognitive load management
- dual coding
- formative feedback
- metacognition
- universal design and accessibility
- flexible learning preferences, not fixed learning-style labels

## Backend Follow-Up

- Add `loom-db` tables for learner profile, selected syllabus, content manifests, misconceptions,
  retrieval schedule, and download receipts.
- Add a content resolver that queries the Kiwix library and Everywear content registry.
- Add a downloader that supports resume, checksum verification, disk-space checks, and explicit
  approval for large files.
- Wire Kasai skill loading so `skills/igcse-teacher/SKILL.md` can be installed or selected from
  the runtime, not just shown in preview.
