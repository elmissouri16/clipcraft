# Application services and atomic caption tracks

General Node extensions use the same `services.list/call` API for application
services and other extension services. Application entries have `host:true`,
`extensionId:'clipcraft'` and a reserved `clipcraft.*` ID. Only main-process code
registers those implementations. Extensions cannot replace them or forge their
owner metadata. The current application methods are unary; extension-to-extension
streams retain their existing separate implementation and limits.

## Host call lifecycle

Inputs/results use the shared 1 MiB plain finite data/byte copier. Calls reject
unknown methods, inherited prototype methods, duplicate registrations and stale
owners. Sixteen calls per activation and 64 overall are allowed. Their deadline
is bounded to one second through five minutes. Waiting pauses the actual invoking
callback chain, while each service and any enclosing job keeps its own deadline.

Cancellation and stop revoke the native signal and pending reply even if an
implementation ignores abort. Native implementations must respect their signal
and call their verification guard before side effects; a canceled reply cannot
undo an external effect already sent. Generation, callback, job and Save/export
draft authority are checked before and after dispatch. Temporary plugin management
stops calls but preserves application registrations for the next activation.

## Selected AI connection

`services.call('clipcraft.ai','describe',{})` returns
`{connection,providerName,model,location}`. It reads the selected Assistant account
without exposing a key, native executable path or credential-bearing URL. An
ordinary selected AI service is discovered lazily after restart, without opening
Settings. Use it from a running extension; activation has not yet become running.

The opaque connection proof belongs to the consumer's activation and current
native routing/account state, and expires after five minutes. For a selected Node
service, it also binds its generation and native settings revision. A native
settings edit invalidates review immediately, before its value is saved; discovery
refuses while settings saves are in flight and asks the caller to wait. This does not sandbox an author's own
Node transport or promise that an external service cannot redirect its requests.

`services.call('clipcraft.ai','complete',input)` accepts only:

- `connection`: the reviewed proof from describe.
- `system?`: plain text up to 64000 characters.
- `messages`: 1–200 `{role:'user'|'assistant',content:string}` messages, with system
  plus message text bounded to 256000 characters and the overall transport limit.
- `maxTokens?`: 1–32768, default 4096; `timeoutMs?`: 1000–300000, default 60000.

It returns `{text,providerName,model}` within the result budget. Credentials remain
in core; callers cannot supply routing, credentials, tools or web settings. Core
disables research, subagents, endpoint fallback and custom thinking for this text
request. There is no automatic provider fallback. Connection changes or expiry
fail explicitly. Pending account/native-settings changes, consumer stop and
cancellation revoke the reply and signal. Recursive requests from a selected AI
service to itself are refused. The backend deadline is enforced even if a native
implementation ignores its signal; billing/output quotas remain backend behavior.

Node trust authorizes use of this service; the examples explicitly request text
sharing review before calling it. The source extensions own their prompts,
parsers and review UI. No `context.ai`, chapter/translation protocol or AI-provider
extension kind is added. Ordinary AI services can still implement their own
transport through the separate `ai.engines` application integration.

## Caption track creation

`captions.write` additionally supports:

```ts
await context.captions.write({
  documentId, revision, projectRevision,
  mode: 'create-track',
  newTrack: {name: 'Captions · French', hidden: true, language: 'fr'},
  cues: [{text: 'Bonjour', start_sec: 0, end_sec: 1.2}]
});
```

The result includes `written` and the new canonical `trackId`. Creation requires
nonempty cues and an available appended Text layer below the existing 128-layer
limit. A reserved locked/hidden slot is refused. It adds clips, name and initial
visibility in one guarded reducer edit and one Undo step, leaving existing clips,
names, word timing and toggles intact. Undo removes the appended layer's state;
Redo restores its initial state without reverting later toggles on old tracks.

Names are nonempty plain strings up to 160 characters. `hidden` defaults false;
an optional language has a 2–3 letter root with 2–8 character alphanumeric subtags,
at most 35 characters overall. The normal caption bounds remain 10000 cues,
4000 characters per cue and 256000 total. Creation cannot also choose an existing
`trackId`; `newTrack` is rejected for append/replace.

All caption writes require a current editor revision. An optional `projectRevision`
adds content-only consistency from workspace inspection, so a long-running review
cannot adopt a changed project by taking a fresh editor revision at the end.
Caption reads and existing-track writes resolve canonical Text IDs against the
actual project, including tracks outside the bounded editor summary. The complete
inspection API provides those IDs. Save/export drafts support the same operations.

## Views and lifecycle

An explicit view reveal brings its workbench forward and closes Settings; merely
opening Settings still obscures all native views. Caption review uses a compact
fixed header/actions and a separately scrolling comparison with plain text only.
Disposing registrations/listeners removes their SDK shutdown references. Completed
managed processes release theirs too, so repeated reviews/processes do not retain
stale callback closures until stop. Stop drains a stable snapshot of remaining
disposables so disposal cannot skip the next registration.

All eleven executable example sources now have ordinary Node replacements under
`examples/extensions`. CraftAI can discover/run their declared commands through
the [ordinary command bridge](plugin-extension-agent-commands.md). Legacy SDK/runtime retirement preserves creative pin compatibility. Release
reconciliation, complete packaged-app validation, full regression and Windows/Linux
checks remain open; see [retirement rules](plugin-legacy-retirement.md). No app, SDK, host API or example version is bumped.
