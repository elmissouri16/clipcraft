// Preserve logical project coordinates. Raster passes use the final dimensions
// and only render frames that can survive the export's FPS cap. Upsampling stays
// a final duplication step, retaining the timeline's motion sampling.
export function exportRenderPlan(project, effective) {
  return { ...project, export: effective, renderSize: {
    width: effective.outW, height: effective.outH,
    fps: Math.min(project.fps || 30, effective.outFps),
  } };
}
