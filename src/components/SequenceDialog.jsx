import React from 'react';
import { MonitorCog, ShieldCheck } from 'lucide-react';

// Shown when media placed on the main track does not match the project sequence
// (resolution, aspect ratio or frame rate). Nothing changes until the user picks:
// adopt the clip's settings as the sequence, or keep the sequence and adapt the clip.
export default function SequenceDialog({ media, mismatch, onChangeSettings, onKeepSettings }) {
  const { video, project, fields } = mismatch;
  const rows = [
    { key: 'resolution', label: 'Resolution', v: `${video.w} × ${video.h}`, p: `${project.w} × ${project.h}` },
    { key: 'ratio', label: 'Aspect ratio', v: video.ratio || '—', p: project.ratio || '—' },
    { key: 'fps', label: 'Frame rate', v: video.fps ? `${video.fps} fps` : 'Unknown', p: project.fps ? `${project.fps} fps` : 'Unknown' },
  ];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="seq-title">
      <div className="modal seq-modal">
        <h3 id="seq-title">The imported video doesn’t match your project settings.</h3>
        <p className="muted">“{media.name}” differs from this project’s sequence. Choose what should happen — nothing has been changed yet.</p>
        <div className="seq-diff">
          <div className="seq-col">
            <span className="seq-col-title">Imported video</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.v}</b>
              </div>
            ))}
          </div>
          <div className="seq-col">
            <span className="seq-col-title">This project</span>
            {rows.map((r) => (
              <div key={r.key} className={`seq-row ${fields.includes(r.key) ? 'diff' : ''}`}>
                <span>{r.label}</span><b>{r.p}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-actions seq-actions">
          <button className="btn btn-primary" onClick={onChangeSettings}>
            <MonitorCog size={15} /> Change project settings
          </button>
          <button className="btn" onClick={onKeepSettings}>
            <ShieldCheck size={15} /> Keep current settings
          </button>
        </div>
        <p className="muted small">“Change project settings” makes the sequence {video.w} × {video.h}{video.fps ? ` at ${Math.round(video.fps)} fps` : ''} before the clip is added. “Keep” adds the clip and fits it into the current frame.</p>
      </div>
    </div>
  );
}
