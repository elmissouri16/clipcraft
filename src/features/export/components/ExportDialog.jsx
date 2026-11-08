// Export dialog: cover + settings form, then the encoding view, then the done card.
// Structure is the classic export sheet (cover left, form right, footer with duration + size),
// drawn entirely in ClipCraft's own design system. Every number on it comes from the SAME
// resolved settings object the encoder consumes (src/features/export/exportQuality.js) — the form writes the
// stored settings, App re-resolves, and the summary below is that object, never display text.
// Durations likewise come from the encoder's own basis, exportDuration() in src/state/store.js —
// the video-track layout end the pipeline totals in electron/media/ffmpeg.cjs — never
// projectDuration(), which also counts text/audio ends the encode does not follow.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Clapperboard, FolderOpen, ImagePlus, Play, X } from 'lucide-react';
import {
  AUDIO_RATES, CUSTOM_DEFAULTS, ENCODER_PRESETS, EXPORT_PRESETS, EXPORT_PRESET_ORDER, FPS_CHOICES,
  estimateExport, settingsPatch, storedExportSettings, summaryRows,
} from '../exportQuality.js';
import { exportDuration, toFileUrl } from "../../../state/store.js";
import { coverTargetFor, posterSourceFor, spriteFrameStyle } from "../../../app/recents.js";
import Dropdown from "../../../components/ui/Dropdown.jsx";
import { formatElapsed, formatRemaining } from '../exportProgress.js';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (mb) => (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1));

