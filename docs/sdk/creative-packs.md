# Create a creative pack

Build a **Small review** preset that an editor can choose at export time. A creative pack holds declarative settings and optional licensed assets. This example needs one manifest and the SDK CLI.

## Scaffold the preset

From the ClipCraft checkout, build the SDK, then create a new project in an unused directory. These commands assume the SDK dependencies are installed as described in the [extension tutorial](../../packages/plugin-sdk/README.md#start-an-extension).

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs create ../review-preset \
  --template export-preset --id studio.review --name "Review exports" --publisher Studio
```

## Set the output

In `../review-preset/plugin.json`, replace `contributes.exportPresets` with this array. Leave the generated package identity and API version in place.

```json
[
  {
    "id": "review-720",
    "name": "Small review",
    "settings": {
      "mode": "crf",
      "crf": 23,
      "bitrateMbps": 4,
      "encoderPreset": "fast",
      "audioKbps": 128,
      "resCap": 720,
      "fps": 0,
      "codec": "h264"
    }
  }
]
```

Here `fps: 0` keeps the project frame rate. The size cap fits the longest edge to 720 pixels when scaling down, so a landscape 16:9 project can produce **720 × 406** after even rounding. Check the actual dimensions in the export summary. In CRF mode the quality target controls H.264 encoding. The manifest also supplies a bitrate for bitrate mode. [Export settings and size resolution](../export/EXPORT-QUALITY.md)

## Package and try it

```sh
node packages/plugin-sdk/dist/cli.cjs check ../review-preset
node packages/plugin-sdk/dist/cli.cjs build ../review-preset
node packages/plugin-sdk/dist/cli.cjs validate ../review-preset/dist
node packages/plugin-sdk/dist/cli.cjs pack ../review-preset/dist ../review-preset.tgz
```

Install the archive in **Settings → Plugins → Installed**. Open a landscape project, choose **Export**, then select **Small review** in the quality menu. Compare the codec, size and frame rate with the settings above. Applying a preset copies its settings into the project. The saved selection remains usable if you later remove the package.

## Choose another contribution

| To share | Template or contract |
| --- | --- |
| An effect or transition with adjustable parameters | Scaffold `effect` or `transition`. Follow the [expression and shader contract](../design/plugin-glsl.md). |
| Licensed sounds and fonts | Scaffold `content-pack`. Declare assets and attribution in the [content pack manifest](../design/plugin-content-packs.md). |
| A title treatment, grade or motion preset | Use `text-style-pack`, `color-pack` or `motion-pack`. Inspect the [working creative examples](../../examples/plugin-showcase/README.md). |
| A custom video, audio or metadata track | Declare [track and clip types](../design/plugin-custom-timeline.md) and describe their inspector fields and rendering behavior. |

Place source assets under `src/assets`, declare their packaged `assets/…` paths and include licenses. Use the [packaging guide](authoring.md) for portable filenames, supported formats, size limits and distribution.
