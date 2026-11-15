# ClipCraft plugin system

Status: Stages 0–2, 3a and 3c implemented: export presets, declarative effects/transitions, sandboxed marker commands and CraftAI command discovery/execution. Stage 3b adds brokered AI chapter suggestions and caption translation, with explicit text-sharing consent and mandatory host review. Stage 4a adds bounded local GIF export jobs through the same sandbox, with host-owned rendering and verified artifacts. Stage 4b adds declarative OpenAI-compatible provider plugins with scoped credentials and host-owned requests. Stage 5a adds isolated custom panels, approved marker actions, scoped local preferences and host-owned dock controls. The public SDK adds typed authoring tools, and [developer sessions](plugin-development.md) add explicit command/panel reload and bounded runtime diagnostics. See [custom panel contract](plugin-panels.md), [AI provider contract](plugin-ai-providers.md), [GIF export contract](plugin-gif-export.md) and [implementation roadmap](plugin-roadmap.md).

## Goals and boundaries

Community developers can add features through versioned contribution points. Start with export presets, then effects/transitions, commands and AI workflows, provider/export integrations, custom panels and managed local jobs. Each stage ships independently with an original example and a real-app acceptance gate. Plugins do not import editor internals. Existing features are adapted incrementally; a conversion of every built-in feature is not required.

Export presets, effects and transitions remain declarative. Command packages may additionally include one bounded JavaScript entry executed in an isolated sandbox after per-run approval. No install scripts, dependencies, direct network/filesystem access, raw FFmpeg arguments or new encoders are supported. Custom panels run in a separate sandboxed renderer and receive declared summary/storage grants and explicitly approved command requests. AI-capable commands may use fixed host-brokered chapter or translation services after explicit sharing consent. See the [command SDK](plugin-commands.md). Publisher strings are unverified and shown as such. A fingerprint detects changed content; it does not authenticate an author. Opening a project never installs a plugin.

## Components and ownership

- `shared/pluginManifest.mjs` owns the import-free public manifest contract.
- Electron's plugin manager owns package validation, immutable storage, inventory, activation and removal. Mutations are serialized; inventory replacement and package placement use rename.
- The renderer receives validated inventory and read-only preset contributions through a narrow preload bridge. Plugin IPC accepts only the editor's own main frame.
- The export adapter snapshots a preset into existing custom settings. It uses the existing resolver, capability detection, codec fallbacks and encoder path.
- Plugin UI uses the native Settings page/group components, existing dropdowns and semantic theme tokens. Descriptions are text, never HTML.

Plugin data lives under `<userData>/plugins/` (or the isolated smoke profile). Each content fingerprint names an immutable directory holding `plugin.json`. `inventory.json` contains `{key, enabled}` records. At most one version of a plugin ID is preferred/enabled for new contributions. While that plugin ID is enabled, its retained installed effect/transition versions remain available to projects pinned to them. Older rows display “Retained version.” Disabling the preferred version disables rendering for that plugin ID. Older versions remain installed until removed; enabling one is a rollback operation. A broken or changed manifest is unavailable and its diagnosis remains visible. An unreadable inventory refuses mutations rather than resetting user state.

## Manifest v1

A package is a gzip-compressed tar archive named `*.clipcraft-plugin.tgz`. Declarative packages contain a regular root `plugin.json`; command packages additionally contain the declared `commands.js` entry. A custom panel declares root `panel.html` and optional `panel.js` / `panel.css` assets. Developer mode snapshots those declared files from a folder containing no other entries. Reload means installing a new validated snapshot; changing content requires incrementing its package version.

| Field | Contract |
|---|---|
| `id` | `publisher.name`, lowercase letters, digits and hyphens; each segment starts with a letter and is at most 48 characters |
| `name`, `publisher` | Nonempty plain text, up to 160 characters; publisher is not verified |
| `version` | Stable `major.minor.patch` |
| `apiVersion` | Exactly `1` |
| `minClipcraftVersion` | Optional stable minimum version, default `2.0.0` |
| `description` | Optional plain text, up to 1,000 characters |
| `permissions` | Empty for declarative packages; executable commands request narrowly defined SDK capabilities. Provider destination consent is separate |
| `entry` | Required `commands.js` when commands are contributed; otherwise absent |
| `contributes.exportPresets` | Optional array of up to 100 presets |
| `contributes.effects` | Optional array of up to 100 declarative effects |
| `contributes.transitions` | Optional array of up to 100 declarative transitions |
| `contributes.commands` | Optional array of up to 100 sandboxed commands |
| `contributes.aiProviders` | Optional array of up to 16 declarative OpenAI-compatible providers |
| `contributes.panels` | At most one custom panel with optional panel-local `project.read` permission |

