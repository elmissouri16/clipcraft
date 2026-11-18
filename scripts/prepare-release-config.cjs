// Release-build config generator (used by .github/workflows/release.yml and for local
// release verification): derives electron-builder.release.json from package.json's
// build config with the ONE release difference — the bundled content pack
// (build.extraResources → ../clipcraft-pack-merged) is REMOVED, so public release
// artifacts are light. The dev default in package.json is never touched.
// Run: node scripts/prepare-release-config.cjs   (writes ./electron-builder.release.json)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(pkg.build || {}));
delete cfg.extraResources;
// Deterministic installer names (the download links and release notes depend on them).
// The .deb keeps electron-builder's Debian-policy default (clipcraft_<version>_amd64.deb).
if (cfg.win) cfg.win.artifactName = 'ClipCraft-Setup-${version}.${ext}';
// macOS ships one DMG per architecture (arm64 and x64), named for it. A universal build is not
// supported by this payload: the bundled ffmpeg is downloaded for the build machine's architecture
// only, and the per-architecture ffprobe files make the universal merge fail (packaged-app run
// 44223811766, 2026-11-18: "the number of mach-o files is not the same").
if (cfg.mac) cfg.mac.artifactName = 'ClipCraft-${version}-${arch}.${ext}';
// Never publish from the per-platform build jobs: electron-builder 26
// implicitly publishes when it detects CI, which fails without GH_TOKEN
// (run #1's ubuntu failure — the .deb built, then publishing died).
// The workflow's Publish job alone creates the Release.
cfg.publish = null;
const out = path.join(root, 'electron-builder.release.json');
fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
console.log(`wrote ${path.relative(root, out)} (extraResources removed: ${!('extraResources' in cfg)}, version ${pkg.version})`);
