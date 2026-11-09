import { useState } from 'react';
import { AudioLines, Check, ChevronDown, CircleAlert, Download, Film, FolderOpen, Home, Save, Settings } from 'lucide-react';
import ContextMenu from "../../components/ui/ContextMenu.jsx";
import { RATIOS, sizeFor } from "../../features/effects/effects.js";

// Save state: the project saves itself once it has a file.
const SAVE_STATES = {
  new: ['', 'Not saved yet: click Save (Ctrl+S) once, then every change is saved automatically'],
  saving: ['Saving…', 'Saving to the project file'],
  saved: ['Saved', 'Every change is saved automatically to the project file. Ctrl+Alt+S: save as'],
  error: ['Not saved', 'The project file could not be written. Click Save to choose another place'],
};

export default function TopBar({ agentBadge = null, workspaceMode = 'edit', onWorkspaceModeChange, project, dispatch, onOpen, onSave, saveState = 'new', onExport, onExportAudio, onSettings, onHome, updateReady = false }) {
  const [menu, setMenu] = useState(null);
  const set = (patch) => dispatch({ type: 'setProject', patch, transient: true });
  return (
    <>
    <header className="topbar">
      <div className="brand">
        <img src="./logo.png" alt="" className="brand-logo" draggable={false} />
        <span className="brand-name">Clip<b>Craft</b></span>
      </div>

      <div className="top-center">
        <div className="project-meta">
          <input className="project-name" value={project.name} aria-label="Project name" spellCheck={false}
            onChange={(e) => set({ name: e.target.value })} />
          <select className="ratio-select" value={project.ratio} aria-label="Aspect ratio"
            onChange={(e) => dispatch({ type: 'setProject', patch: { ratio: e.target.value, ratioLocked: true, ...sizeFor(e.target.value, project.resolution) } })}>
            {Object.keys(RATIOS).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="top-actions">
          <button className="btn btn-ghost" onClick={onHome} aria-label="Projects" title="Back to projects (home)"><Home size={15} /> <span className="top-word">Projects</span></button>
          <span className="top-sep" aria-hidden="true" />
          <button className="btn btn-ghost" onClick={onOpen} aria-label="Open" title="Open a project"><FolderOpen size={15} /> <span className="top-word">Open</span></button>
          <button className="btn btn-ghost" onClick={(e) => onSave(e.altKey)} aria-label="Save" title={SAVE_STATES[saveState][1]}>
            <span className="save-icon" aria-hidden="true"><Save size={15} />{saveState === 'saved' && <Check size={10} className="save-check" />}</span>
            <span className="top-word">Save</span>
          </button>
          {SAVE_STATES[saveState][0] && (
            <span className={`save-state ${saveState}`} title={SAVE_STATES[saveState][1]} role="status">
              {saveState === 'error' ? <CircleAlert size={13} /> : null} {SAVE_STATES[saveState][0]}
            </span>
          )}
          <button className="icon-btn settings-btn" onClick={onSettings} aria-label="Settings"
            title={updateReady ? 'Settings: an update is available' : 'Settings'}>
            <Settings size={17} />{updateReady && <i className="update-dot" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="top-workspace-actions">
        {agentBadge}
        <div className="workspace-switch" role="group" aria-label="Workspace mode">
          {['edit', 'agent'].map(mode => <button key={mode} type="button" aria-pressed={workspaceMode === mode} onClick={() => onWorkspaceModeChange(mode)}>{mode === 'edit' ? 'Edit' : 'Agent'}</button>)}
        </div>
      <div className="export-split top-export">
        <button className="btn btn-export" onClick={onExport}><Download size={15} /> Export</button>
        <button className="btn btn-export caret" aria-label="More export options" aria-haspopup="menu"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
          <ChevronDown size={15} />
        </button>
      </div>
      </div>
    </header>
      {/* Fixed-position menus stay outside the header's size container. */}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="Export" onClose={() => setMenu(null)} items={[
          { label: 'Video (MP4)', icon: Film, onClick: onExport },
          'sep',
          { label: 'Audio only (MP3)', icon: AudioLines, onClick: () => onExportAudio('mp3') },
          { label: 'Audio only (WAV)', icon: AudioLines, onClick: () => onExportAudio('wav') },
          { label: 'Audio only (M4A)', icon: AudioLines, onClick: () => onExportAudio('m4a') },
        ]} />
      )}
    </>
  );
}
