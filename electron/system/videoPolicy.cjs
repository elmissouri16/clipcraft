// Keep the known Windows driver workaround. Other platforms use Chromium's
// normal capability/blocklist decisions. Explicit overrides remain available.
function disableGpuVideo(platform = process.platform, env = process.env) {
  if (env.FVE_GPU_VIDEO === '0') return true;
  if (env.FVE_GPU_VIDEO === '1') return false;
  return platform === 'win32';
}
module.exports = { disableGpuVideo };
