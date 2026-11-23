import {ExtensionActions,useExtensionMenu} from '../../features/plugins/components/ExtensionNativeUi.jsx';

import { useRef, useState } from 'react';
import { ArrowUpFromLine, AudioLines, Check, ChevronDown, CircleAlert, Film, FolderOpen, Home, Loader2, Save, Settings } from 'lucide-react';
import ContextMenu from "../../components/ui/ContextMenu.jsx";
import { shortcutHint } from '../keymap.js';
import { t } from '../../i18n/index.js';

// Once a project has a file, its autosave status takes the place of the Save button.
const SAVE_STATES = {
  new: ['', t('topbar.not_saved_yet_click_save_once')],
  saving: [t('topbar.saving'), t('topbar.saving_to_the_project_file')],
  saved: [t('topbar.saved'), t('topbar.every_change_is_saved_automatically')],
  error: [t('topbar.not_saved'), t('topbar.the_project_file_could_not_be_written')],
};

export default function TopBar({ agentBadge = null, workspaceMode = 'edit', onWorkspaceModeChange, project, onOpen, onSave, saveState = 'new', onExport, onExportAudio, onSettings, onHome, onPluginPanels,onManagePlugins,onExtensionError }) {
  const extensionProjectItems=useExtensionMenu('menu.project',{},onExtensionError);
  const [menu, setMenu] = useState(null); // export menu
  const [projectMenu, setProjectMenu] = useState(null);
  const projectButton = useRef(null);
  const projectName = String(project.name ?? '').trim() || t('home.untitled');
  const status = SAVE_STATES[saveState] || SAVE_STATES.new;
  const toggleProjectMenu = (e) => {
    const { left, bottom } = e.currentTarget.getBoundingClientRect();
    setProjectMenu(open => open ? null : { x: left, y: bottom + 6 });
  };
  const closeProjectMenu = (reason) => {
    setProjectMenu(null);
    if (reason === 'escape') projectButton.current?.focus();
  };
  return (
    <>
    <header className="topbar">
      <div className="top-center">
        <div className="project-meta">
          <button type="button" ref={projectButton} className="btn btn-sm btn-ghost project-menu-btn"
            aria-label={t('topbar.project_menu')} title={projectName} aria-haspopup="menu" aria-expanded={!!projectMenu} onClick={toggleProjectMenu}>
            {t('inspector.project')} <ChevronDown size={14} aria-hidden="true" />
          </button>
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
        <div className="top-workspace-group">
          {agentBadge}
          <div className="workspace-switch" role="group" aria-label={t('topbar.workspace_mode')}>
            {['edit', 'agent'].map(mode => <button key={mode} type="button" aria-pressed={workspaceMode === mode} onClick={() => onWorkspaceModeChange(mode)}>{mode === 'edit' ? t('timeline.edit') : t('topbar.agent')}</button>)}
          </div>
        </div>
        <ExtensionActions location="toolbar" onManagePlugins={onManagePlugins} onPluginPanels={onPluginPanels}/>
        <button type="button" className="btn btn-sm btn-ghost settings-btn" onClick={onSettings} aria-label={t('home.settings')}><Settings size={15} aria-hidden="true"/>{t('home.settings')}</button>
        <div className="export-split top-export">
          <button className="btn btn-export" onClick={onExport}><ArrowUpFromLine size={15} /> {t('topbar.export')}</button>
          <button className="btn btn-export caret" aria-label={t('topbar.more_export_options')} aria-haspopup="menu"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
            <ChevronDown size={15} />
          </button>
        </div>

      </div>
    </header>
      {/* Fixed-position menus stay outside the header's size container. */}
      {projectMenu && (
        <ContextMenu x={projectMenu.x} y={projectMenu.y} label={t('topbar.project_menu')} heading={projectName}
          triggerRef={projectButton} onClose={closeProjectMenu} items={[
          { label: t('home.projects'), icon: Home, onClick: onHome },
          { label: t('topbar.open_project'), icon: FolderOpen, onClick: onOpen },
          'sep',
          { label: t('close.save'), icon: Save, onClick: () => onSave(false), shortcut: shortcutHint('save') },
          { label: t('keymap.save_as'), icon: Save, onClick: () => onSave(true), shortcut: shortcutHint('saveAs') },
          ...(extensionProjectItems.length?['sep',...extensionProjectItems]:[]),
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
