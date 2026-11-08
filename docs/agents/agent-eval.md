# Agent evaluation harness

Unit and UI suites prove the editing machinery is correct. They use fixture
models, so they say nothing about whether CraftAI makes *good* edits. The
evaluation harness runs the real agent, with a real provider, on real footage
and scores the delivered edit, so prompt, guide and tool changes can be
compared run against run.

```sh
# Create a synthetic talking-head case (macOS `say`): hesitations, a false start, long pauses.
node scripts/agent-eval.cjs --make-sample ~/ClipCraftEval/sample

# Run cases with your configured provider and model (SDK providers need no key).
node scripts/agent-eval.cjs --cases ~/ClipCraftEval/sample/cases.json --use-my-ai-settings --out ~/ClipCraftEval/runs/2026-11-07

# Compare with an earlier run.
node scripts/agent-eval.cjs --cases cases.json --use-my-ai-settings --compare ~/ClipCraftEval/runs/2026-11-01/summary.json
```

`--provider` and `--model` override the provider for every case. `--build`
rebuilds the renderer first (it is built automatically when `dist/` is
missing). Each case runs in its own isolated Electron profile; your projects
and settings are not modified. With `--use-my-ai-settings` the profile receives
a copy of your `ai` settings section (provider, models and locally encrypted
keys). Real runs use the account behind that provider.

## Cases

`cases.json` is an array:

```json
[{
  "id": "podcast-clip-01",
  "brief": "Cut a 45 s vertical clip from the strongest answer, with captions.",
  "media": ["/absolute/path/podcast.mp4"],
  "platform": "podcast",
  "language": "en",
  "approve_plan": true,
  "follow_ups": [],
  "timeout_sec": 900,
  "expect": { "ratio": "9:16", "max_duration_sec": 60, "captions": true, "hook_title": true,
              "max_fillers": 1, "max_retakes": 0, "plan_proposed": true, "min_score": 70 }
}]
```

Footage stays outside the repository; keep a stable private set (talking
heads, podcasts, vlogs, tutorials, Arabic/Darija speech) so scores remain
comparable.

## What a run does

`tests/smoke/smoke-agent-eval.cjs` imports the footage in order, opens the Agent
workspace, sends the brief through the composer, approves up to three proposed
plans, then measures the final project:

- a fresh verbatim transcript of the delivered timeline (fillers, retakes,
  pauses, words per minute);
- integrated loudness and true peak;
- the full editorial critique (`critiqueProject`) and the case expectations.

**Score** = 60 % critique score + 40 % share of expectations passed.

Each case directory contains `result.json` (score, checks, issues, metrics, tool
usage profile, replies, timing), `final-project.json`, `final.png`, plan
screenshots and `runtime.log`. `summary.json` lists every case with its score,
failed checks and directory.

The harness exercises live model reasoning; results vary between runs and
models. Compare means over several cases, and read the failed checks and
issues rather than a single number.
