# Stage 3b: caption translation

The translation example adds enum command inputs and a second fixed AI operation. Users choose a target language and a source Text-track number (1 means the first Text track). Only that track's existing caption cues are shared. At most 100 nonoverlapping cues / 12,000 source characters are accepted; oversized tracks fail explicitly, without partial translation.

## SDK and bounds

Existing numeric parameter definitions retain their exact normalized shape. An additional parameter form is `{id,name,type:"enum",options:[{value,label}],default}`: 1–32 unique lowercase identifiers, plain labels, and a declared default. `commandInput` validates enum strings as strictly as numeric values. Settings uses the existing Dropdown control. CraftAI retains numeric `value` inputs and accepts enum IDs in a separate `choice` field, then validates against the discovered exact command schema.

New permissions: `captions.write` (requires `captions.read`) and `ai.translateCaptions` (requires both caption grants). This first caption-writing slice is separate from marker writing/chapter generation within a package. Translation-capable commands declare a `language` enum using supported language IDs and may declare integer `source_track` (1–128, default 1). The target language/source track are fixed before sharing approval. Credentials, provider/model/endpoint capture, no fallback/research/tools and abort behavior reuse the chapter service boundary.

`context.ai.translateCaptions({language})` permits one fixed host request with a 60-second deadline and an API output request of at most 8,192 tokens. Model output must be JSON `{translations:[{index,text}]}`, exactly one ordered entry for every source cue. Text is nonempty plain text, at most 1,000 characters per cue / 16,000 total; raw reply limit 24,000 characters. No supplied timestamps, styles, paths, prompts or routing fields are accepted. Native runtimes retain deadline/response validation without promising a billing quota.

`context.captions.addTranslation({language,translations})` stages one complete track, tied to the captured source cues. The host fills timing fields. The sandbox cannot replace existing captions, alter word timing, choose layers/styles or bypass review. A caption-writing package must pass review even if it skips AI. Early/forged completion during a pending model request fails and aborts that request.

## Review and commit

A host-owned scrollable dialog shows timestamps and original/translated text side by side, target language, source track and provider/model. Discard is initially focused; Apply explicitly creates a new caption track. The host retains the pending proposal; replies require the exact review ID and editor/main-frame identity. Plugins, CraftAI and external MCP clients cannot approve it. Cancellation, owner loss, package revocation and late answers discard the pending review. Package integrity is checked again after acceptance.

The editor revalidates the result and commits one guarded action. It preserves all original clips, layer names and visibility. A fresh unlocked Text layer receives host-generated clip IDs, a host caption style, exact cue boundaries, `source:"plugin-translation"`, language metadata and `word_timing:"unavailable"`; measured word arrays are not copied. The new layer starts hidden, so applying does not put two caption tracks over each other. Users can switch visibility with the existing Timeline eye controls. No plugin is required to reopen or edit the resulting normal caption clips.

Manual and CraftAI execution share the same path. Stale document/gesture/owner guards, locking, one-step Undo/Redo, persistence and normal agent completion checks remain authoritative. No media transcription/upload, arbitrary caption edits or open-ended AI prompts are introduced.

## Acceptance

Verify actual Settings dropdown use, source selection and text-sharing consent, real side-by-side review, no edit before Apply, hidden named track, exact original cue timings and untouched originals/word timings, one Undo/Redo, save/reopen and visible translated subtitle export. Exercise both Settings and CraftAI, review refusal, invalid language/response, missing/oversized source, forged review answers, pending-call completion, cancellation/stale project/disablement and locked target. Use scripted provider text for automated checks and report live model quality, full-suite and platform limitations separately.