// The cover preview ALWAYS shows a full-resolution frame of the original media at the cover
// time (grabbed by the main process via media:frame — never a proxy, never a thumbnail-sprite
// frame; the sprite only fills in for the first instant while the grab is on its way, and the
// previous grab stays up while scrubbing until the new one lands). The frame shown is the
// frame the export embeds: coverTargetFor maps the timeline time exactly like the embed does.
function Cover({ project, coverT, setCoverT, choosing, setChoosing, onPosterAt, readOnly = false }) {
  const dur = exportDuration(project);
  const target = coverTargetFor(project, coverT);
  const tKey = target && target.kind === 'video' ? `${target.media.path}|${target.at.toFixed(2)}` : null;
  const [frame, setFrame] = useState(null); // { key, url } — the latest full-res grab
  useEffect(() => {
    if (!tKey || !window.api?.frameGrab) return undefined;
    let live = true;
    const h = setTimeout(() => {
      window.api.frameGrab(target.media.path, target.at)
        .then((r) => { if (live && r && r.ok) setFrame({ key: tKey, url: toFileUrl(r.path) }); })
        .catch(() => {});
    }, 120);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey]);
  const sprite = !frame && target && target.kind === 'video' ? posterSourceFor(project, toFileUrl) : null;
  const spriteStyle = sprite && sprite.kind === 'sprite' ? spriteFrameStyle(sprite.thumb, 0) : null;
  return (
    <div className="x-cover-col">
      <div className="x-cover" style={{ ...(spriteStyle || {}), '--cover-ratio': project.width / project.height, aspectRatio: `${project.width} / ${project.height}` }}>
        {target && target.kind === 'image' && <img src={toFileUrl(target.media.path)} alt="" draggable={false} />}
        {target && target.kind === 'video' && frame && <img src={frame.url} alt="" draggable={false} />}
        {!target && <Clapperboard size={30} className="x-cover-icon" />}
        {target && target.kind === 'video' && !frame && !spriteStyle && <Clapperboard size={30} className="x-cover-icon" />}
      </div>
      {!readOnly && (
      <button type="button" className="btn btn-sm x-cover-btn" onClick={() => setChoosing(!choosing)}>
        <ImagePlus size={14} /> {choosing ? 'Done' : 'Choose cover'}
      </button>)}
      {!readOnly && choosing && (
        <div className="x-cover-pick">
          <input type="range" min="0" max={Math.max(0.1, dur)} step={1 / (project.fps || 30)} value={coverT}
            aria-label="Cover frame time"
            onChange={(e) => { const t = Number(e.target.value); setCoverT(t); onPosterAt(t); }} />
          <span className="x-cover-time">Cover at {fmtDur(coverT)} — also becomes the project card picture.</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return <div className="x-row"><span className="x-row-label">{label}</span><div className="x-row-ctl">{children}</div></div>;
}

export default function ExportDialog({ state, onCancel, onClose, onShow, onOpen, onStart, onPickTarget, onRename, onSettings, onResolution, onPosterAt }) {
  const [choosing, setChoosing] = useState(false);
  const [details, setDetails] = useState(false);
  const [encodingDetails, setEncodingDetails] = useState(false);
  const [coverT, setCoverT] = useState(() => (typeof state.project?.posterAt === 'number' ? state.project.posterAt : 0));
  const dialog = useRef(null);
  useEffect(() => { const previous=document.activeElement;return () => {if(previous?.isConnected)previous.focus();}; },[]);
  useEffect(() => {
    const element=dialog.current;
    if(state.ready)element?.querySelector('[aria-label="Output file name"]')?.focus();
    else element?.focus();
  },[state.ready,state.done,!!state.error]);
  const dialogKeys = event => {
    if (event.defaultPrevented) return;
    if(event.key==='Escape'&&(state.ready||state.done||state.error)){event.preventDefault();event.stopPropagation();onClose();return;}
    if(event.key!=='Tab')return;
    const buttons=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
    const first=buttons[0],last=buttons.at(-1);
    if(!first){event.preventDefault();return;}
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  };

  if (state.error) {
    return (
      <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal">
          <div className="modal-icon error"><CircleAlert size={26} /></div>
          <h3 id="export-title">Export failed</h3>
          <pre className="error-log">{state.error}</pre>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Close</button>
            {state.project && state.eff && <button className="btn btn-primary" onClick={onStart}>Try again…</button>}
          </div>
        </div>
      </div>
    );
  }
  if (state.done) {
    return (
      <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal">
          <div className="modal-icon ok"><CircleCheck size={26} /></div>
          <h3 id="export-title">{state.review ? 'Section preview ready' : 'Export complete'}</h3>
          {state.review && <video className="review-video" controls preload="metadata" src={toFileUrl(state.file)} aria-label="Rendered section preview" />}
          {state.review && <p className="export-dialog-note">Play this section to check the motion and sound.</p>}
          {state.review && state.metadata && <p className="export-dialog-note">{fmtDur(state.metadata.duration_sec)} · {state.metadata.width}×{state.metadata.height} · {state.metadata.fps} fps</p>}
          {!state.review && <div className="export-file">
            <span className="export-file-name">{String(state.file || '').split(/[\\/]/).pop()}</span>
            <span className="export-file-path">{state.file}</span>
            {state.size ? <span className="export-file-path">{fmtMB(state.size / 1e6)} MB</span> : null}
          </div>}
          {state.coverNote && <p className="export-dialog-note">{state.coverNote}</p>}
          {Number.isFinite(state.elapsedSeconds) && <p className="export-dialog-note">Completed in {formatElapsed(state.elapsedSeconds)}</p>}
          <div className="modal-actions">
            {!state.review && <button className="btn" onClick={onShow}><FolderOpen size={15} /> Show in folder</button>}
            <button className="btn" onClick={onOpen}><Play size={15} /> {state.review ? 'Open in player' : 'Open file'}</button>
            <button className="btn btn-primary" onClick={onClose}>{state.review ? 'Close' : 'OK'}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!state.ready) {
    const pct = Math.min(99, Math.floor((state.progress || 0) * 100));
    const { project, eff } = state;
    if (project && eff) {
      // In-progress layout: the chosen cover on the left, a read-only spec list on the right —
      // every value read from the SAME resolved settings object the encoder consumes — and a
      // full-width progress row underneath. No decorative specs: each row is pipeline truth.
      const dur = exportDuration(project);
      const est = estimateExport(eff, dur);
      const fileName = state.target?.file ? String(state.target.file).split(/[\\/]/).pop() : `${state.name || 'export'}.mp4`;
      const specs = [
        ['Name', fileName],
        ['Duration', fmtDur(dur)],
        ['Video', `${eff.outW}×${eff.outH} · ${eff.outFps} fps`],
        ['Format', `MP4 · ${eff.codecLabel}`],
      ];
      const extraSpecs = [
        ['Size', est.exact ? `${fmtMB(est.mb)} MB` : `≈ ${fmtMB(est.mb)} MB (estimate)`],
        ['Bitrate', eff.mode === 'bitrate' ? `${eff.bitrateMbps} Mbps` : `CRF ${eff.crf} · ≈ ${est.videoMbps.toFixed(1)} Mbps`],
        ['Color space', 'Rec. 709 SDR'],
      ];
      return (
        <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="modal export-modal">
            <div className="x-head">
              <h3 id="export-title">Exporting video</h3>
            </div>
            <div className="x-enc-body">
              <Cover project={project} coverT={coverT} setCoverT={setCoverT} choosing={false} setChoosing={setChoosing} onPosterAt={onPosterAt} readOnly />
              <div className="x-specs">
                {[...specs,...(encodingDetails?extraSpecs:[])].map(([k, v]) => (
                  <div key={k} className="export-summary-row"><span>{k}</span><b>{v}</b></div>
                ))}
                <button type="button" className="x-details-toggle" onClick={() => setEncodingDetails(!encodingDetails)} aria-expanded={encodingDetails}>
                  <ChevronDown size={14} style={{transform:encodingDetails?'rotate(180deg)':'none'}} /> {encodingDetails?'Hide details':'Export details'}
                </button>
              </div>
            </div>
            <div className="x-enc-foot">
              <div className="x-enc-status">
                <div className="x-ring sm" aria-hidden="true" />
                <span className="x-enc-stage" aria-live="polite">{state.stopping ? 'Stopping export…' : state.phase === 'encode' && state.phaseProgress >= .995 ? 'Saving video…' : `${state.stage || 'Encoding video'}…`}</span>
                <span className="x-enc-pct">{pct}%</span>
              </div>
              <div className="progress big x-bar" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
              <div className="x-export-timing">
                <strong className="x-export-eta" title="An estimate based on the remaining work and measured rendering speed. It updates as your video is exported.">{state.stopping ? 'Waiting for export to stop' : formatRemaining(state.remainingSeconds) || (state.phaseProgress >= .995 || state.phase === 'finish' ? 'Finishing this step…' : `${state.timingStatus || 'Estimating time remaining'}…`)}</strong>
                <span>Elapsed {formatElapsed(state.elapsedSeconds)}</span>
              </div>
              <div className="x-export-step">
                <span>{state.step && state.steps ? `Step ${state.step} of ${state.steps}` : ''}</span>
                {state.encoder && <span>{/videotoolbox|nvenc|qsv|amf/.test(state.encoder) ? 'Hardware accelerated' : 'Software encoding'}</span>}
              </div>
              <div className="x-enc-actions">
                <button className="btn btn-ghost" disabled={state.stopping || state.phase === 'finish'} onClick={onCancel}>{state.stopping ? 'Stopping…' : 'Cancel export'}</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal export-modal">
          <div className="x-encoding">
            <div className="x-ring" aria-hidden="true" />
            <h3 id="export-title">{state.stage || 'Encoding video'}…</h3>
            <div className="progress big x-bar" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
            <div className="x-pct">{pct}%</div>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const { project, eff } = state;
  const stored = storedExportSettings(project);
  const custom = { ...CUSTOM_DEFAULTS, ...(stored.custom || {}) };
  const setCustom = (field) => onSettings(settingsPatch(project, { preset: 'custom', custom: { ...custom, ...field } }));
  const dur = exportDuration(project);
  const est = estimateExport(eff, dur);
  const longest = Math.max(project.width, project.height);
  const capsList = [2160, 1440, 1080, 720, 480];
  return (
    <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal export-modal export-ready">
        <div className="x-head">
          <h3 id="export-title">Export video</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="x-body">
          <Cover project={project} coverT={coverT} setCoverT={setCoverT} choosing={choosing} setChoosing={setChoosing} onPosterAt={onPosterAt} />
          <div className="x-form">
            <Row label="Name">
              <input type="text" value={state.name || ''} onChange={(e) => onRename(e.target.value)} aria-label="Output file name" />
            </Row>
            <Row label="Export to">
              <span className="x-path" title={state.target?.file || ''}>{state.target ? state.target.file : 'Not chosen yet'}</span>
              <button type="button" className="btn btn-sm" onClick={() => onPickTarget(state.name)}>Browse…</button>
            </Row>
            <Row label="Resolution">
              <Dropdown value={eff.resCap} ariaLabel="Resolution" onChange={(v) => onResolution(v)}
                options={[
                  { value: 0, label: `Native · ${project.width}×${project.height}` },
                  ...capsList.map((c) => ({ value: c, label: `${c}p${c >= longest ? ' (above project size)' : ''}`, disabled: c >= longest })),
                ]} />
            </Row>
            <Row label="Quality">
              <Dropdown value={eff.preset} ariaLabel="Quality"
                onChange={(v) => onSettings(settingsPatch(project, { preset: v, custom }))}
                options={EXPORT_PRESET_ORDER.map((id) => ({ value: id, label: id === 'custom' ? 'Custom' : EXPORT_PRESETS[id].name }))} />
            </Row>
            {eff.preset === 'custom' && (
              <div className="x-custom">
                <Row label="Mode">
                  <div className="seg-tabs x-seg" role="tablist" aria-label="Quality mode">
                    <button type="button" role="tab" aria-selected={custom.mode === 'crf'} className={custom.mode === 'crf' ? 'on' : ''} onClick={() => setCustom({ mode: 'crf' })}>CRF</button>
                    <button type="button" role="tab" aria-selected={custom.mode === 'bitrate'} className={custom.mode === 'bitrate' ? 'on' : ''} onClick={() => setCustom({ mode: 'bitrate' })}>Bitrate</button>
                  </div>
                </Row>
                {custom.mode === 'crf' ? (
                  <Row label="CRF">
                    <input type="range" min="0" max="51" step="1" value={custom.crf} aria-label="CRF"
                      onChange={(e) => setCustom({ crf: Number(e.target.value) })} />
                    <span className="x-num">{custom.crf}</span>
                  </Row>
                ) : (
                  <Row label="Bitrate">
                    <input type="number" min="0.5" max="100" step="0.5" value={custom.bitrateMbps} aria-label="Bitrate in megabits per second"
                      onChange={(e) => setCustom({ bitrateMbps: Number(e.target.value) })} />
                    <span className="x-num">Mbps</span>
                  </Row>
                )}
                <Row label="Codec">
                  <Dropdown value={custom.codec} onChange={(v) => setCustom({ codec: v })} ariaLabel="Codec"
                    options={[
                      { value: 'h264', label: 'H.264' },
                      { value: 'h265', label: `H.265${state.caps && state.caps.libx265 === false && !state.caps.h265Hardware ? ' (not in this build)' : ''}`, disabled: state.caps && state.caps.libx265 === false && !state.caps.h265Hardware },
                    ]} />
                </Row>
                <Row label="Frame rate">
                  <Dropdown value={custom.fps} onChange={(v) => setCustom({ fps: v })} ariaLabel="Frame rate"
                    options={FPS_CHOICES.map((f) => ({ value: f, label: f === 0 ? `Project (${project.fps} fps)` : `${f} fps` }))} />
                </Row>
                <Row label="Encoder">
                  <Dropdown value={custom.encoderPreset} onChange={(v) => setCustom({ encoderPreset: v })} ariaLabel="Encoder preset"
                    options={ENCODER_PRESETS.map((p) => ({ value: p, label: p }))} />
                </Row>
                <Row label="Audio">
                  <Dropdown value={custom.audioKbps} onChange={(v) => setCustom({ audioKbps: v })} ariaLabel="Audio bitrate"
                    options={AUDIO_RATES.map((a) => ({ value: a, label: `${a} kbps` }))} />
                </Row>
              </div>
            )}
            <Row label="Format"><span className="x-static">MP4</span></Row>
            <Row label="Est. bitrate"><span className="x-static">{est.exact ? `${est.videoMbps} Mbps` : `≈ ${est.videoMbps.toFixed(1)} Mbps`}</span></Row>
            <button type="button" className="x-details-toggle" onClick={() => setDetails(!details)} aria-expanded={details}>
              <ChevronDown size={14} style={{ transform: details ? 'rotate(180deg)' : 'none' }} /> Export summary
            </button>
            {details && (
              <div className="export-summary">
                {summaryRows(eff, project).map(([k, v]) => (
                  <div key={k} className="export-summary-row"><span>{k}</span><b>{v}</b></div>
                ))}
                {eff.notes.map((n) => <p key={n} className="export-dialog-note">{n}</p>)}
              </div>
            )}
          </div>
        </div>
        <div className="x-foot">
          <span className="x-foot-meta" title={est.exact ? 'Size computed from your bitrate settings.' : 'Estimated from resolution, frame rate and quality — the real size depends on the footage.'}>
            Duration {fmtDur(dur)} · Size: {est.exact ? '' : '≈ '}{fmtMB(est.mb)} MB
          </span>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onStart}>Export</button>
          </div>
        </div>
      </div>
    </div>
  );
}
