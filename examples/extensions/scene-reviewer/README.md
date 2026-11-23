# Scene review hooks

This optional companion to SDK workbench lazily activates when the workbench runs
its typed `scene-review` hook point. It runs before the workbench's own handler.
Both use the same versioned input/output contract. Toggle Allow custom scenes in
its native plugin settings to approve or refuse the workbench's Custom scene
command. Refusal leaves the timeline unchanged.

Build and install with the public SDK, then trust both examples. Installation
does not execute their code. Stop removes this participant and its settings UI;
stopping the workbench removes the owning point. Definitions, callbacks and
invocations belong to their exact activation and registration instances.
