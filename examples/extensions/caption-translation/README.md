# Caption translation

Build/install this source and Trust & activate in Plugins settings. Configure a
working connection/model in Assistant settings. Choose a target language and
source Text-track number (1 means the first Text track), then run **Translate
caption track**.

The command reads only that track's caption cues, asks before sharing text with
the selected connection, validates the complete translation and opens its
sandboxed review view. Original and translated text are compared in columns when
the dock is wide, or stacked per cue in a compact dock. Search covers both. Review
controls remain visible while the caption comparison scrolls. Discard is initially
focused; closing the view discards. Add hidden track explicitly creates the result.
Revealing this workbench closes Settings so the review can actually be seen.

Apply creates one separate, named, hidden caption track with the original cue
boundaries, language metadata and unavailable word timing. It never copies the
original measured words or replaces source captions. Show the new track with its
Timeline eye control when ready. One Undo removes it; Redo restores its initial
hidden state while preserving view toggles on old tracks. The normal saved
captions reopen and render after this extension is uninstalled.

Limits: 100 nonoverlapping source cues / 12000 source characters; at most 1000
characters per translated cue / 16000 total, and a 24000-character JSON reply.
The selected model gets a sixty-second tool-free text request, without research
or fallback. Installation/activation perform no generation requests. No media is
uploaded or transcribed. Project changes, user cancellation and stop revoke
pending work and close the review. Final content revisions are checked again
before the atomic write.

The extension owns its prompts, language choices, validation and review assets.
It uses ordinary `services`, `captions`, `events`, `jobs` and `ui` APIs, without a
caption-translation extension kind. Core account keys are not exposed. Connection
review is bound to the selected account and native connection settings; changing
them before a request requires a fresh review.

The historical ID/version is retained; the host keeps the old immutable package
beside this Node replacement and requires fresh trust. No version is bumped.
CraftAI can discover/run the declared command with native review and real
caption-track receipts, or it can be run from Plugins settings.
