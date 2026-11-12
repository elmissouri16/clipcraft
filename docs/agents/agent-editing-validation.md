# Agent editing validation

Starting commit: `6bfd715`. Source-tree SHA-256: `077ffb977029e4afb961d82b0c805f43ff035ed699d2715b71b601faf9f24236`.

| Battery | Pass | Fail | Suite files |
| --- | ---: | ---: | ---: |
| Starting checkout, same environment | 80 | 23 | 103 |
| Final source | 86 | 23 | 109 |

All 6 new suites pass. Every existing suite has the same exit status as the starting checkout. The historical count in AGENTS.md describes an older battery/environment.

New suites:

- `test-agent-audio.mjs`
- `test-agent-edit-contract.mjs`
- `test-agent-range-edits.mjs`
- `test-agent-scenes.mjs`
- `test-agent-speed-sync.mjs`
- `test-agent-vision-providers.cjs`

Real-app verification:

- `agent-editing`: PASS; actual UI/IPC/FFmpeg, 14 checks.
- `agent-audio`: PASS; actual UI/IPC/FFmpeg, 9 checks.
- `agent-scenes`: PASS; actual UI/IPC/FFmpeg, 12 checks.
- Live Codex vision: PASS; 13 checks, including actual source colors and rendered title recognition.
- Renderer compilation: PASS; output written under `/tmp`, no installer.
- Audio smoke injects speech inference; audio preparation, caching, cancellation, captions and FFmpeg remain real. Other provider image transports are tested with mocked responses.

| Finding | Evidence |
| --- | --- |
| Audible detached/overlay audio and silence safety | `test-agent-audio.mjs`, real `agent-audio` smoke |
| Unique cut IDs, linked pairs and ripple timing | `test-agent-range-edits.mjs`, real `agent-editing` smoke |
| Invalid ranges, blocked/no-op results and stale writes | `test-agent-edit-contract.mjs`, real editor smoke |
| Related-track speed/word timing and transition duration | `test-agent-speed-sync.mjs`, real FFmpeg frame/source comparison and editor smoke |
| Scene detection, cached source identity and live mapping | `test-agent-scenes.mjs`, real `agent-scenes` smoke |
| Grounded searchable observations and bounded image context | Scene/provider suites, real scene smoke and live vision smoke |
| Exact scoped timeline data, selection and media IDs | Edit-contract/context suites and editor smoke |
| Speech paging, word provenance, cache reuse and cancellation | Audio/cloud/Whisper suites and real audio smoke |
| Completion failure accounting and fresh composition samples | Runner suite and real scene smoke |
| Request-owned Undo at history capacity and manual-edit protection | Range/edit-contract suites and real editor/scene smokes |

Existing failing suite files (all reproduced at the starting commit):

- `test-ai.cjs`
- `test-anim.cjs`
- `test-assets.cjs`
- `test-audiofx.cjs`
- `test-captions-linux.cjs`
- `test-captions.cjs`
- `test-enhance.cjs`
- `test-fallback.cjs`
- `test-fonts.cjs`
- `test-groq.cjs`
- `test-library.cjs`
- `test-retired-background-removal.cjs`
- `test-soundza.cjs`
- `test-srt.mjs`
- `test-textanim-export.cjs`
- `test-textanim-word-export.cjs`
- `test-textsmooth-export.cjs`
- `test-tplmotion-export.cjs`
- `test-tracking.cjs`
- `test-transition-packs-export.cjs`
- `test-tts.cjs`

These include missing assets/SRT/Windows fonts and configuration, sandbox network/listen/path restrictions, unavailable Electron paths in legacy test scripts, and existing animation/audio-filter/transition export assertions. They are not all classified as environment-only. This work does not claim to repair those unrelated failures.

Detailed logs: `/tmp/clipcraft-verified-battery/`, `/tmp/clipcraft-starting-battery/`, `/tmp/clipcraft-final-ui/`, `/tmp/clipcraft-agent-vision-live/`. Consolidated evidence: `/tmp/clipcraft-completion-evidence.json`.

Known supported-scope limits: visual boundaries are candidates; descriptions cover sampled frames; visual inspection needs a vision-capable model. Unrepresentable speed-envelope/preset/processed-audio splits fail atomically rather than producing an inaccurate edit. No push was performed after the explicit no-push instruction.