At least one contribution is required. Each contribution kind has a separate local-ID namespace. Effect contributions require a Stage-2a build and transitions require Stage 2b; older API-1 builds reject unsupported contribution kinds.

Unknown fields and contribution types are rejected; only the constrained command entrypoint is supported. Core IDs cannot be replaced: contributions use `<plugin-id>/<local-id>`. Local preset IDs are unique lowercase letters, digits and hyphens, starting with a letter, at most 64 characters.

Each preset contains `id`, `name` and `settings`. All settings fields are required:

| Setting | Values |
|---|---|
| `mode` | `crf` or `bitrate` |
| `codec` | `h264` or `h265` |
| `crf` | Integer 0–51 |
| `bitrateMbps` | Finite number 0.5–100 |
| `encoderPreset` | Existing ultrafast through veryslow choices |
| `audioKbps` | 96, 128, 192, 256, 320 |
| `resCap` | 0, 480, 720, 1080, 1440, 2160; longest-side cap, never upscales |
| `fps` | 0, 24, 25, 30, 50, 60; zero keeps project frame rate |

Package limits: 2 MiB compressed, 512 KiB decompressed tar, 256 KiB manifest, 64 KiB executable entry, 64 KiB panel HTML/JS each, 32 KiB panel CSS, 1,000 installed versions. The parser checks entries in memory and never extracts archive paths. Links, extra or duplicate entries, absolute/traversal entry paths and malformed data are rejected. Folder snapshots reject links and undeclared files. Command fingerprints include manifest and code bytes; panel fingerprints include every declared asset. Existing package fingerprints remain compatible. Installed manifests are revalidated and fingerprint checked when read.

## Export settings and persistence

Selecting a preset writes `exportSettings.preset = "custom"` and copies its settings to `exportSettings.custom`. Optional `exportSettings.pluginPreset` records `{pluginId, contributionId, version, digest, name}` for display/provenance. The snapshot is the encoder's authority, regardless of installed versions. This additive metadata survives project serialization; older versions can consume the custom settings.

The quality menu displays installed contributions with their plugin name. A missing preset is represented by its saved name and a saved-settings label. Built-in presets retain their IDs and behavior. Editing custom fields, changing resolution, or selecting a built-in preset detaches provenance. Removal, disablement and updates never rewrite projects.

## Management and author workflow

Plugin authors should start with the [public SDK and authoring tools](../../packages/plugin-sdk/README.md).
Source projects compile to a fixed installable `dist` folder. The package helper
below remains compatible for existing hand-authored payloads.


Settings → Plugins provides package installation, optional developer folder loading, installed-version selection, enable/disable, explicit removal, fingerprint and compatibility diagnostics. Removal requires an inline confirmation and preserves project settings. Installation activates the new version; switching versions is explicit. New bytes under an already installed version are rejected. Identical reinstallation is idempotent.

`npm run dev` automatically installs and enables every valid example folder under `examples/plugins/` before plugin inventory or presets are returned. Packaged applications never bootstrap examples. Each startup re-enables the examples; identical snapshots are idempotent, and changed content still requires a version bump. New example folders are discovered on dev startup (restart the dev app after adding a folder). Invalid examples are logged individually and do not prevent other examples from loading.

Start with `examples/plugins/review-copy/plugin.json`. From the repository root:

```sh
node scripts/plugin-package.cjs validate examples/plugins/review-copy
node scripts/plugin-package.cjs pack examples/plugins/review-copy /tmp/review-copy.clipcraft-plugin.tgz
```

The pack helper refuses overwriting an output. Install the result through Settings or enable Developer mode and select the source folder. The original example adds a 720p H.264/AAC review preset with CRF 23, fast encoding, 128 kbps audio and project frame rate. The longest-side cap is 720; a landscape 16:9 input resolves to 720×406 due to even-dimension rounding.

## Declarative effects (Stage 2a)

`examples/plugins/color-pulse/plugin.json` is an original effect-only example. It appears under **Effects → Plugins** in dev. With a picture clip selected, click to attach; otherwise it creates an independent Effects-track object. Select the effect's timeline object to edit its parameters, strength and region. “Effect enabled” explicitly bypasses an instance without discarding its settings.

