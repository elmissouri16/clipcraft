# Effect export storage and failures

Animated effects are baked into lossless FFV1 intermediates before final
composition. Continuous grain can make those temporary files much larger than
the delivered H.264 video. They remain necessary until the final encode finishes.

Completed effect and text files opt into immutable cache storage. The session
cache hard-links these files on the same volume, avoiding a second media copy;
unsupported filesystems fall back to copying. Mutable cache callers retain copy
isolation. A cache hit is pinned to the current export's temporary directory so
later cache eviction cannot remove an input required by final composition.

Cache directories carry an owner PID. New cache creation removes recognized
caches whose owner has exited. Live owners and unmarked legacy directories are
left alone. The reported failure investigation also removed obsolete legacy
render caches predating the only running ClipCraft session; the exact manifest
is `/tmp/clipcraft-stale-render-cache-cleanup.json`.

Encoder failures during pipe backpressure retain FFmpeg's diagnostic instead of
the generic "encoder stopped while writing" message. Disk exhaustion has an
actionable error, and effect failures enter the existing bounded diagnostic log.
Effect rendering checks available temporary space periodically and keeps a small
reserve rather than writing until the filesystem is completely full.

Completed jobs release decoder buffers. Cancellation destroys pipes and forcibly
stops temporary decoder/encoder processes: a decoder paused on a full stdout pipe
may never process a graceful termination request. Destroyed pipes also unblock
pending frame reads. No effect is disabled and the intermediate codec stays
lossless.

## Verification

- `test-effect-encoder-failure.cjs`: real child-process disk/codec failures during
  writes, blocked-pipe cleanup and pending reader completion.
- `test-render-cache.cjs`: immutable inode sharing, mutable copy isolation,
  dead-owner cleanup and retention of live/unrecognized owners.
- `test-effect-ranges.mjs`: cached inputs survive cache removal; real encoded
  pixels, seeking, audio and fractional effect/transition windows remain correct.
- `test-export-storage-ui.cjs`: isolated app failure injection and successful
  retry with an image from the reported project, grain, vignette, shake, RGB
  splitting and captions. The original project and media are read only.
- Real-app effect/transition pixel parity:
  `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-effect-parity-ui-MFTJhw/result.json`.
- Targeted regression results:
  `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-JzdB4D/results.json`.
- Full reported timeline: real app export at the observed low/720-longest-side
  setting, retaining all original effects, captions and audio. The delivered file
  was probed and decoded completely without errors:
  `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-ELhppM/result.json`.
  The original failure did not retain FFmpeg's stderr, so its exact cause cannot
  be established retrospectively. Disk pressure and the documented storage and
  cleanup defects were confirmed independently.
