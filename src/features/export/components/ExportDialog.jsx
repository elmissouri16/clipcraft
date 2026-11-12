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
import MediaCredits from '../../library/components/MediaCredits.jsx';
import { formatElapsed, formatRemaining } from '../exportProgress.js';
import { t } from '../../../i18n/index.js';

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const fmtMB = (mb) => (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1));

// The cover preview shows the COMPOSITED frame at the cover time — main track, overlays,
// graphics and text, the picture the export embeds — rendered by the main process
// (export:coverFrame, the offscreen preview renderer). The previous render stays up while
// scrubbing until the new one lands; before the first render the main-track source (its image,
// or its thumbnail sprite) fills in. A landed render also becomes the project card picture.
// Without export:coverFrame (older hosts) the preview falls back to a full-resolution frame of the
// main-track source at the mapped time (media:frame), which is blind to overlay tracks.
function Cover({ project, coverT, setCoverT, choosing, setChoosing, onPosterAt, onPosterImage, readOnly = false }) {
  const dur = exportDuration(project);
  const fps = project.fps || 30;
  const at = Math.min(Math.max(0, coverT), Math.max(0, dur - 1 / fps)); // inside the timeline: the last frame at most
  const target = coverTargetFor(project, coverT);
  const composite = typeof window.api?.exportCoverFrame === 'function';
  const tKey = composite ? `composite|${at.toFixed(3)}` : target && target.kind === 'video' ? `${target.media.path}|${target.at.toFixed(2)}` : null;
  const [frame, setFrame] = useState(null); // { key, url } — the latest render / grab
  useEffect(() => {
    if (!tKey) return undefined;
    if (!composite && !window.api?.frameGrab) return undefined;
    let live = true;
    const h = setTimeout(() => {
      const grab = composite ? window.api.exportCoverFrame(project, at) : window.api.frameGrab(target.media.path, target.at);
      grab.then((r) => {
        if (!live || !r || !r.ok) return;
        setFrame({ key: tKey, url: toFileUrl(r.path) });
        if (composite && r.poster && onPosterImage) onPosterImage(r.poster);
      }).catch(() => {});
    }, composite ? 200 : 120);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey]);
  const sprite = !frame && target && target.kind === 'video' ? posterSourceFor(project, toFileUrl) : null;
  const spriteStyle = sprite && sprite.kind === 'sprite' ? spriteFrameStyle(sprite.thumb, 0) : null;
  return (
    <div className="x-cover-col">
      <div className="x-cover" style={{ ...(spriteStyle || {}), '--cover-ratio': project.width / project.height, aspectRatio: `${project.width} / ${project.height}` }}>
        {frame && <img src={frame.url} alt="" draggable={false} data-cover={composite ? 'composite' : 'source'} />}
        {!frame && target && target.kind === 'image' && <img src={toFileUrl(target.media.path)} alt="" draggable={false} data-cover="placeholder" />}
        {!target && <Clapperboard size={30} className="x-cover-icon" />}
        {!frame && target && target.kind === 'video' && !spriteStyle && <Clapperboard size={30} className="x-cover-icon" />}
      </div>
      {!readOnly && (
      <button type="button" className="btn btn-sm x-cover-btn" onClick={() => setChoosing(!choosing)}>
        <ImagePlus size={14} /> {choosing ? t('app.done') : t('export.choose_cover')}
      </button>)}
      {!readOnly && choosing && (
        <div className="x-cover-pick">
          <input type="range" min="0" max={Math.max(0.1, dur)} step={1 / (project.fps || 30)} value={coverT}
            aria-label={t('export.cover_frame_time')}
            onChange={(e) => { const v = Number(e.target.value); setCoverT(v); onPosterAt(v); }} />
          <span className="x-cover-time">{t('export.cover_at', { time: fmtDur(coverT) })}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return <div className="x-row"><span className="x-row-label">{label}</span><div className="x-row-ctl">{children}</div></div>;
}

export default function ExportDialog({ state, onCancel, onClose, onShow, onOpen, onStart, onPickTarget, onRename, onSettings, onResolution, onPosterAt, onPosterImage }) {
  const [choosing, setChoosing] = useState(false);
  const [details, setDetails] = useState(false);
  const [encodingDetails, setEncodingDetails] = useState(false);
  const [coverT, setCoverT] = useState(() => (typeof state.project?.posterAt === 'number' ? state.project.posterAt : 0));
  const dialog = useRef(null);
  useEffect(() => { const previous=document.activeElement;return () => {if(previous?.isConnected)previous.focus();}; },[]);
  useEffect(() => {
    const element=dialog.current;
    if(state.ready)element?.querySelector(`[aria-label="${t('export.output_file_name')}"]`)?.focus();
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
          <h3 id="export-title">{t('export.export_failed')}</h3>
          <pre className="error-log">{state.error}</pre>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>{t('app.close')}</button>
            {state.project && state.eff && <button className="btn btn-primary" onClick={onStart}>{t('export.try_again')}</button>}
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
          <h3 id="export-title">{state.review ? t('export.section_preview_ready') : t('export.export_complete')}</h3>
          {state.review && <video className="review-video" controls preload="metadata" src={toFileUrl(state.file)} aria-label={t('export.rendered_section_preview')} />}
          {state.review && <p className="export-dialog-note">{t('export.play_this_section_to_check_the_motion_and')}</p>}
          {state.review && state.metadata && <p className="export-dialog-note">{fmtDur(state.metadata.duration_sec)} · {state.metadata.width}×{state.metadata.height} · {state.metadata.fps} fps</p>}
          {!state.review && <div className="export-file">
            <span className="export-file-name">{String(state.file || '').split(/[\\/]/).pop()}</span>
            <span className="export-file-path">{state.file}</span>
            {state.size ? <span className="export-file-path">{t('export.size_mb', { size: fmtMB(state.size / 1e6) })}</span> : null}
          </div>}
          {state.coverNote && <p className="export-dialog-note">{state.coverNote}</p>}
          {Number.isFinite(state.elapsedSeconds) && <p className="export-dialog-note">{t('export.completed_in_time', { time: formatElapsed(state.elapsedSeconds) })}</p>}
          <div className="modal-actions">
            {!state.review && <button className="btn" onClick={onShow}><FolderOpen size={15} /> {t('activity.show_in_folder')}</button>}
            <button className="btn" onClick={onOpen}><Play size={15} /> {state.review ? t('export.open_in_player') : t('export.open_file')}</button>
            <button className="btn btn-primary" onClick={onClose}>{state.review ? t('app.close') : t('export.ok')}</button>
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
        [t('home.name'), fileName],
        [t('animation-panel.duration'), fmtDur(dur)],
        [t('pack.video'), `${eff.outW}×${eff.outH} · ${eff.outFps} fps`],
        [t('home.format'), `MP4 · ${eff.codecLabel}`],
      ];
      const extraSpecs = [
        [t('export.size'), est.exact ? t('export.size_mb', { size: fmtMB(est.mb) }) : t('export.approx_mb_estimate', { size: fmtMB(est.mb) })],
        [t('export.bitrate'), eff.mode === 'bitrate' ? t('export.mbps_value', { mbps: eff.bitrateMbps }) : t('export.crf_approx_mbps', { crf: eff.crf, mbps: est.videoMbps.toFixed(1) })],
        [t('export.color_space'), 'Rec. 709 SDR'],
      ];
      return (
        <div ref={dialog} onKeyDown={dialogKeys} tabIndex={-1} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="modal export-modal">
            <div className="x-head">
              <h3 id="export-title">{t('export.exporting_video')}</h3>
            </div>
            <div className="x-enc-body">
              <Cover project={project} coverT={coverT} setCoverT={setCoverT} choosing={false} setChoosing={setChoosing} onPosterAt={onPosterAt} onPosterImage={onPosterImage} readOnly />
              <div className="x-specs">
                {[...specs,...(encodingDetails?extraSpecs:[])].map(([k, v]) => (
                  <div key={k} className="export-summary-row"><span>{k}</span><b>{v}</b></div>
                ))}
                <button type="button" className="x-details-toggle" onClick={() => setEncodingDetails(!encodingDetails)} aria-expanded={encodingDetails}>
                  <ChevronDown size={14} style={{transform:encodingDetails?'rotate(180deg)':'none'}} /> {encodingDetails ? t('export.hide_details') : t('export.export_details')}
                </button>
              </div>
            </div>
            <div className="x-enc-foot">
              <div className="x-enc-status">
                <div className="x-ring sm" aria-hidden="true" />
                <span className="x-enc-stage" aria-live="polite">{state.stopping ? t('export.stopping_export') : state.phase === 'encode' && state.phaseProgress >= .995 ? t('export.saving_video') : `${state.stage || t('export.encoding_video')}…`}</span>
                <span className="x-enc-pct">{pct}%</span>
              </div>
              <div className="progress big x-bar" role="progressbar" aria-label={t('export.export_progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
              <div className="x-export-timing">
                <strong className="x-export-eta" title={t('export.an_estimate_based_on_the_remaining_work_an')}>{state.stopping ? t('export.waiting_for_export_to_stop') : formatRemaining(state.remainingSeconds) || (state.phaseProgress >= .995 || state.phase === 'finish' ? t('export.finishing_this_step') : `${state.timingStatus || t('export.estimating_time_remaining')}…`)}</strong>
                <span>{t('export.elapsed_time', { time: formatElapsed(state.elapsedSeconds) })}</span>
              </div>
              <div className="x-export-step">
                <span>{state.step && state.steps ? t('export.step_of', { step: state.step, steps: state.steps }) : ''}</span>
                {state.encoder && <span>{/videotoolbox|nvenc|qsv|amf/.test(state.encoder) ? t('export.hardware_accelerated') : t('export.software_encoding')}</span>}
              </div>
              <div className="x-enc-actions">
                <button className="btn btn-ghost" disabled={state.stopping || state.phase === 'finish'} onClick={onCancel}>{state.stopping ? t('export.stopping') : t('export.cancel_export')}</button>
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
            <h3 id="export-title">{state.stage || t('export.encoding_video')}…</h3>
            <div className="progress big x-bar" role="progressbar" aria-label={t('export.export_progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
            <div className="x-pct">{pct}%</div>
            <button className="btn btn-ghost" onClick={onCancel}>{t('app.cancel')}</button>
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
          <h3 id="export-title">{t('export.export_video')}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('app.close')}><X size={16} /></button>
        </div>
        <div className="x-body">
          <Cover project={project} coverT={coverT} setCoverT={setCoverT} choosing={choosing} setChoosing={setChoosing} onPosterAt={onPosterAt} onPosterImage={onPosterImage} />
          <div className="x-form">
            <MediaCredits project={project} />
            <Row label={t('home.name')}>
              <input type="text" value={state.name || ''} onChange={(e) => onRename(e.target.value)} aria-label={t('export.output_file_name')} />
            </Row>
            <Row label={t('export.export_to')}>
              <span className="x-path" title={state.target?.file || ''}>{state.target ? state.target.file : t('export.not_chosen_yet')}</span>
              <button type="button" className="btn btn-sm" onClick={() => onPickTarget(state.name)}>{t('export.browse')}</button>
            </Row>
            <Row label={t('export.resolution')}>
              <Dropdown value={eff.resCap} ariaLabel={t('export.resolution')} onChange={(v) => onResolution(v)}
                options={[
                  { value: 0, label: t('export.native_size', { width: project.width, height: project.height }) },
                  ...capsList.map((c) => ({ value: c, label: c >= longest ? t('export.p_above_project_size', { height: c }) : `${c}p`, disabled: c >= longest })),
                ]} />
            </Row>
            <Row label={t('export.quality')}>
              <Dropdown value={eff.preset} ariaLabel={t('export.quality')}
                onChange={(v) => onSettings(settingsPatch(project, { preset: v, custom }))}
                options={EXPORT_PRESET_ORDER.map((id) => ({ value: id, label: id === 'custom' ? t('curve-editor.custom') : EXPORT_PRESETS[id].name }))} />
            </Row>
            {eff.preset === 'custom' && (
              <div className="x-custom">
                <Row label={t('export.mode')}>
                  <div className="seg-tabs x-seg" role="tablist" aria-label={t('export.quality_mode')}>
                    <button type="button" role="tab" aria-selected={custom.mode === 'crf'} className={custom.mode === 'crf' ? 'on' : ''} onClick={() => setCustom({ mode: 'crf' })}>{t('export.crf')}</button>
                    <button type="button" role="tab" aria-selected={custom.mode === 'bitrate'} className={custom.mode === 'bitrate' ? 'on' : ''} onClick={() => setCustom({ mode: 'bitrate' })}>{t('export.bitrate')}</button>
                  </div>
                </Row>
                {custom.mode === 'crf' ? (
                  <Row label={t('export.crf')}>
                    <input type="range" min="0" max="51" step="1" value={custom.crf} aria-label={t('export.crf')}
                      onChange={(e) => setCustom({ crf: Number(e.target.value) })} />
                    <span className="x-num">{custom.crf}</span>
                  </Row>
                ) : (
                  <Row label={t('export.bitrate')}>
                    <input type="number" min="0.5" max="100" step="0.5" value={custom.bitrateMbps} aria-label={t('export.bitrate_in_megabits_per_second')}
                      onChange={(e) => setCustom({ bitrateMbps: Number(e.target.value) })} />
                    <span className="x-num">{t('export.mbps')}</span>
                  </Row>
                )}
                <Row label={t('export.codec')}>
                  <Dropdown value={custom.codec} onChange={(v) => setCustom({ codec: v })} ariaLabel={t('export.codec')}
                    options={[
                      { value: 'h264', label: 'H.264' },
                      { value: 'h265', label: state.caps && state.caps.libx265 === false && !state.caps.h265Hardware ? t('export.h265_not_in_this_build') : 'H.265', disabled: state.caps && state.caps.libx265 === false && !state.caps.h265Hardware },
                    ]} />
                </Row>
                <Row label={t('home.frame_rate')}>
                  <Dropdown value={custom.fps} onChange={(v) => setCustom({ fps: v })} ariaLabel={t('home.frame_rate')}
                    options={FPS_CHOICES.map((f) => ({ value: f, label: f === 0 ? t('export.project_fps', { fps: project.fps }) : `${f} fps` }))} />
                </Row>
                <Row label={t('export.encoder')}>
                  <Dropdown value={custom.encoderPreset} onChange={(v) => setCustom({ encoderPreset: v })} ariaLabel={t('inspector.encoder_preset')}
                    options={ENCODER_PRESETS.map((p) => ({ value: p, label: p }))} />
                </Row>
                <Row label={t('edit-plan-card.audio')}>
                  <Dropdown value={custom.audioKbps} onChange={(v) => setCustom({ audioKbps: v })} ariaLabel={t('inspector.audio_bitrate')}
                    options={AUDIO_RATES.map((a) => ({ value: a, label: `${a} kbps` }))} />
                </Row>
              </div>
            )}
            <Row label={t('home.format')}><span className="x-static">MP4</span></Row>
            <Row label={t('export.est_bitrate')}><span className="x-static">{est.exact ? t('export.mbps_value', { mbps: est.videoMbps }) : t('export.approx_mbps', { mbps: est.videoMbps.toFixed(1) })}</span></Row>
            <button type="button" className="x-details-toggle" onClick={() => setDetails(!details)} aria-expanded={details}>
              <ChevronDown size={14} style={{ transform: details ? 'rotate(180deg)' : 'none' }} /> {t('export.export_summary')}
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
          <span className="x-foot-meta" title={est.exact ? t('export.size_from_bitrate_settings') : t('export.size_estimated_from_settings')}>
            {t(est.exact ? 'export.duration_and_size' : 'export.duration_and_size_approx', { duration: fmtDur(dur), size: fmtMB(est.mb) })}
          </span>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>{t('app.cancel')}</button>
            <button className="btn btn-primary" onClick={onStart}>{t('topbar.export')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
