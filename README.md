<p align="center">
  <img src="public/logo.png" width="110" alt="ClipCraft logo" />
</p>

<h1 align="center">ClipCraft</h1>

<p align="center">
  <b>An original desktop video editor — built for creators who want pro results without a subscription.</b><br />
  Timeline editing · transitions &amp; effects · animated text · auto captions · offline templates · an AI assistant that works with your own API keys.<br />
  <b>No account. No watermark. Your projects stay on your computer.</b>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-825cfb" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Linux-0078d4" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb" />
  <img alt="FFmpeg" src="https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white" />
</p>

![ClipCraft editor](docs/screenshot-editor.png)

## What it does

- **Full timeline editor** — multi-track video, audio, text, stickers and overlays, with keyframes, masks, chroma key, color grading (curves, HSL, LUTs) and per-clip effects.
- **Transitions & effects** — a large built-in catalog of GPU transitions (pans, zooms, wipes, glitch, light leaks and more) and a growing effects library, all previewed live and rendered identically on export.
- **Animated text** — dozens of in/out text animations, word-by-word caption styling, and RTL/Arabic support done properly.
- **Captions your way** — free on-device Whisper transcription (including a Darija model), or bring your own cloud key (Groq, OpenAI, Deepgram, ElevenLabs) for faster results.
- **Templates that work offline** — a bundled template library with animated previews, plus a template store format for sharing your own.
- **Stock built in** — search and drop in stock video, photos and music without leaving the app.
- **CraftPilot** — an AI editing assistant that works with *your* provider and *your* key (Gemini, OpenAI, Anthropic, Groq, OpenRouter, Ollama and more). It can cut filler, style captions, apply looks and run multi-step edits on request.
- **Honest export** — quality presets plus full custom control (codec, bitrate/CRF, resolution, frame rate), with your preview settings never silently changing the final render.

## Run it from source

```bash
npm install
npm run dev        # development
npm start          # build + launch the app
npm run package:linux   # build the Linux .deb
```

## Updates

ClipCraft checks for updates manually from **About → Check for updates** and downloads new versions in-app from hamzaabika.com. Nothing auto-installs and nothing phones home.

## About

ClipCraft is designed and built by **Hamza Abika**. Private repository — all rights reserved.
