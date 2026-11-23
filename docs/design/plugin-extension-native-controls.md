# Native actions and bound clip properties

These are pre-alpha trusted Node host APIs. They use the existing native editor
surfaces; registering a control does not open an extension view or execute code
while the inspector renders. Application and SDK versions remain unchanged.

## Actions

```ts
const reset = await context.ui.registerAction({
  id: 'reset', title: 'Reset opacity', location: 'toolbar', command: 'reset',
  order: 20, enabled: false, disabledReason: 'Select a picture clip',
  icon: {paths: ['M4 12 L10 18 L20 6']},
});
await reset.update({enabled: true, disabledReason: ''});
await reset.update({title: 'Reset selected picture', order: 5});
await reset.dispose();
```

Actions support toolbar, inspector, clip context, export, plugin settings and
voice settings locations. Lower `order` appears first; equal orders retain
registration order. The default order is 100. Ordering is bounded to ±10000.
The toolbar keeps two direct actions and places the rest in its native overflow.
`update` can change title, enabled state, disabled reason, order and icon; the
ID, location and command stay attached to that registration. Undefined patch
fields leave existing values unchanged.

An icon consists of one to eight SVG path-data strings, each at most 512
characters, in a fixed 24 by 24 view box. The host owns the SVG element and
attributes. Stroke uses the native text colour; optional `fill` is `none` or
`currentColor`. Markup, URLs and arbitrary attributes are refused. `icon: null`
clears custom artwork. No image download or binary asset is required.

A disabled action remains visible with its reason as a tooltip. The native host
also rejects direct bridge invocations while disabled. Changing availability
does not cancel an invocation already dispatched. The registration is owned by
its exact activation and registration instance; disposal, Stop and package
disable remove it. An old handle cannot update a replacement with the same ID,
and a pending click from an older rendered registration cannot invoke it.

## Property groups

```ts
await context.ui.registerInspector({
  id: 'picture', title: 'Picture properties', lanes: ['video', 'overlay'],
  fields: [
    {key: 'opacity', label: 'Opacity', property: 'opacity', type: 'range'},
    {key: 'scale', label: 'Scale', property: 'transform.scale'},
    {key: 'rotation', label: 'Rotation', property: 'transform.rot'},
  ],
});
```

A group contains 1–32 native fields; an extension may register eight groups.
Groups share action ordering and appear in the clip inspector. `lanes` can
restrict video, overlay, audio, text or Effects-track targets; otherwise applicable fields
appear for the selected primary clip. Other selected clips are not implicitly
edited. Empty/inapplicable groups and gap targets do not render.

Controls read the actual clip and resolved text defaults on every project
update. They do not save a second copy in extension configuration. Manual
changes, Undo, Redo and project loading therefore update them automatically.
Unsupported stored enum values are displayed honestly rather than showing a
different option. Sound fields only appear for sound-capable media.

Supported property families use the canonical typed clip edit operations:

- `opacity` for picture/text clips.
- `transform.scale`, `scaleX`, `scaleY`, `uniform`, `x`, `y`, `rot` for pictures.
- `audio.volume`, `muted`, `fadeIn_sec`, `fadeOut_sec` for sound-capable media.
- `text.content` and `text.style.*`: font, size, bold/italic/underline/uppercase,
  colour, alignment, tracking, line spacing, width, placement, rotation,
  opacity and nested stroke, shadow and background values.
- `speed` for video/audio sources: preserves timeline duration, adjusts the
  source window and validates complete linked pairs and actual media bounds.
- `curve.scale`, `x`, `y`, `rot`, `opacity` for pictures and `curve.volume` for
  sound-capable media: edits up to 64 source-time points through the canonical
  automation transaction. Point controls expose time, value and easing; volume
  supports linear interpolation. Apply replaces that curve in one Undo step;
  Clear stages an explicit removal, and Cancel discards the local draft.
- `effect.enabled`, `effect.strength`, `effect.parameter`: binds either
  `effect: {id: exactEffectId}` or `effect: {index: 0}` for an attached slot.
  Use `{index: null}` for a selected Effects-track resource. Parameter fields
  also require `parameter: 'parameter-id'` in the selector. Inapplicable fields
  do not render. Exact-ID selectors follow their resource across slot changes;
  numeric selectors explicitly follow the current slot. Parameter bounds and
  default step come from its exact installed definition. Numeric field bounds
  may narrow them, and an explicit `step` overrides the package step.

`NativeInspectorProperty` enumerates every supported binding. Text font choices
use the existing bounded property contract. A static field cannot erase an
existing curve; use the explicit curve editor. Raising effect strength from
zero enables the effect. Re-enabling a zero-strength attached slot restores
strength to one. Other parameters and effect slots remain unchanged.

