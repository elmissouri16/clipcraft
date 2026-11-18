# Trusted extension shortcuts

Extensions use the same keymap and Shortcuts settings as core editor commands.
Declare shortcuts without executing Node code:

```json
{
  "main": "dist/extension.cjs",
  "contributes": {
    "commands": [{"id": "open", "name": "Open workspace"}],
    "shortcuts": [{
      "id": "open-key", "name": "Open workspace", "command": "open",
      "keys": ["Ctrl+Shift+U"], "scope": "editor"
    }]
  }
}
```

The shortcut references a local declared command. Its global settings ID is
`extension:<extension-id>.<shortcut-id>`. Metadata is visible before trust, but
untrusted, disabled or explicitly stopped packages never own keys. A trusted
declaration can lazily activate its package, including after a cold restart.
The host waits for activation and rechecks the live binding before executing.
Package trust is reused; there is no per-key approval.

Runtime contributions use the same shape with `title` instead of `name`:

```ts
await context.commands.register('open', () => view.reveal());
const binding = await context.ui.registerShortcut({
  id: 'open-key', title: 'Open workspace', command: 'open',
  keys: ['Ctrl+Shift+U'], scope: 'editor'
});
await binding.dispose();
```

A runtime registration with the same local ID replaces the declaration's active
metadata. Disposing it restores the declaration, if present. Runtime-only rows
disappear on disposal or stop; their user overrides remain saved. Runtime
bindings become available after activation completes. Each package may declare
64 shortcuts and register 64 runtime shortcuts; the combined application catalog
is bounded to 1,024 rows.

`scope: 'editor'` is the default and requires an open project. `scope: 'app'`
also works on Home. Both are suppressed in text inputs, textareas, select controls,
editable content and modal/settings/menu controls. Key repeats and IME composition
do not execute extension commands. Focused sandboxed views forward only configured
keys through their authenticated host bridge; their text fields, including shadow
DOM fields, retain typing behavior. Remapping refreshes open views immediately.

Use up to four distinct single-stroke key combinations, each up to 40 characters.
Modifiers are ordered `Ctrl`, `Alt`, `Shift`; letters are uppercase and named keys
use browser names (`Escape`, `ArrowLeft`, `Space`). `Ctrl++` represents the plus key.
On macOS, Command also maps to `Ctrl`. Bare modifiers, alias spellings and ordinary
Tab/Shift+Tab focus navigation cannot be bindings. OS-reserved combinations may be
handled before they reach the application. Multi-stroke chords and a textual
condition language are not part of this contract.

Core defaults win conflicts with extension defaults. Extension defaults use stable
extension-ID order. Explicit user remaps win over defaults, and recording a used
key in Settings moves it from its previous action with feedback. Unavailable
extensions do not reserve keys. Settings groups extension rows by their human
name and explains inactive bindings or a default already in use.

Edits save through the existing settings service, with writes serialized and
authoritative values read back. Per-action reset restores the currently available
defaults for that action; it does not restore another action that previously lost
a key. Reset all clears every saved override, including absent extensions. Normal
edits preserve overrides for disabled, stopped, removed or temporarily absent
extensions. At most 4,096 override rows are stored; saving more rejects without
overwriting the settings file. The optional workbench example demonstrates both
declarations and runtime registration.
