import React from 'react';
import { CircleAlert, CircleCheck, Clapperboard, FolderOpen, Loader2 } from 'lucide-react';
import { summaryRows } from '../exportQuality.js';

export default function ExportDialog({ state, onCancel, onClose, onShow, onStart }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="modal">
        {state.error ? (
          <>
            <div className="modal-icon error"><CircleAlert size={26} /></div>
            <h3 id="export-title">Export failed</h3>
            <pre className="error-log">{state.error}</pre>
            <button className="btn" onClick={onClose}>Close</button>
          </>
        ) : state.done ? (
          <>
            <div className="modal-icon ok"><CircleCheck size={26} /></div>
            <h3 id="export-title">Export complete</h3>
            <div className="export-file">
              <span className="export-file-name">{String(state.file || '').split(/[\\/]/).pop()}</span>
              <span className="export-file-path">{state.file}</span>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onShow}><FolderOpen size={15} /> Show in folder</button>
              <button className="btn btn-primary" onClick={onClose}>OK</button>
            </div>
          </>
        ) : state.ready ? (
          <>
            <div className="modal-icon"><Clapperboard size={26} /></div>
            <h3 id="export-title">Export video</h3>
            <div className="export-summary">
              {summaryRows(state.eff, state.project).map(([k, v]) => (
                <div key={k} className="export-summary-row"><span>{k}</span><b>{v}</b></div>
              ))}
            </div>
            {state.eff.notes.map((n) => <p key={n} className="export-dialog-note">{n}</p>)}
            <p className="export-dialog-note">Change these in Project Settings → Export quality.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={onStart}>Choose file &amp; export</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-icon"><Loader2 size={26} className="spin" /></div>
            <h3 id="export-title">{state.stage || 'Exporting MP4'}…</h3>
            <div className="progress big" aria-live="polite"><div style={{ width: `${(state.progress * 100).toFixed(1)}%` }} /></div>
            <p className="pct">{(state.progress * 100).toFixed(0)}%</p>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