Each effect declares `id`, `name`, `expression`, and optional `parameters`. A numeric parameter declares `id`, `name`, `min`, `max`, `step`, `default`. IDs use the same local-ID rules as presets. At most eight parameters are accepted. Bounds/defaults/step must be finite with magnitude at most 1,000,000; minimum must be below maximum, step must be positive and no larger than the range, default must be within bounds. Saved values outside the declared range or unknown parameter keys block export.

Expressions use the shared ClipCraft parser (`shared/effectExpression.mjs`; the old renderer entrypoint re-exports it). Reference a declared parameter as `{{amount}}`. Only host-validated numeric literals are substituted; parameters cannot select registers. Expressions support existing source/channel sampling, math, dimensions and local time. Transition inputs `A`, `B` and progress `P` are rejected. The current limits are 4,096 source characters, 1,024 lexical tokens, 32 nesting/AST depth, 512 AST nodes and 16 sample calls. Registers must be literal indices 0–8; register 9 belongs to host strength/region masking. Infinite/oversized literals, unknown functions, arbitrary JavaScript, GLSL and undeclared parameters are rejected. Expressions have no loop or import facility. Limits constrain compilation/work, but do not promise immunity from GPU-driver failures.

An effect ID is `plugin:<plugin-id>/<local-id>@<sha256>`. Clip-attached instances persist in `clip.pluginEffects[effectId]`; independent Effects-track instances use `clip.pluginEffect`. Both store `{pluginId, contributionId, version, digest, name, params, disabled?}`. Projects carry no executable/rendering definitions. Normal reducer insertion pins the dependency and defaults, so Undo/Redo, duplication, copying attributes and project persistence use the same state model. Both preview and export get expressions through the same registry/pass builder. Export cache identity contains the saved fingerprint/parameters and the resulting expression.

The main process revalidates retained versions from disk. A narrow `pluginEffects` preload call exposes read-only definitions only to the editor; authenticated hidden-frame jobs receive the same definitions for covers and agent inspection. Installation, enable/disable and removal notify the renderer to refresh its registry and library. Exports refresh again and validate dependencies before rendering; failures propagate as export errors rather than silently omitting an effect.

Missing, changed, globally disabled or invalid dependencies preserve project settings and show an inspector warning. Export is blocked until the required version is restored, the instance is explicitly bypassed, or **Upgrade to installed version** is selected. Upgrades preserve compatible parameter values (clamped to new bounds), defaults for new parameters, strength and regions; they are Undoable and keep the effect selected. There is no automatic substitution by the preferred version. Retained versions support old projects even when a newer package is preferred.

## Declarative transitions (Stage 2b)

`examples/plugins/diagonal-reveal/plugin.json` provides an original **Diagonal reveal** example with Tilt and Edge softness controls. In dev it loads automatically and appears in the **Plugins** group of the Transitions library. Select a main-track clip after the first clip, then click the tile (or drag it onto a junction). Select its timeline marker to adjust parameters, duration and easing, remove it or apply it to all valid junctions.

A transition declares the same `id`, `name`, `expression` and optional numeric `parameters` as an effect, plus optional default `duration` (0.05–5 seconds, default 0.5). The actual overlap remains clamped by the editor to half of each neighboring clip, including short clips. Expressions use `A(x,y)` and `B(x,y)` for the outgoing/incoming styled frames and `P` for normalized progress; source-only samplers (`S`, `L`, `PR`, `PG`, `PB`) and local time `T` are rejected. The same expression budgets, numeric placeholders and literal-register restrictions apply. ClipCraft guards endpoints in the expression and GPU renderer, so P=0 and P=1 reproduce their input frames even if the author's formula does not.

Transition IDs use `plugin-transition:<plugin-id>/<local-id>@<sha256>`, separate from effect IDs. The instance lives in the existing `clip.transition` object; its `pluginTransition` field stores `{pluginId, contributionId, version, digest, name, params, disabled?}`. Normal updates and timeline-retiming operations both pin metadata. Easing, duration, apply-to-all, duplication and Undo preserve it. Projects carry no transition source. Retained package versions remain available for old projects while the plugin is enabled, and **Upgrade transition to installed version** is explicit and Undoable, preserving timing/easing and compatible parameters.

Preview, thumbnails, hidden composition and the export effects pass resolve the same definition. Inputs use the existing styled-frame path, including transforms, opacity, crop, keying and masks. Export cache identity includes the clips, transition fingerprint, parameters and timing. The native encoder rejects an unbaked plugin transition rather than passing its ID as an FFmpeg transition name. No raw filter arguments are accepted.

