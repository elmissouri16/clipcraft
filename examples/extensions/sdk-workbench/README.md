# SDK workbench

Build with the public SDK, install the compiled directory/archive and explicitly
trust it in Plugins. This pre-alpha example demonstrates native label prompts,
updated status text, project/timeline menu actions and two isolated views: one
left-rail tab and one tab inside the media library. Each view keeps a local
counter while you switch tabs; Stop removes its native UI.

Stream generated audio to exercise bounded binary stdout without an external
program: it uses the editor's bundled FFmpeg. Local helper commands require an
installed Node executable and an unused loopback port, both set in native
Plugins settings. The server remains available after its command returns and is
terminated by Stop, disable, reload or application shutdown. A stopped output
subscription does not stop its process; call `kill` to stop the helper itself.

The project commands reuse native persistence and refuse stale/busy targets or
failed preservation. Closing returns to Home and preserves the project in its
file/autosave slot. Saving/opening without a supplied path uses the native picker.
The explicit Save path refuses overwriting another existing project file.
Undo acts on the latest revision. Styled captions demonstrate global and per-cue
font, colour, background, shadow and animation values on a separate track.

Each view has a native destination selector. Move a page to the right or bottom
dock, an overlay, a floating window or a modal while keeping its counter state.
The workbench picker brings external views back. The `move-view` command accepts
`{id: "rail" | "library", placement, bounds?, width?, height?}` and demonstrates
`ExtensionView.setPlacement`. Normalized bounds apply only to overlays; pixel
dimensions apply only to windows.

The manifest also contains two original GLSL fragment functions: Color circuit
and Wave reveal. The `shader` command discovers its installed effect through
`rendering.list`, validates it on the GPU, then adds it through native editor
tools. Both shaders share the normal preview/export pipeline and dependency
pinning. Effect parameters use `{{amount}}` uniforms; colors and alpha are 0–1.

The `custom-scene` command discovers its exact installed types and creates a
native visual track with a two-second Signal field shader clip in one Undo
step. Select it to edit typed properties, drag/trim it, split/duplicate it, then
save/reopen or export. The manifest also demonstrates media-backed visual/audio
types and metadata notes. See the [custom timeline contract](../../../docs/design/plugin-custom-timeline.md).

The command first runs its owned `scene-review` hook point. Its typed participant
results can approve or refuse scene creation. The optional
[scene-reviewer companion](../scene-reviewer/README.md) demonstrates a second
extension subscribing lazily, running first by `order`, and reading a native
boolean setting to return its decision. Neither example runs scene creation at
activation.

## Document lifecycle

The workbench logs `project.didCreate`, `project.didOpen` and `project.didClose`.
Each callback reads its operation's document snapshot, including the closed
document while the editor is on Home. These notifications cannot edit the
document or veto a completed transition. Inspect the extension logs in Settings
after creating, opening or closing a project.
