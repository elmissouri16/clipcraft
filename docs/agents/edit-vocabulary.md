# Edit vocabulary and reference videos

CraftAI is not tied to preset styles. It describes any edit in one shared
vocabulary of measurable dimensions and copies whatever a reference shows, as
far as the editing tools allow. A reference is never sent to a model as video:
`electron/media/editStyle.cjs` measures it locally, and the model receives a
compact fingerprint plus one or two numbered contact sheets.

## Attaching a reference

- **Chat:** attach a video with the paperclip, or drop or paste it into the
  composer. Up to three per message.
  - `electron/agents/chatVideos.cjs` validates and probes the file and keeps a
    poster. It refers to the original by an opaque ID; videos are not copied.
  - Saved chats keep the ID and metadata, never the path.
  - The message tells the model each `reference_id`.
- **Library:** any video in the media library can be a reference (`media_id`).
- **Tool:** `analyze_reference` lives in the `reference` tool group. It returns
  the fingerprint and sample shots as contact sheets.

## Dimensions

| Dimension | Fields | How it is measured |
| --- | --- | --- |
| Pacing | `shots`, `cuts_per_min`, `shot_sec` (median, p10, p90), `rhythm_variation`, `first_cut_sec`, `opening`, `ending`, `curve_cuts_per_min` (ten equal parts) | Cut times |
| Transitions | `cut`, `jump`, `punch_in` / `punch_out` (with scale), `dissolve`, `fade_black`, `fade_white`, each with its time | See below |
| Framing | `punch_ratio`, `jump_ratio`, `punch_scale_median`, `zoom_in_shots`, `zoom_out_shots` | Zoom matching across cuts and within shots |
| Motion | `energy_median`, `static_ratio`, `moving_ratio`; per shot `move` | Frame differences; first and last frame of each shot |
| Colour | Median and spread of `luma`, `contrast`, `saturation`, `warmth`, `tint`; `black_and_white_ratio`; `letterbox` | Per-shot colour statistics |
| Sound | `integrated_lufs`, `loudness_range_lu`, `silence_ratio`, `music` (bpm, confidence), `cuts_on_beat` (ratio and chance, also on half beats, beats per shot) | `ebur128`; the beat tracker of `electron/audio/rhythm.cjs` |
| Speech | `words_per_min`, `speech_ratio`, `pause_sec`, `long_pauses_per_min`, `cuts_inside_words_ratio`, `gap_at_cuts_median_sec` | Word timings from the local speech model, when installed |
| Transcript | `segments` of `[start, end, text]`, `reliability` (`clear` or `uncertain` with `why`), `words`; paged with `transcript_from_sec` / `next_from_sec` (~12k characters per page) | The same speech pass. Marked uncertain when a line repeats (misheard noise) or when strong music comes with little speech (possibly lyrics). |
| Sound | `energy_curve_db` and `onset_curve_per_sec` (ten parts), `loud_jumps_sec` (drops and entrances), `voice_balance` (speech level against its pauses: how far the bed is ducked, or a note that the speech never pauses), `cut_sounds` (`hit_ratio` against `hit_chance`, `riser_ratio`) | Short-window loudness of the mix and its onsets. A hit at a cut can be a sound effect or a music accent: the mono mix cannot tell them apart. |

What arithmetic cannot judge is listed in `needs_visual_review`: shot sizes and
subjects, captions and on-screen text, graphics, speed ramps. The model judges
these from the contact sheets.

## How transitions are told apart

All of this runs on one low-resolution decode. FFmpeg's scene detector and the
raw frames share it, because decoding is the expensive part.

- **Hard cuts:** FFmpeg's scene changes, plus single-frame jumps it does not
  report. A jump cut keeps the framing, so its scene score stays low.
- **Kind of cut**, comparing the frames on either side:
  - nearly the same picture: a jump cut;
  - one is a tighter or wider crop of the other: a punch in or out, found by a
    coarse-to-fine search over scale and centre;
  - otherwise: a new shot.
- **Gradual transitions:** a large change over a few tenths of a second with no
  single-frame jump.
  - In a dissolve, the middle frame is the mix of the ends.
  - A fade passes through black or white.
  - Camera moves fail both tests.
- **Camera moves:** a shot's first and last frames are related by a zoom
  (zoom in or out), differ without one (moving), or match (static).

## Accuracy and limits

`tests/unit/media/test-edit-style.cjs` builds a reference whose editing is known
exactly and requires every transition back with its kind and time:

- hard cuts, a 1.5× punch-in, a zoom-in move;
- a 0.5 s dissolve, a fade through black, a jump cut;
- moving content and a black-and-white shot;
- a 120 BPM click track with the cuts on the beat.

Continuous shots (a noisy pan, a fast zoom) must produce no cuts.
`tests/unit/agents/test-reference-video-ui.cjs` covers the real app: attaching,
the chip, the analysis with speech, the contact sheets and caching.

Known limits:
- Wipes, slides and glitch transitions count as cuts or are missed.
- Measurements come from 96-pixel frames: they are estimates.
- References longer than 30 minutes are analysed for their first 30 minutes.

The transcript is only as good as the local speech model (base by default); it is not sent anywhere.

Measured speed on an Apple-silicon Mac:
- 17 s of 640×360: about 1 s, or 2.1 s with speech.
- 20 s of 4K60 HEVC: 6 s (software decoding; hardware decoding was slower).
