import React from 'react';
import { MonitorCog, ShieldCheck } from 'lucide-react';
import { t } from '../../../i18n/index.js';

// Shown when media placed on the main track does not match the project sequence
// (resolution, aspect ratio or frame rate). Nothing changes until the user picks:
// adopt the clip's settings as the sequence, or keep the sequence and adapt the clip.
export default function SequenceDialog({ media, mismatch, onChangeSettings, onKeepSettings }) {
  const { video, project, fields } = mismatch;
  const unknown = t('sequence-dialog.unknown');
  const fps = (value) => (value ? t('sequence-dialog.fps_value', { fps: value }) : unknown);
  const rows = [
    { key: 'resolution', label: t('export.resolution'), v: `${video.w} × ${video.h}`, p: `${project.w} × ${project.h}` },
    { key: 'ratio', label: t('topbar.aspect_ratio'), v: video.ratio || unknown, p: project.ratio || unknown },
    { key: 'fps', label: t('home.frame_rate'), v: fps(video.fps), p: fps(project.fps) },
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="seq-title">
      <div className="modal seq-modal">
        <h3 id="seq-title">{t('sequence-dialog.the_imported_video_doesnt_match_your_proje')}</h3>
        <p className="muted">{t('sequence-dialog.name_differs_from_sequence', { name: media.name })}</p>
        <div className="seq-diff">
          <div className="seq-col">
            <span className="seq-col-title">{t('sequence-dialog.imported_video')}</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.v}</b>
              </div>
            ))}
          </div>
          <div className="seq-col">
            <span className="seq-col-title">{t('library.this_project')}</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.p}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions seq-actions">
          <button className="btn btn-primary" onClick={onChangeSettings}>
            <MonitorCog size={15} /> {t('sequence-dialog.change_project_settings')}
          </button>
          <button className="btn" onClick={onKeepSettings}>
            <ShieldCheck size={15} /> {t('sequence-dialog.keep_current_settings')}
          </button>
        </div>
        <p className="muted small">{video.fps ? t('sequence-dialog.change_makes_sequence_fps', { width: video.w, height: video.h, fps: Math.round(video.fps) }) : t('sequence-dialog.change_makes_sequence', { width: video.w, height: video.h })}</p>
      </div>
    </div>
  );
}
