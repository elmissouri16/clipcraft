# AI chapter markers

Build/install this source and Trust & activate in Plugins settings. Configure a
working connection/model in Assistant settings, then choose Maximum chapters and
run **Suggest chapter markers**. The Native Run command button uses the normal
Node host; there is no fixed AI chapter permission or executable recipe in its
manifest.

The command captures existing captions across Text tracks, asks before sharing
their text/timing with the selected connection, then validates the answer. Only
distinct existing caption start times and plain titles are accepted. Review every
proposed marker in the native message and choose Apply markers or Discard. Apply
preserves existing markers and uses one Undo step. No media is uploaded or
transcribed. Installation/activation make no generation requests.

Limits match the earlier example: 1000 source cues, 24000 source characters,
1–20 chapters, 80 characters per title and an 8192-character JSON answer. The
model request is tool-free, with no web research or fallback, and a sixty-second
deadline. Project changes cancel pending work; native content revisions still
guard the final write. Native jobs provide cancellation; a refused/expired sharing
message sends nothing.

`source.ts` is a standalone copy of the helper used by the translation example.
Its `clipcraft.ai` calls use the ordinary services API; core credentials stay in
the host. The extension owns the prompt, response validation and marker review.

The historical ID/version is retained; installing this rebuilt Node package keeps
the old immutable payload and requires fresh trust. Existing project markers do
not depend on keeping it installed. CraftAI can discover and run its declared
commands through native review and the general Node command API.
