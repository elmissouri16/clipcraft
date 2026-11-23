# Plugin inventory and recovery

## Components and ownership

The Electron plugin manager validates packages and stores immutable payloads
under the app's user-data `plugins` directory. The inventory records the enabled
and retained versions. The renderer presents host-validated contributions. The
Node host owns activation, and the editor applies validated project edits with
Undo. Authored HTML views communicate with their activation through the view
message bridge. [Manifest validator](../../shared/pluginManifest.mjs) ·
[Node host](../design/plugin-extension-host.md) · [Views](../design/plugin-extension-views.md)

An interrupted removal appears as **Removal pending**. **Retry removal**
resumes cleanup for that fingerprint. A damaged inventory has a separate
recovery workflow.

### Inventory recovery

If an inventory is damaged, missing alongside managed package files, unreadable,
or not a regular file, normal discovery and mutations fail closed. Settings still
loads its built-in providers and offers **Settings → Plugins → Review recovery**.
No repair, deletion or activation happens automatically at startup. A fresh empty
plugin folder is allowed without an inventory; saved panel preferences alone are
not treated as an interrupted installation.

1. Review the inventory/backup state, package identities and validation results.
   Packages are checked with the normal manifest, assets, compatibility and exact
   fingerprint validators; this never executes plugin code. Review also identifies
   known pending removals, missing/invalid packages and managed staging artifacts.
   Cancel leaves the inventory and all payloads untouched. A changed package or
   inventory invalidates the review; reviews expire after five minutes and are
   single use.
2. Choose **Recover disabled versions**. Original readable inventory/backup bytes
   are preserved under `plugins/.recovery/<archive-id>/`, together with a recovery
   record, before index replacement. Validated versions and known missing/invalid
   references are reconstructed with `{key, enabled: false, recovered: true}`.
   Known pending removals retain `removing: true`. An older backup is consulted
   only if the current index is damaged/missing; a healthy current index remains
   authoritative. Ordinary successful mutations retain the previous good index
   in `inventory.backup.json`; it is never automatically restored as active state.
3. Reviewed invalid fingerprint folders and recognized `.install-XXXXXX` and
   `inventory-<uuid>.tmp` leftovers are moved whole into the archive. Uncommitted
   staging is never installed. Unknown root files, unsafe/symlink entries, saved
   panel preferences, provider Settings and projects stay in place. Unavailable
   package references remain visible; recovery never erases a project's exact
   dependencies or Undo history. **Show recovery archive** opens the host-validated
   archive directory. Archives are retained, with no automatic deletion policy.
4. Explicitly enable or reinstall each desired validated version, or retry a
   pending removal. The `recovered` marker overrides activation and retained
   rendering until that exact version is explicitly enabled/reinstalled; enabling
   a different version does not make it available. The development example
   bootstrap also respects this marker. Third-party Node extensions still require trust for their exact package fingerprint.

If preserving bytes or publishing the rebuilt index fails, stop and review again
after resolving the displayed access/space error. Before publication the old
inventory remains; after publication the new index remains disabled even if a
later backup write or artifact move fails. Remaining managed leftovers are offered
on the next explicit review. Recovery does not follow unsafe inventory/archive
paths or overwrite unreadable/oversized inventory files: restore regular readable
files and folder access first. Inventory reads are bounded to 1 MiB, the root scan
to 4,096 entries, and the recovered index to 1,000 versions. If both indexes lost
removal intent, recovery cannot infer that intent from a valid package directory;
it stays disabled pending an explicit user decision. Corrupt panel preferences
are preserved, with **Clear saved data** remaining a separate confirmed action.

Failed renderer catalog refresh clears stale effects/transitions. Missing
dependency errors direct users to Settings and inventory recovery; they block
export until the required version is available or the existing explicit
upgrade/bypass controls resolve the dependency. No substitute version is selected
by inventory recovery.
