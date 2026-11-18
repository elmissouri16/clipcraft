# Native clip properties

This source extension uses native controls directly. Trust it in Plugins, select
a picture, sound or text clip, and open the clip inspector. Picture opacity and
transform, sound volume/mute/fades and text content/style fields read and edit
the actual clip. Each change supports Undo. The toolbar reset action uses its
own original vector icon and follows the current picture selection and locks.

Build with the repository's public SDK and install the compiled directory or
archive, as described in the [examples index](../README.md). There is no view,
service or separate settings form. The [native control contract](../../../docs/design/plugin-extension-native-controls.md)
lists the available bindings, constraints and stale-edit behavior.

The source intentionally rejects edits to measured caption wording. An extension
that needs to change it must explicitly declare `measuredWords: 'invalidate'`.
