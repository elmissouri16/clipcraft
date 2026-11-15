# Source analysis contracts

Source analysis must describe available evidence rather than infer it from a
successful tool call. These rules apply to all source footage and providers.

## Durable source evidence

An index is a configured view, not the exclusive owner of its transcript.
`electron/media/sourceEvidence.cjs` validates and pools existing records by source
fingerprint and compatible version. Visual and speech capabilities are independent.
Language selection stays coherent. Source replacement invalidates the pool.
Compatible work is reused across speech modes and chunk sizes; only missing
intervals are processed. Earlier index IDs and files remain readable.

Coverage means processing was completed for a range. It does not mean speech
exists, recognition is accurate, an agent read all transcript pages, or footage
was watched continuously. Tools report those distinctions explicitly.

## Delegated evidence

The coordinator first discovers source evidence, completes needed capabilities,
then delegates scoped reads. Audiovisual analysis requires processed speech on
audio-bearing sources. Visual-only analysis is an explicit, disclosed choice.
Children cannot edit or delegate and cannot read outside their source scope.
Their submitted findings require their own presented source images. Empty findings
also require actual inspection. The coordinator's proposal still requires its own
finalist review; child evidence does not authorize an edit.

Completion checks count inspected child results, not configuration, attempts or
unexamined summaries. Concrete inability/skip decisions remain visible in chat.
Structured host completion status tells the native loop the actual missing
prerequisite. Tool timeouts revoke the production request and cancel its jobs so
late results cannot change the edit. Resource slots release even if cleanup fails.

## Editor ownership

Background media visuals, saved chat and generated project-cover references are
derived presentation state. They persist across Undo without revoking an agent
transaction or changing its semantic project revision. They are separate reducer
actions with project identity checks. Actual manual document edits still revoke
ownership and reject late agent writes. A general transient flag never grants a
background job authority to alter arbitrary document fields.

## Regression evidence

Non-UI coverage includes `test-source-evidence.mjs`, real FFmpeg integration in
`test-source-discovery.mjs` and `test-analysis-delegation.mjs`, completion/retry
tests, native adapter parity, run-report privacy and `test-derived-project-data.mjs`.
The existing UI smoke suites are separate and need explicit execution; passing
unit tests is not a claim that current UI behavior has been visually verified.

See [source discovery](source-discovery.md) and [analysis subagents](analysis-subagents.md)
for tool behavior and limits.
