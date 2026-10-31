// Export dialog: cover + settings form, then the encoding view, then the done card.
// Structure is the classic export sheet (cover left, form right, footer with duration + size),
// drawn entirely in ClipCraft's own design system. Every number on it comes from the SAME
// resolved settings object the encoder consumes (src/exportQuality.js) — the form writes the
// stored settings, App re-resolves, and the summary below is that object, never display text.
import React, { useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Clapperboard, FolderOpen, ImagePlus, Play, X } from 'lucide-react';
import {
  AUDIO_RATES, CUSTOM_DEFAULTS, ENCODER_PRESETS, EXPORT_PRESETS, EXPORT_PRESET_ORDER, FPS_CHOICES,
  estimateExport, settingsPatch, storedExportSettings, summaryRows,
} from '../exportQuality.js';
import { projectDuration, toFileUrl } from '../store.js';
import { posterFracAt, posterSourceFor, spriteFrameStyle } from '../recents.js';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (mb) => (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1));

function Cover({ project, coverT, setCoverT, choosing, setChoosing, onPosterAt }) {
  const src = posterSourceFor(project, toFileUrl);
  const dur = projectDuration(project);
  const frac = src && src.kind === 'sprite' ? posterFracAt(project, coverT) : null;
  const outside = src && src.kind === 'sprite' && frac === null;
  const style = src && src.kind === 'sprite'
    ? { ...spriteFrameStyle(src.thumb, frac === null ? (coverT > 0 ? 1 : 0) : frac), aspectRatio: `${project.width} / ${project.height}` }
    : null;
  return (
    <div className="x-cover-col">
      <div className="x-cover" style={style || undefined}>
        {src && src.kind === 'image' && <img src={src.src} alt="" draggable={false} />}
        {!src && <Clapperboard size={30} className="x-cover-icon" />}
        {src && src.kind === 'sprite' && !style && <Clapperboard size={30} className="x-cover-icon" />}
      </div>
      <button type="button" className="btn btn-sm x-cover-btn" onClick={() => setChoosing(!choosing)}>
        <ImagePlus size={14} /> {choosing ? 'Done' : 'Choose cover'}
      </button>
      {outside && <p className="x-note">Preview shows the first clip only — the picked frame is still the one embedded.</p>}
      {choosing && (
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
  const [coverT, setCoverT] = useState(() => (typeof state.project?.posterAt === 'number' ? state.project.posterAt : 0));

  if (state.error) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal">
          <div className="modal-icon error"><CircleAlert size={26} /></div>
          <h3 id="export-title">Export failed</h3>
          <pre className="error-log">{state.error}</pre>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  if (state.done) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal">
          <div className="modal-icon ok"><CircleCheck size={26} /></div>
          <h3 id="export-title">Export complete</h3>
          <div className="export-file">
            <span className="export-file-name">{String(state.file || '').split(/[\\/]/).pop()}</span>
            <span className="export-file-path">{state.file}</span>
            {state.size ? <span className="export-file-path">{fmtMB(state.size / 1e6)} MB</span> : null}
          </div>
          {state.coverNote && <p className="export-dialog-note">{state.coverNote}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={onShow}><FolderOpen size={15} /> Show in folder</button>
            <button className="btn" onClick={onOpen}><Play size={15} /> Open file</button>
            <button className="btn btn-primary" onClick={onClose}>OK</button>
          </div>
        </div>
      </div>
    );
  }
  if (!state.ready) {
    const pct = Math.round((state.progress || 0) * 100);
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal export-modal">
          <div className="x-encoding">
            <div className="x-ring" aria-hidden="true" />
            <h3 id="export-title">{state.stage || 'Encoding video'}…</h3>
            <div className="progress big x-bar" aria-live="polite"><div style={{ width: `${pct}%` }} /></div>
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
  const dur = projectDuration(project);
  const est = estimateExport(eff, dur);
  const longest = Math.max(project.width, project.height);
  const capsList = [2160, 1440, 1080, 720, 480];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal export-modal">
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
              <select value={eff.resCap} onChange={(e) => onResolution(Number(e.target.value))} aria-label="Resolution">
                <option value={0}>Native · {project.width}×{project.height}</option>
                {capsList.map((c) => (
                  <option key={c} value={c} disabled={c >= longest}>{c}p{c >= longest ? ' (above project size)' : ''}</option>
                ))}
              </select>
            </Row>
            <Row label="Quality">
              <select value={eff.preset} aria-label="Quality"
                onChange={(e) => onSettings(settingsPatch(project, { preset: e.target.value, custom }))}>
                {EXPORT_PRESET_ORDER.map((id) => (
                  <option key={id} value={id}>{id === 'custom' ? 'Custom' : EXPORT_PRESETS[id].name}</option>
                ))}
              </select>
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
                  <select value={custom.codec} onChange={(e) => setCustom({ codec: e.target.value })} aria-label="Codec">
                    <option value="h264">H.264</option>
                    <option value="h265" disabled={state.caps && state.caps.libx265 === false}>H.265{state.caps && state.caps.libx265 === false ? ' (not in this build)' : ''}</option>
                  </select>
                </Row>
                <Row label="Frame rate">
                  <select value={custom.fps} onChange={(e) => setCustom({ fps: Number(e.target.value) })} aria-label="Frame rate">
                    {FPS_CHOICES.map((f) => <option key={f} value={f}>{f === 0 ? `Project (${project.fps} fps)` : `${f} fps`}</option>)}
                  </select>
                </Row>
                <Row label="Encoder">
                  <select value={custom.encoderPreset} onChange={(e) => setCustom({ encoderPreset: e.target.value })} aria-label="Encoder preset">
                    {ENCODER_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Row>
                <Row label="Audio">
                  <select value={custom.audioKbps} onChange={(e) => setCustom({ audioKbps: Number(e.target.value) })} aria-label="Audio bitrate">
                    {AUDIO_RATES.map((a) => <option key={a} value={a}>{a} kbps</option>)}
                  </select>
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
