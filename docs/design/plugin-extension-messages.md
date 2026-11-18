# Trusted extension messages

`context.ui.showMessage` presents a host-rendered message on Home or in the editor,
including when Settings is open. Every card identifies its extension. Text is
rendered literally; an extension cannot provide HTML, host controls or scripts.
Messages do not take keyboard focus or block editing.

```ts
const selected = await context.ui.showMessage({
  kind: 'info',
  message: 'The new sound files are ready.',
  detail: 'Choose whether to open your extension workspace.',
  actions: [{id: 'open', title: 'Open workspace'}],
  timeoutMs: 120000
}, {signal});
if (selected === 'open') await view.reveal();
```

The promise returns the selected action ID. Close, Escape inside a card, expiry,
an aborted signal, a stopped activation, application navigation or loss of the
host renderer dismisses the message and returns `undefined`. The surrounding
command/service can still reject if its own lifetime ends first. Messages are
not restored after a restart. Awaiting a message during activation retains the
normal activation deadline; register commands and show interactive messages from
those commands instead.

Use `info` (default), `warning` or `error`. The message is nonempty single-line
text up to 500 characters. Optional detail is up to 2,000 characters. At most three
distinct actions are allowed, with nonempty IDs and labels up to 80 characters.
Controls and DEL are rejected; visual wrapping is automatic. The default timeout
is two minutes, configurable from one second to four minutes.

An activation may have three pending messages and create 30 per minute. The
application allows twelve pending messages across extensions and shows the first
three, with a waiting count for the rest. Overflow rejects before rendering.
Queue time counts toward expiry. Clicking an action validates its exact ID and
owning window; IDs from a closed message cannot target another activation.

Cards use existing app colors, spacing, icons and controls. Focus is retained
when messages appear and returned to another card or the prior control when a
focused card disappears. An overlapping native extension view hides until the
message closes so it cannot cover host controls. The optional workbench example
includes a command that demonstrates a message and opens its session-notes view
only when the user selects that action.
