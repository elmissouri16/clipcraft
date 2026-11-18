# Example icon artwork

Every extension, creative pack and sound/font showcase recipe includes its own
original GPT Image icon. These are example identities, not official logos for
separately installed services such as VoiceStudio.

The delivery standard is **256×256, static transparent PNG**, below the package
icon byte limit. A manifest references its own `assets/icon.png`; Node extension
sources keep that file in `src/assets/`. The sound and font recipes use their
named PNGs under `plugin-showcase/recipes/assets/`, copied by the showcase builder.

Run `node scripts/check-example-icons.cjs` to enforce the exact example size and
check that all manifest references resolve to valid package artwork. The normal
test runner also discovers `tests/unit/plugins/test-plugin-example-icons.cjs`.
This example standard does not change the existing third-party icon contract.

[Generation prompts and hashes](plugin-icons.json) record the built-in GPT Image
prompt for each icon, the original master hash and final PNG hash. Generated
masters remain outside the checkout; the referenced normalized PNGs are delivered
with the examples. Existing example package versions are preserved.
