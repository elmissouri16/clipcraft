# Remaining pre-v1 capabilities

> Historical plan for the retired executable recipes. The capability work was
> subsequently implemented and migrated to the [general Node host](plugin-extension-host.md).
> The recipe-specific declarations and restrictions below are not the current
> SDK. Use [Node development sessions](plugin-extension-development.md),
> [managed jobs/files](plugin-extension-jobs-files.md) and the
> [Node examples](../../examples/extensions/README.md). Current unfinished work
> is tracked in the [roadmap](plugin-roadmap.md#current-pre-v1-scope) and release
> evidence; this historical checklist does not reopen retired extension types.

Versions stay SDK 0.8.0, host API 1 and app 2.0.0. This work does not authorize
publication, installer builds, arbitrary executable downloads or plugin shell access.

## Temporary service authoring

- Accept validated provider and export-preset contributions in development sessions.
- Test only the captured generation; reload, end, cancellation and editor loss revoke work.
- Provider tests use the declared OpenAI-compatible endpoint/model, fresh native
  consent, an explicitly entered transient key and bounded text. No credential,
  provider registry, inventory or project preference is persisted.
- Export tests render a bounded section of the current project using a detached
  settings snapshot and a native destination. Recheck generation at publication.
  Preserve the current project, history and saved export settings.
- Verify real HTTP fixtures, real rendering/encoding, cancellation, generation
  changes, refusal, response limits and isolation in contract and Electron tests.

## Managed local tools and models

- Declare curated local adapters and models in the manifest and public SDK;
  plugins cannot provide executable URLs, paths, shell commands or raw arguments.
- Host UI exposes platform/tool availability and explicit model setup/removal.
  Downloads require separate consent, pinned hashes, bounded size/time, cancellation,
  atomic publication and partial-file cleanup. Installation never executes a plugin.
- Execute useful fixed host recipes through a permissioned SDK capability, with
  bounded input/output, progress, cancellation and revocation. Keep paths and
  model/tool ownership in the host. Review any resulting document changes and
  retain atomic Undo and stale-project guards.
- Cover supported-platform decisions, invalid manifests, download integrity and
  failure cleanup, execution limits and lifecycle races. Verify actual native
  tool/model execution in Electron; mocks alone do not prove completion.

Both sections require implementation and retained evidence before their roadmap
checkboxes can be checked. Cross-platform/ASAR, the full regression battery,
accessibility and performance release gates remain separate.
