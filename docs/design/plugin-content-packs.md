# Creative content extensions

A single extension can contribute sounds/music, font families, text/caption
styles, LUTs, color looks, motion presets, effects and transitions. Pure packs
have no executable entry or permissions. The [SDK guide](../../packages/plugin-sdk/README.md#creative-content-packs)
contains complete schemas, types, formats, limits, author templates and UI workflows.

Pack assets are declared regular files in flat `assets/` paths. The reader bounds
compressed/uncompressed bytes, rejects links and undeclared paths, validates
WAV/MP3/OGG, WOFF2/TTF/OTF and cube structure and fingerprints all bytes. Legacy
packages retain their original fingerprints. Archives are parsed without path
extraction; install, rollback, removal and inventory recovery use validated snapshots.
Native audio probing is bounded and rejects non-audio streams; MP3 album art is
metadata. The browser still performs actual font/audio decoding.

Sounds join Audio → Library. Preview/Add verify the exact package and create a
durable copy outside removable payloads; normal media probing, credits and
Undoable timeline insertion apply. Copies remain after removal; automatic cache
cleanup is separate work.

Fonts use existing list/data services in the editor, frame inspection and GIF
renderers. Families are host-scoped. Preferred versions are offered for new
choices; retained exact versions serve existing projects while their extension
is enabled. Request generations prevent late catalog/decoder completions from
resurrecting revoked faces. Missing/undecodable fonts warn in preview and block
strict export without rewriting the saved font ID.

Text/caption packs expose existing typography, effects and text animations. Their
style snapshots contain no words or timing. New title insertion and caption
styling use the existing reducer/Undo paths. Same-package font references become
exact digest references. The copied appearance remains in the project; its font
assets may still be required.

Color packs combine existing filter, adjust, grade, HSL and curve controls.
Separate filter and grade LUT stages can reference bundled cube assets. LUTs
retain exact package identities, invalidate cached bytes on management changes
and are checked again before MP4/GIF export. Ordinary imported LUTs preserve
existing behavior. Preset values are copied and LUT assets stay required.

Motion packs contain existing animation IDs, optional base pose/opacity and
bounded normalized source-time curves. Replace motion clears the old motion
controls atomically, preserves unrelated curves and supports Undo. Copying the
values leaves no runtime dependency on the original motion pack.

Settings → Plugins includes a native **Create a creative pack** form. It captures
appearance snapshots from the current project and saved looks, accepts files
through native pickers, supports font-face grouping and file bindings, and
preserves source pack font/LUT licenses. It uses opaque draft tokens, bounded
immutable buffers and the same canonical package validator as the SDK. Publishing
a new archive is exclusive and atomic; completed files survive source removal.
Installation is a separate explicit action. No JSON editing, uploads or install
scripts are involved. System font references require availability unless the
author picks a font file to include. Effect/transition expression creation remains
an SDK workflow.

**Project packs** is a project-specific dependency view. Required exact versions
are separate from copied preset provenance and independent sound copies. Exact
reinstall refuses a different archive before inventory mutation. Explicit typed
font/LUT/effect/transition replacements become one ordinary all-use Undo step,
respect locked clips and preserve caption text/timing and transition timing.
Matching numeric parameters stay within replacement ranges. No auto-rebinding or
silent downloads are performed; malformed references remain visible for repair.

Private authoring and project-recovery IPCs are available only to the editor's
main frame and remain blocked from plugin command/panel senders. Developer
package scripts and raw reducer patches are not introduced.

Verification uses generated audio and local private decoder fonts in temporary
profiles; no binary fixture is committed. `test-plugin-content-packs-ui.cjs`
exercises the combined native workflow and restart. Separate format, text, color,
motion, project-dependency and builder suites cover negative boundaries. Selected
macOS development checks do not certify Windows/Linux, installer, native-focus,
performance or public-release gates. WOFF/TTC, other creative asset kinds,
marketplace/distribution and cleanup of adopted media copies remain separate work.
Reviewed disposable sound-preview cleanup, pack search/favorites and measured
sample previews are documented in [the usability guide](plugin-usability-expansion.md).
