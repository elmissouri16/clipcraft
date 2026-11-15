import PluginActionsMenu from '../../features/plugins/components/PluginActionsMenu.jsx';
import { useState } from 'react';
import { ArrowUpFromLine, AudioLines, Check, ChevronDown, CircleAlert, Film, FolderOpen, Home, Loader2, Save, Settings, PanelsTopLeft } from 'lucide-react';
import ContextMenu from "../../components/ui/ContextMenu.jsx";
import { RATIOS, sizeFor } from "../../features/effects/effects.js";
import { shortcutHint } from '../keymap.js';
import { t } from '../../i18n/index.js';

// The editor's top bar (docs/design/editor-usability.md, "Top bar"): brand on the left; in the centre the
// project's name, its format and a quiet autosave status; on the right the workspace switch, Export and
// Settings. File actions (Projects, Open, Save, Save as) live in the project menu behind the chevron next
// to the name, as in the native menu and the shortcuts; the one visible Save button exists only while the
// project has never been saved, since a project saves itself once it has a file.
const SAVE_STATES = {
  new: ['', t('topbar.not_saved_yet_click_save_once')],
  saving: [t('topbar.saving'), t('topbar.saving_to_the_project_file')],
  saved: [t('topbar.saved'), t('topbar.every_change_is_saved_automatically')],
  error: [t('topbar.not_saved'), t('topbar.the_project_file_could_not_be_written')],
};

export default function TopBar({ agentBadge = null, workspaceMode = 'edit', onWorkspaceModeChange, project, dispatch, onOpen, onSave, saveState = 'new', onExport, onExportAudio, onSettings, onHome, onPluginPanels,pluginActions,onManagePlugins }) {
  const [menu, setMenu] = useState(null); // export menu
  const [projectMenu, setProjectMenu] = useState(null);
  const set = (patch) => dispatch({ type: 'setProject', patch, transient: true });
  const status = SAVE_STATES[saveState] || SAVE_STATES.new;
  const openProjectMenu = (e) => { const r = e.currentTarget.getBoundingClientRect(); setProjectMenu({ x: r.left, y: r.bottom + 6 }); };
  return (
    <>
    <header className="topbar">
      <div className="brand">
        <img src="./logo.png" alt="" className="brand-logo" draggable={false} />
        <span className="brand-name">Clip<b>Craft</b></span>
      </div>

      <div className="top-center">
        <div className="project-meta">
          <input className="project-name" value={project.name} aria-label={t('topbar.project_name')} spellCheck={false}
            onChange={(e) => set({ name: e.target.value })} />
          <button type="button" className="icon-btn sm project-menu-btn" aria-label={t('topbar.project_menu')} title={t('topbar.project_menu')} aria-haspopup="menu" aria-expanded={!!projectMenu} onClick={openProjectMenu}>
            <ChevronDown size={14} />
          </button>
          <select className="ratio-select" value={project.ratio} aria-label={t('topbar.aspect_ratio')}
            onChange={(e) => dispatch({ type: 'setProject', patch: { ratio: e.target.value, ratioLocked: true, ...sizeFor(e.target.value, project.resolution) } })}>
            {Object.keys(RATIOS).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {saveState === 'new' ? (
            <button type="button" className="btn btn-sm save-now" onClick={(e) => onSave(e.altKey)} aria-label={t('close.save')} title={status[1]}><Save size={13} /> {t('close.save')}</button>
          ) : saveState === 'error' ? (
            <button type="button" className="save-state error" onClick={() => onSave(false)} title={status[1]}><CircleAlert size={12} /> {status[0]}</button>
          ) : (
            <span className={`save-state ${saveState}`} role="status" title={status[1]}>
              {saveState === 'saving' ? <Loader2 size={12} className="spin" /> : <Check size={12} />} {status[0]}
            </span>
          )}
        </div>
      </div>

      <div className="top-workspace-actions top-actions">
        {agentBadge}
        <div className="workspace-switch" role="group" aria-label={t('topbar.workspace_mode')}>
          {['edit', 'agent'].map(mode => <button key={mode} type="button" aria-pressed={workspaceMode === mode} onClick={() => onWorkspaceModeChange(mode)}>{mode === 'edit' ? t('timeline.edit') : t('topbar.agent')}</button>)}
        </div>
        <div className="export-split top-export">
          <button className="btn btn-export" onClick={onExport}><ArrowUpFromLine size={15} /> {t('topbar.export')}</button>
          <button className="btn btn-export caret" aria-label={t('topbar.more_export_options')} aria-haspopup="menu"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
            <ChevronDown size={15} />
          </button>
        </div>
        {pluginActions&&<PluginActionsMenu actions={pluginActions} onManage={onManagePlugins}/>}
        <button className="icon-btn plugin-panels-toggle" onClick={onPluginPanels} aria-label={t('plugins.panels')} title={t('plugins.panels')}><PanelsTopLeft size={17}/></button>
        <button className="icon-btn settings-btn" onClick={onSettings} aria-label={t('home.settings')} title={t('home.settings')}><Settings size={17} /></button>
      </div>
    </header>
      {/* Fixed-position menus stay outside the header's size container. */}
      {projectMenu && (
        <ContextMenu x={projectMenu.x} y={projectMenu.y} label={t('topbar.project_menu')} onClose={() => setProjectMenu(null)} items={[
          { label: t('home.projects'), icon: Home, onClick: onHome },
          { label: t('topbar.open_project'), icon: FolderOpen, onClick: onOpen },
          'sep',
          { label: t('close.save'), icon: Save, onClick: () => onSave(false), shortcut: shortcutHint('save') },
          { label: t('keymap.save_as'), icon: Save, onClick: () => onSave(true), shortcut: shortcutHint('saveAs') },
        ]} />
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={t('topbar.export')} onClose={() => setMenu(null)} items={[
          { label: t('topbar.video_mp4'), icon: Film, onClick: onExport },
          'sep',
          { label: t('topbar.audio_only_mp3'), icon: AudioLines, onClick: () => onExportAudio('mp3') },
          { label: t('topbar.audio_only_wav'), icon: AudioLines, onClick: () => onExportAudio('wav') },
          { label: t('topbar.audio_only_m4a'), icon: AudioLines, onClick: () => onExportAudio('m4a') },
        ]} />
      )}
    </>
  );
}