```ts
await context.ui.registerInspector({
  id: 'motion', title: 'Motion', lanes: ['video', 'overlay'], fields: [
    {key: 'curve', label: 'Opacity curve', property: 'curve.opacity'},
    {key: 'strength', label: 'First effect strength', property: 'effect.strength',
      effect: {index: 0}, type: 'range'},
    {key: 'gain', label: 'Gain', property: 'effect.parameter',
      effect: {index: 0, parameter: 'gain'}},
  ],
});
```

[Custom timeline types](plugin-custom-timeline.md) also receive native typed
property forms directly from their declared schemas.

Types are inferred from the property: number, boolean, select, string or colour.
Numbers can opt into `type: 'range'`. A field may narrow the property's min/max,
set a positive step, supply labels for supported select options, provide a
description, or declare `readOnly: true`. Incompatible types, out-of-bounds
ranges, invalid options and unsupported property paths reject at registration.
Writes validate finite values, steps, choices, text and hex colours again in
the host. `text.content` defaults to `measuredWords: 'reject'`; a contribution
must explicitly choose `invalidate` to change measured caption wording. Fade
controls explicitly replace the named source fade edge using the existing
`replace-edges` operation.

Text controls support multiple lines. Blur commits a draft; Enter commits a
number, and Ctrl/Command+Enter commits text. Escape discards it. Selects and
toggles commit directly; a range drag commits on release (keyboard changes on
key release). Each changed commit is one normal Undo step; unchanged values
produce no history entry.

## Ownership and stale writes

Typing captures the document, primary selection and load lifetime. A document
or selection change discards its draft. A native write checks that anchor again
after asynchronous work and immediately before the reducer publishes the edit.
Scrubbing and playback alone do not invalidate the document target.

Writes pass through the canonical transaction validator and private preparation,
including actual track locks, complete linked-pair membership, source alignment,
pins, dependencies and curve restrictions. Locked targets and linked partners
also disable their controls. A linked property edit validates the whole pair
while changing only the selected target's requested property.

The native commit reservation carries the inspector registration's unique
instance as well as the extension generation. Removing/replacing the group or
stopping the extension revokes an unclaimed reservation. A new registration
with the same ID cannot inherit the old pending write.

Capability discovery advertises `ui.actions.state`, `ui.inspector`,
`ui.inspector.automation` and `ui.inspector.effects` revision 1.
The [native-properties example](../../examples/extensions/native-properties/README.md)
demonstrates dynamic action state and picture, sound and text property groups.

## Verification

The contract suite resolves every declared property against renderer defaults
and sends its generated operation through the canonical property validator. It
also exercises real worker action updates, disabled execution, registration
replacement, bad icons, invalid fields and read-only enforcement.

The public-SDK-built example is driven in Electron with native numeric/text
input, range/select/toggle/colour controls, Undo/Redo, manual edits, linked
locks, unsupported automation writes, selection and document lifetime changes,
registration removal during a real native reservation, disable/re-enable and
a cold restart. Timing gates delay native dispatch/reservation only; the real
validation, reducer, IPC and commit checks remain in use. A contract regression also reproduced an old action handle updating a same-ID
replacement; native instance checks now refuse both that update and a stale
rendered invocation. The first native run
exposed missing keyboard focus in the hidden test harness; setting WebContents
focus before native typing corrected the harness. Its failure is retained.

Final results and source hashes are recorded under
`plugin-validation.json.extensionNativeControls`. These checks are local macOS
development evidence, not a full application battery or installed OS matrix.

Final verification: 19 selected regression suites and 9 clean-consumer SDK suites
passed. The native workflow passed 41 checks across 2 app processes;
the contract suite exercised all 42 declared bindings. Renderer compilation,
structure/runtime dependencies and whitespace passed. Product/SDK source matches
the SDK validation snapshot; only the example-index table formatting changed
after that run. All receipts are retained in the validation ledger.

## Effect, curve and speed expansion verification

The expanded native workflow passed 46 checks plus 5 cold-restart
checks, including parameter precision from exact installed metadata, effect
enable/strength, native source-time point editing, clear/Undo, rejected source
windows, fixed-duration speed, volume automation and inherited fieldset locks.
A main-window screenshot of the curve controls was inspected.

All 15 focused regression suites and 9 SDK suites passed with an empty
SDK source-change list. Renderer, structure, localization and whitespace checks
passed. The sparse-curve regression also hardens the shared automation validator.
Receipts and the two corrected test-fixture failures are retained under
`extensionInspectorAutomation` in the validation ledger. This closes the native
binding slice. Subsequent [export formats](plugin-extension-exports.md),
[custom hooks](plugin-custom-hooks.md) and
[document lifecycle hooks](plugin-document-lifecycle-hooks.md) have their own receipts.