A missing or invalid exact version preserves its marker and instance data. The marker is visibly flagged and the inspector explains the problem; export is blocked until the required version is restored, explicitly upgraded, removed, or bypassed. Switching **Plugin transition enabled** off explicitly uses a host crossfade over the same overlap (and retained easing). It preserves downstream timing and is labeled in the inspector; no missing dependency is silently replaced during export. Removing the transition remains a distinct action that follows existing timeline semantics.

The Stage-2b real-app gate includes native inspector edits, persistence, exact GPU endpoints, intermediate preview/export comparisons on plain and transformed/cropped/keyed inputs, retained versions/upgrades, missing markers, crossfade bypass, short overlaps, hidden composition and injected uncached render failure. The injection tests the failure path; it is not a claim of testing every GPU driver.

## Future contracts

**Commands (Stage 3a):** implemented through the [SDK and security contract](plugin-commands.md). Settings → Plugins provides native inputs, Run, progress, cancellation, attributed responses and actual applied marker counts. Each run requires fresh host confirmation, reads only a bounded project summary, stages marker proposals and commits through a stale-state-guarded reducer action as one Undo step. Custom protocol origins, per-run sessions, a Worker, narrow authenticated IPC, a privileged-IPC backstop and a main-process watchdog enforce the boundary. Installation/dev startup never executes code or grants permissions. File-origin runtimes are deliberately excluded after an adversarial import test exposed that gap.

**CraftAI plugin tools (Stage 3c):** enabled commands are discoverable with a paginated core tool and executable through the plugins group, using exact installed keys, declared numeric inputs, fresh native approval and the existing sandbox. The agent runner validates edits, tracks activity and completion, and groups them into its Undo transaction. Permission denial stops further plugin execution for that request. External MCP clients and analysis subagents cannot discover or run these commands. See the [agent contract](plugin-commands.md#stage-3c-craftai-command-tools).

**AI workflows (first Stage 3b slice):** [AI chapter markers](plugin-ai-workflows.md) uses only existing timeline captions, a captured configured provider/model and bounded host-owned requests. Caption text sharing requires native consent; all proposed markers require a separate host review before the normal guarded commit. Model credentials stay private, direct plugin networking remains blocked, and cancellation aborts the request. The [caption translation slice](plugin-caption-translation.md) adds enum parameters, selected-track sharing, side-by-side host review and a new hidden caption track with preserved cue timing and one-step Undo. Originals remain intact; broader model/media services and editing operations remain future slices.

**Providers/exports:** adapt existing agent contracts and supported protocols first. Host-owned rendering jobs control output paths, overwrite protection, cancellation and actual results; destination upload requires separate network/media permission.

**Panels/local tools:** isolate custom UI from editor DOM and global CSS; provide semantic tokens and keyboard/focus rules. Local models and tools use host-approved adapters, separate permissions, explicit downloads and platform checks. No arbitrary shell or automatic plugin-supplied executables. Native process isolation requires a separate design review before shipping.

Public API 1 is deliberately small. Additive supported contributions are documented with their required ClipCraft version; incompatible runtime or manifest changes need a new API version. Inter-plugin dependencies, marketplace feeds, verified publishers, signatures and automatic updates are outside Stage 1.


**AI providers (Stage 4b first slice):** packages declare endpoints and models as data. Settings displays enabled versions and requests separate native destination consent before setup. Identity, credentials and preferences are pinned to exact package fingerprints. The host routes Chat Completions and tools, blocks redirects and automatic fallback, enforces vision declarations and aborts revoked/tampered requests. The original local example is loaded in dev without network activity; its Ollama service/model must be installed separately. See [the provider contract](plugin-ai-providers.md).


**Custom panels (Stage 5a first slice):** the top-bar Plugin panels control opens a dock in Edit or Agent mode. Packages supply their own bounded HTML/CSS/JS. The host owns permission approval, identity chrome, theme tokens, size, focus return, modal masking and lifetime. Each open uses a separate sandboxed WebContentsView and temporary session. The first SDK reads only an approved project summary and receives summary/theme events. Project replacement, plugin management actions, crashes, tampering, request abuse and a stuck-renderer watchdog close the panel without changing the project. The Project dashboard example is available in dev without executing at startup. See [the author contract](plugin-panels.md).
