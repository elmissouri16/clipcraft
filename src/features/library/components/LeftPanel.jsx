import {packTextTemplates,useCreativePacks,preferredPackLuts,preferredPackColors,colorPresetPatch} from '../../plugins/creativeRegistry.js';
import { useEffect, useRef, useState } from 'react';
import {
  Blend, Captions as CaptionsIcon, Contrast, Film, FolderOpen, ImagePlus, Music, Plus, SlidersHorizontal,
  Sparkles, Trash2, Type, Upload, WandSparkles, X, Layers, ChevronDown, ChevronRight, ChevronUp, MonitorUp, LayoutTemplate, Mic, List,
} from 'lucide-react';
import AssetsTab from './AssetsPanel.jsx';
import { useAssets } from '../useAssets.js';
import { mediaTreeCounts, mediaTreeFilter } from '../assetsLib.js';
import GradePanel from "../../effects/components/GradePanel.jsx";
import { LookThumb } from "../../effects/components/FilterThumbs.jsx";
import { FILTER_CATS, filterFxLook, filterName } from "../../effects/filters.js";
import { loadPresets, savePresets, upsertPreset, removePreset, presetPatch } from "../../effects/presets.js";
import { BUNDLED_LUTS } from "../../effects/lut.js";
import { loadLutLibrary, saveLutLibrary, addLutEntry, removeLutEntry } from "../../effects/lutlib.js";
import { formatTime, previewPath, proxyPrefOn, toFileUrl, uid } from "../../../state/store.js";
import { COLLECTIONS, PACKS, COLLECTION_ITEMS, loadFavorites, saveFavorites, toggleFavorite } from "../../effects/collections.js";
import { parseSRT, regroupSegments } from "../../text/subtitles.js";
import { allEffects, EFFECT_GROUPS, FILTERS, TRANSITIONS, allTransitions } from "../../effects/effects.js";
import { dragProps } from "../../timeline/dnd.js";
import Slider from "../../../components/ui/Slider.jsx";
import Dropdown from '../../../components/ui/Dropdown.jsx';
import SearchBox from "../../../components/ui/SearchBox.jsx";
import AudioLibrary from "../../audio/components/AudioLibrary.jsx";
import StockLibrary from './StockLibrary.jsx';
import { TabFrame } from './TabFrame.jsx';
import { FxThumb } from "../../effects/previews.jsx";
import MediaFavorites from './MediaFavorites.jsx';
import { FavStar, favFile } from "../../../app/favorites.jsx";
import { TemplateGrid } from "../../text/components/TextInspector.jsx";
import { TEMPLATE_CATEGORIES, TEXT_TEMPLATES } from "../../text/catalog.js";
import { t, tn, formatNumber } from '../../../i18n/index.js';
import { catalogLabel, catalogName, filterLabel } from '../../../i18n/catalog.js';

export const TABS = [
  { id: 'media', icon: Film, name: t('app.media') },
  { id: 'audio', icon: Music, name: t('edit-plan-card.audio') },
  { id: 'assets', icon: LayoutTemplate, name: t('assets-panel.assets') },
  { id: 'text', icon: Type, name: t('tts.text') },
  { id: 'effects', icon: WandSparkles, name: t('library.effects') },
  { id: 'transitions', icon: Blend, name: t('library.transitions') },
  { id: 'captions', icon: CaptionsIcon, name: t('edit-plan-card.captions') },
  { id: 'filters', icon: Contrast, name: t('audio-fx.filters') },
  { id: 'adjust', icon: SlidersHorizontal, name: t('grade.adjust') },
];

// Default category of each tab (the side column remembers the last one per tab).
const SUB_DEFAULT = { media: 'yours', audio: 'auto', text: 'All' };

export default function LeftPanel(props) {
  const { tab, setTab } = props;
  // A stale tab id (e.g. from an older version's saved UI state) falls back to Media.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'media';
  const [sub, setSubState] = useState(SUB_DEFAULT);
  const setSub = (id) => setSubState((s) => ({ ...s, [activeTab]: id }));
  const browserMemory = useRef(new Map());
  const p = { ...props, sub: sub[activeTab], setSub, browserMemory: browserMemory.current };
  const dockRef = useRef(null);
  const [scroll, setScroll] = useState({ up: false, down: false });
  const measure = () => {
    const el = dockRef.current;
    if (el) setScroll({ up: el.scrollTop > 2, down: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
  };
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
  }, []);
  // Keep the active tab clear of the scroll arrows, e.g. after switching tabs from code or
  // when a short window opens on a lower tab.
  useEffect(() => {
    const dock = dockRef.current;
    const btn = dock?.querySelector('.dock-btn.active');
    if (!dock || !btn) return;
    const pad = 22;
    const top = btn.offsetTop - dock.offsetTop;
    if (top - pad < dock.scrollTop) dock.scrollTop = Math.max(0, top - pad);
    else if (top + btn.offsetHeight + pad > dock.scrollTop + dock.clientHeight) dock.scrollTop = top + btn.offsetHeight + pad - dock.clientHeight;
  }, [activeTab]);
  const scrollDock = (d) => dockRef.current.scrollBy({ top: d * 220, behavior: 'smooth' });
  return (
    <aside className="left">
      <div className="dock-wrap tabbar-wrap">
        {scroll.up && <button className="dock-arrow tabbar-arrow up" onClick={() => scrollDock(-1)} aria-label={t('library.more_tabs_above')}><ChevronUp size={14} /></button>}
        <nav className="dock tabbar" aria-label={t('library.library')} ref={dockRef} onScroll={measure}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} className={`dock-btn tab-btn ${activeTab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} aria-pressed={activeTab === t.id} title={t.name}>
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>{t.name}</span>
              </button>
            );
          })}
        </nav>
        {scroll.down && <button className="dock-arrow tabbar-arrow down" onClick={() => scrollDock(1)} aria-label={t('library.more_tabs_below')}><ChevronDown size={14} /></button>}
      </div>
      <div className="library">
        {activeTab === 'media' && <MediaTab {...p} />}
        {activeTab === 'audio' && <AudioTab {...p} />}
        {activeTab === 'assets' && <TabFrame><AssetsTab {...p} /></TabFrame>}
        {activeTab === 'text' && <TextTab {...p} />}
        {activeTab === 'effects' && <TabFrame><EffectsTab {...p} /></TabFrame>}
        {activeTab === 'transitions' && <TabFrame><TransitionsTab {...p} /></TabFrame>}
        {activeTab === 'captions' && <TabFrame><CaptionsTab {...p} /></TabFrame>}
        {activeTab === 'filters' && <TabFrame><FiltersTab {...p} /></TabFrame>}
        {activeTab === 'adjust' && <TabFrame><AdjustTab {...p} /></TabFrame>}
      </div>
    </aside>
  );
}

function Head({ title, hint, children }) {
  return (
    <div className="lib-head">
      <div>
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// A media item. Click selects it and plays it in the player (then Delete removes it), double-click adds it to the
// timeline.
function MediaCard({ m, onAdd, onRemove, onOverlay, onPeek, peeking }) {
  const onKeyDown = (e) => {
    if (!onRemove || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    // Handled here so the timeline's Delete shortcut does not also remove the selected clip.
    e.preventDefault();
    e.stopPropagation();
    onRemove(m.id);
  };
  return (
    <div className={`asset ${peeking ? 'peeking' : ''}`} tabIndex={0} {...dragProps({ kind: 'media', id: m.id, mediaType: m.type })} onKeyDown={onKeyDown}
      onClick={(e) => { if (onPeek && !e.target.closest('button')) onPeek(m.id); }}
      onDoubleClick={() => onAdd(m.id)}
      title={[m.name, onPeek ? t('library.click_to_watch_drag_or_double_click') : t('library.drag_to_the_timeline_or_double_click'), onRemove ? t('library.delete_remove_from_the_project') : ''].filter(Boolean).join('\n')}>
      <div className="asset-thumb">
        {m.type === 'video' && (m.poster ? (
          // W4b: the dedicated poster frame fills the card (object-fit: cover) — a portrait
          // video no longer renders as a thin strip in a wide black card.
          <img src={toFileUrl(m.poster)} alt="" draggable={false} />
        ) : m.thumb && m.thumbCount > 1 ? (
          // Sprite fallback (poster not generated yet): one frame, sized to COVER the
          // thumb box — the frame overflows on its long axis and the box crops it.
          <div className="asset-sprite" style={{
            aspectRatio: `${m.thumbW || 16} / ${m.thumbH || 9}`,
            [(m.thumbW || 16) / (m.thumbH || 9) < 4 / 3 ? 'width' : 'height']: '100%',
            backgroundImage: `url("${toFileUrl(m.thumb)}")`,
            backgroundSize: `${m.thumbCount * 100}% 100%`,
            backgroundPosition: `${(Math.min(1, m.thumbCount - 1) / (m.thumbCount - 1)) * 100}% 0`,
          }} />
        ) : <video src={toFileUrl(m.path) + '#t=0.5'} preload="metadata" muted />)}
        {m.type === 'image' && <img src={toFileUrl(m.path)} alt="" draggable={false} />}
        {m.type === 'audio' && (
          <div className="asset-audio">
            {m.wave ? <img src={toFileUrl(m.wave)} alt="" draggable={false} /> : <Music size={22} aria-hidden="true" />}
          </div>
        )}
        {m.type !== 'image' && <span className="asset-dur">{formatTime(m.duration).slice(0, 5)}</span>}
        {m.optimizing && <span className="asset-opt" title={t('library.making_a_light_preview_copy_so_this_video')}>{t('library.optimizing')}</span>}
        {!m.optimizing && proxyPrefOn() && previewPath(m) !== (m.proxy || m.path) && (
          <span className="asset-opt proxy" title={t('library.plays_from_a_scaled_proxy_copy_at_the_curr')}>{t('library.proxy')}</span>
        )}
        {m.graphic && <span className="asset-badge graphic" title={t('library.motion_graphic_edit_its_text_and_data_in_t')}>{t('library.graphic')}</span>}
        <button className="asset-add" onClick={() => onAdd(m.id)} aria-label={t('library.add_name_to_the_timeline', { name: m.name })} title={m.graphic ? t('library.add_over_the_whole_frame_at_the_playhead') : undefined}><Plus size={14} /></button>
        {onOverlay && m.type !== 'audio' && !m.graphic && (
          <button className="asset-add overlay" onClick={() => onOverlay(m.id)} aria-label={t('library.add_name_as_an_overlay', { name: m.name })}
            title={t('library.add_as_overlay_picture_in_picture')}><Layers size={13} /></button>
        )}
        {m.path && <FavStar entry={favFile(m)} className="asset-star" />}
        {onRemove && (
          <button className="asset-remove" onClick={() => onRemove(m.id)} aria-label={t('library.remove_name', { name: m.name })} title={t('library.remove_from_the_project_delete')}><Trash2 size={12} /></button>
        )}
      </div>
      <div className="asset-name">{m.name}</div>
    </div>
  );
}

function MediaTab({ media, onImport, onAdd, onRemoveMedia, onAddAsOverlay, onStockAdd, onAddFile, onOpenSettings, stockKey, sub, setSub, onRecordScreen, onPeek, peekId, browserMemory }) {
  const visual = media; // videos, photos and audio
  // One source switcher replaces the old second rail: Yours / Favorites / Stock live in a
  // segmented control at the top of the panel; Stock adds a kind switch + category chips.
  const [kind, chip] = sub.split(':');
  const view = sub === 'favorites' ? 'favorites' : (kind === 'video' || kind === 'photo') ? 'stock' : 'yours';
  const [lastStock, setLastStock] = useState(browserMemory.get('stock:last') || 'video:Trending');
  const goStock = id => { setLastStock(id); browserMemory.set('stock:last', id); const [k, c] = id.split(':'); browserMemory.set(`stock:category:${k}`, c); setSub(id); };
  // The kind tree over this project's media (Hamza's reference): Media by kind, plus a
  // Generated branch — Speech (text-to-speech output) and Processed (detach / reverse /
  // stabilize renders). Counts are computed live from the registry (src/features/library/assetsLib.js);
  // picking a node filters the grid below it.
  const [treeSel, setTreeSel] = useState('all');
  const [treeOpen, setTreeOpen] = useState({ media: true, gen: true });
  const counts = mediaTreeCounts(visual);
  const shownMedia = mediaTreeFilter(visual, treeSel);
  const treeNode = (id, label, n) => (
    <button key={id} className={`mt-node ${treeSel === id ? 'on' : ''}`} aria-pressed={treeSel === id} onClick={() => setTreeSel(id)}>
      <span>{label}</span><span className="mt-count">{n}</span>
    </button>
  );
  return (
    <TabFrame>
      <Head title={t('app.media')} hint={view === 'yours' ? t('library.videos_photos_and_audio_in_this_project') : view === 'favorites' ? t('library.your_starred_media_in_every_project') : t('library.stock_photos_and_videos')}>
        {view === 'yours' && <div className="head-btns">
          <button className="btn btn-sm" onClick={onRecordScreen} title={t('library.record_your_screen_a_window_the_computer_s')}><MonitorUp size={14} /> {t('audio.record')}</button>
          <button className="btn btn-primary btn-sm" onClick={onImport}><Upload size={14} /> {t('audio.import')}</button>
        </div>}
      </Head>
      <div className="browser-media-source"><Dropdown ariaLabel={t('library.media_source')} value={view} options={[{ value: 'yours', label: t('library.this_project') }, { value: 'favorites', label: t('library.favorites') }, { value: 'stock', label: t('library.stock') }]} onChange={value => value === 'stock' ? goStock(lastStock) : setSub(value)} /></div>
      <div className="src-seg seg-tabs" role="tablist" aria-label={t('library.media_source')}>
        <button role="tab" aria-selected={view === 'yours'} className={view === 'yours' ? 'on' : ''} onClick={() => setSub('yours')}>{t('library.this_project')}</button>
        <button role="tab" aria-selected={view === 'favorites'} className={view === 'favorites' ? 'on' : ''} onClick={() => setSub('favorites')}>{t('library.favorites')}</button>
        <button role="tab" aria-selected={view === 'stock'} className={view === 'stock' ? 'on' : ''} onClick={() => goStock(lastStock)}>{t('library.stock')}</button>
      </div>
      {view === 'yours' ? (
        !visual.length ? (
          <button className="dropzone" onClick={onImport}>
            <span className="dz-icon"><ImagePlus size={26} /></span>
            <b>{t('home.import_media')}</b>
            <span>{t('library.drag_videos_photos_and_audio_here_from_exp')}</span>
          </button>
        ) : (
          <>
            <label className="media-filter">
              <span>{t('library.show')}</span>
              <select aria-label={t('library.filter_project_media')} value={treeSel} onChange={e => setTreeSel(e.target.value)}>
                {[['all', t('library.all_media'), counts.all], ['video', t('pack.video'), counts.video], ['audio', t('edit-plan-card.audio'), counts.audio], ['image', t('library.images'), counts.image], ['graphic', t('library.graphics'), counts.graphic], ['speech', t('library.generated_speech'), counts.speech], ['processed', t('library.processed'), counts.processed]].map(([id, label, n]) => <option key={id} value={id}>{label} · {n}</option>)}
              </select>
            </label>
            <div className="media-tree">
              <button className="mt-head" aria-expanded={treeOpen.media} onClick={() => setTreeOpen((o) => ({ ...o, media: !o.media }))}>
                {treeOpen.media ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{t('app.media')}</span>
              </button>
              {treeOpen.media && (
                <div className="mt-nodes">
                  {treeNode('all', t('library.all_media'), counts.all)}
                  {treeNode('video', t('pack.video'), counts.video)}
                  {treeNode('audio', t('edit-plan-card.audio'), counts.audio)}
                  {treeNode('image', t('library.images'), counts.image)}
                </div>
              )}
              <button className="mt-head" aria-expanded={treeOpen.gen} onClick={() => setTreeOpen((o) => ({ ...o, gen: !o.gen }))}>
                {treeOpen.gen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{t('library.generated')}</span>
              </button>
              {treeOpen.gen && (
                <div className="mt-nodes">
                  {treeNode('graphic', t('library.graphics'), counts.graphic)}
                  {treeNode('speech', t('library.speech'), counts.speech)}
                  {treeNode('processed', t('library.processed'), counts.processed)}
                </div>
              )}
            </div>
            {shownMedia.length ? (
              <div className="asset-grid">
                {shownMedia.map((m) => <MediaCard key={m.id} m={m} onAdd={onAdd} onRemove={onRemoveMedia} onOverlay={onAddAsOverlay} onPeek={onPeek} peeking={peekId === m.id} />)}
              </div>
            ) : (
              <p className="empty-note">{treeSel === 'graphic'
                ? t('library.no_graphics_yet')
                : treeSel === 'speech'
                ? t('library.no_generated_speech_yet')
                : treeSel === 'processed'
                  ? t('library.no_processed_renders_yet')
                  : t('library.nothing_of_this_kind_in_the_project_yet')}</p>
            )}
          </>
        )
      ) : view === 'favorites' ? (
        <div className="pad-block">
          <MediaFavorites onStockAdd={onStockAdd} onAddFile={onAddFile} />
        </div>
      ) : (
        <div className="pad-block">
          <StockLibrary browserMemory={browserMemory} onNavigate={goStock} kind={kind} chip={chip} onStockAdd={onStockAdd} onOpenSettings={onOpenSettings} hasKey={stockKey} />
        </div>
      )}
    </TabFrame>
  );
}

function AudioTab(props) {
  const { sub, setSub, browserMemory } = props;
  const lib = useAssets();
  const packSubs = lib ? [...new Set(lib.items.filter(i => i.group === 'Music' && i.sub).map(i => i.sub))].sort((a, b) => a === 'Library' ? -1 : b === 'Library' ? 1 : a.localeCompare(b)) : [];
  const packSfxSubs = lib ? [...new Set(lib.items.filter(i => i.group === 'Sound FX' && i.sub).map(i => i.sub))] : [];
  const pack = sub?.includes(':pack:');
  const group = sub?.split(':')[0];
  const tool = ['tts', 'credits'].includes(sub);
  const destination = pack ? 'library' : group === 'yours' && sub !== 'yours:favorites' ? 'project' : ['favorites', 'yours:favorites'].includes(sub) ? 'favorites' : 'online';
  const navigate = id => {
    const target = id.includes(':pack:') ? 'library' : id === 'yours' ? 'project' : ['favorites', 'yours:favorites'].includes(id) ? 'favorites' : ['tts', 'credits'].includes(id) ? null : 'online';
    if (target === 'online' && ['sfx', 'soundza'].includes(id.split(':')[0])) browserMemory.set('audio:effects:selected', id);
    if (target) { browserMemory.set(`audio:destination:${target}`, id); browserMemory.set('audio:last', target); }
    if (['music','sfx','soundza','trolls'].includes(id.split(':')[0])) browserMemory.set(`audio:kind:${id.includes(':pack:') ? 'library' : 'online'}:${id.split(':')[0]}`, id);
    setSub(id);
  };
  useEffect(() => {
    if (!lib) return;
    if (sub === 'auto') { navigate(packSubs.length ? `music:pack:${packSubs[0]}` : 'music:All'); return; }
    // Navigation can precede the async catalog. Keep the selected collection
    // aligned with the options shown once the catalog arrives or changes.
    if (pack) {
      const kind = group === 'sfx' ? 'sfx' : 'music';
      const available = kind === 'sfx' ? packSfxSubs : packSubs;
      const collection = sub.slice(sub.indexOf(':pack:') + 6);
      if (available.length && !available.includes(collection)) navigate(`${kind}:pack:${available[0]}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, lib]);
  const changeDestination = id => navigate(browserMemory.get(`audio:destination:${id}`) || ({ library: `music:pack:${packSubs[0] || 'Library'}`, online: 'music:All', project: 'yours', favorites: 'favorites' })[id]);
  const localKind = group === 'sfx' ? 'sfx' : 'music';
  const onlineKind = group === 'soundza' ? 'sfx' : group;
  const switchKind = id => (pack ? localKind : onlineKind) === id ? undefined : navigate((!pack && id === 'sfx' ? browserMemory.get('audio:effects:selected') : null) || browserMemory.get(`audio:kind:${pack ? 'library' : 'online'}:${id}`) || (pack ? `${id}:pack:${(id === 'music' ? packSubs : packSfxSubs)[0] || 'Library'}` : `${id}:${id === 'trolls' ? 'Trending' : 'All'}`));
  const kinds = [['music', t('library.music')], ['sfx', t('library.sound_effects')], ...(pack ? [] : [['trolls', t('library.memes')]])];
  const navigation = <div className="browser-audio-kind">
    <div className="browser-kind-compact"><Dropdown ariaLabel={t('library.audio_content_type')} value={pack ? localKind : onlineKind} options={kinds.map(([value, label]) => ({ value, label }))} onChange={switchKind} /></div>
    <div className="seg-tabs browser-kinds" aria-label={pack ? t('library.library_audio_kind') : t('library.online_audio_kind')}>
      {kinds.map(([id,label]) => <button key={id} className={(pack ? localKind : onlineKind) === id ? 'on' : ''} aria-pressed={(pack ? localKind : onlineKind) === id} onClick={() => switchKind(id)}>{label}</button>)}
    </div>
    {pack && <Dropdown ariaLabel={t('library.library_collection')} value={sub.slice(sub.indexOf(':pack:') + 6)} options={(localKind === 'music' ? packSubs : packSfxSubs).length ? (localKind === 'music' ? packSubs : packSfxSubs).map(value => ({ value, label: catalogLabel('pack_sub', value) })) : [{ value: 'Library', label: !lib ? t('library.loading_collections') : t('library.no_collections_installed') }]} onChange={value => navigate(`${localKind}:pack:${value}`)} />}
  </div>;
  const providerControl = onlineKind === 'sfx' && <div className="browser-field"><span>{t('settings.provider')}</span><Dropdown ariaLabel={t('library.audio_provider')} value={group === 'soundza' ? 'soundza' : 'sfx'} options={[{ value: 'sfx', label: 'Openverse + SFXMint' }, { value: 'soundza', label: 'Soundza' }]} onChange={value => navigate(browserMemory.get(`audio:kind:online:${value}`) || `${value}:All`)} /></div>;
  const destinations = [['library', t('library.library')], ['online', t('library.online')], ['project', t('library.this_project')], ['favorites', t('library.favorites')]];
  return <TabFrame>
    <Head title={t('edit-plan-card.audio')} hint={tool ? sub === 'tts' ? t('library.generate_speech_for_your_video') : t('library.publication_credits_for_images_and_audio') : t('library.browse_your_library_or_find_audio_online')}>
      <div className="head-btns audio-browser-actions"><button aria-label={t('tts.text_to_speech')} title={t('tts.text_to_speech')} className={`btn btn-sm ${sub === 'tts' ? 'on' : ''}`} onClick={() => setSub('tts')}><Mic size={13} /><span>{t('tts.text_to_speech')}</span></button><button aria-label={t('audio.credits')} title={t('audio.credits')} className={`btn btn-sm ${sub === 'credits' ? 'on' : ''}`} onClick={() => setSub('credits')}><List size={13} /><span>{t('audio.credits')}</span></button></div>
    </Head>
    <div className="browser-audio-source"><Dropdown ariaLabel={t('library.audio_source')} value={tool ? 'tool' : destination} options={[...(tool ? [{ value: 'tool', label: sub === 'tts' ? t('tts.text_to_speech') : t('audio.credits') }] : []), ...destinations.map(([value, label]) => ({ value, label }))]} onChange={id => id !== 'tool' && changeDestination(id)} /></div>
    <div className="seg-tabs browser-destinations" aria-label={t('library.audio_source')}>{destinations.map(([id,label]) => <button key={id} className={!tool && sub !== 'auto' && destination === id ? 'on' : ''} aria-pressed={!tool && sub !== 'auto' && destination === id} onClick={() => changeDestination(id)}>{label}</button>)}</div>
    <div className="pad-block">
      {sub === 'auto' ? <p className="empty-note">{t('library.loading_your_audio_library')}</p> : <AudioLibrary {...props} MediaCard={MediaCard} onSectionChange={navigate} section={sub} browserMemory={browserMemory} navigation={navigation} providerControl={providerControl} onShowCredits={() => setSub('credits')} onAddMedia={props.onAdd} />}
    </div>
  </TabFrame>;
}

function TextTab({ onAddText, sub, setSub }) {
  useCreativePacks();
  return (
    <TabFrame>
      <Head title={sub === 'All' ? t('library.text_templates') : catalogLabel('text_cat', sub)} hint={t('library.click_or_drag_a_style_to_the_timeline')}>
        <button className="btn btn-primary btn-sm" onClick={() => onAddText({})}><Plus size={14} /> {t('inspector.add_text')}</button>
      </Head>
      <div className="chips scroll-x src-chips" role="group" aria-label={t('library.text_template_category')}>
        {[...TEMPLATE_CATEGORIES,...(packTextTemplates().length?['Plugins']:[])].map((c) => (
          <button key={c} className={`chip ${sub === c ? 'on' : ''}`} aria-pressed={sub === c} onClick={() => setSub(c)}>{c==='Plugins'?t('plugins.title'):catalogLabel('text_cat', c)}</button>
        ))}
      </div>
      <div className="pad-block">
        <TemplateGrid draggable category={sub} onPick={(t) => onAddText({ ...t.patch, ...(t.previewText?{text:t.previewText}:{}),...(t.duration?{duration:t.duration}:{}), template: t.id })} />
      </div>
    </TabFrame>
  );
}

function NeedClip({ target }) {
  if (target) return null;
  return <p className="hint">{t('library.select_a_picture_clip_main_track_or_overla')}</p>;
}

function EffectsTab({ target, updateTarget, clipSelected, onAddFreeEffect, onAddTextOver }) {
  const [query, setQuery] = useState('');
  const fx = clipSelected ? target?.clip.effects || [] : [];
  const toggle = (id) => updateTarget({ effects: fx.includes(id) ? fx.filter((x) => x !== id) : [...fx, id] });
  // With a clip selected the effect goes on that clip; otherwise it goes on the Effects track at
  // the playhead, as an object you can move and stretch over several clips.
  const pick = (id) => (clipSelected && target ? toggle(id) : onAddFreeEffect(id));
  const q = query.trim().toLowerCase();
  // The search matches the shown (translated) name and the English catalog name alike.
  const groups = [...EFFECT_GROUPS, 'Plugins'].map((g) => [g, allEffects().filter((e) => e.group === g && (!q || e.name.toLowerCase().includes(q) || catalogName('effect', e).toLowerCase().includes(q)))]).filter(([, list]) => list.length);
  return (
    <>
      <Head title={t('library.effects')} hint={clipSelected ? t('library.click_to_add_to_or_remove_from_selected') : t('library.click_to_add_on_the_effects_track')} />
      <div className="panel-search"><SearchBox value={query} onChange={setQuery} placeholder={t('library.search_effects')} ariaLabel={t('library.search_effects_2')} /></div>
      <p className="hint fx-mode">{clipSelected ? t('library.on_the_selected_clip_effect_lasts') : t('library.on_the_effects_track_move_and_stretch')}</p>
      {clipSelected && target && onAddTextOver && (
        <div className="pad-x">
          <button className="btn btn-sm" onClick={() => onAddTextOver(target.start, Math.max(0.1, target.end - target.start))}><Type size={14} /> {t('library.add_text_over_this_clip')}</button>
        </div>
      )}
      {!groups.length && <p className="hint pad-x">{t('library.no_effects_match_that_search')}</p>}
      {groups.map(([g, list]) => (
        <div key={g} className="fx-group">
          <span className="lib-group-name pad-x">{catalogLabel('effect_group', g)}</span>
          <div className="tile-grid">
            {list.map((e) => (
              <button key={e.id} className={`tile ${fx.includes(e.id) ? 'on' : ''}`} onClick={() => pick(e.id)}
                aria-pressed={fx.includes(e.id)} {...dragProps({ kind: 'effect', id: e.id })}>
                <span className="tile-preview fx-live"><FxThumb kind="effect" id={e.id} /></span>
                <span className="tile-label">{catalogName('effect', e)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TransitionsTab({ target, updateTarget }) {
  const ok = target && target.index > 0;
  const cur = target?.clip.transition;
  const [dur, setDur] = useState(0.5);
  const [view, setView] = useState('catalog'); // 'catalog' (the 135 reference library) | 'classic'
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('All'); // 'All' | 'fav' | a COLLECTIONS id
  const [favs, setFavs] = useState(() => loadFavorites());
  const toggleFav = (slug) => { const next = toggleFavorite(favs, slug); setFavs(next); saveFavorites(localStorage, next); };
  const engineById = Object.fromEntries(allTransitions().map((t) => [t.id, t]));
  // Shown name of the engine transition a catalog item runs (the data keeps the English engineName).
  const engineLabel = (e) => catalogName('transition', engineById[e.engineId] || { id: e.engineId, name: e.engineName });
  const applyEngine = (engineId, fxDuration) => {
    if (!ok) return;
    // Zoom/scale transitions feel best eased: new ones start on Smooth (the curve editor can change it).
    const ease = /zoom/i.test(engineId) ? { ease: 'smooth' } : {};
    updateTarget({ transition: { type: engineId, duration: fxDuration || dur, ...ease } });
  };
  const tile = (key, engineId, label, extra) => (
    <button key={key} className={`tile ${cur?.type === engineId ? 'on' : ''}`} {...dragProps({ kind: 'transition', id: engineId, duration: engineById[engineId]?.fx ? engineById[engineId].duration : dur })}
      onClick={() => applyEngine(engineId, engineById[engineId]?.fx ? engineById[engineId].duration : null)} title={extra?.title || label}>
      <span className="tile-preview fx-live"><FxThumb kind="transition" id={engineId} pair={extra?.pair || 0} duration={engineById[engineId]?.fx ? engineById[engineId].duration : 0.8} /></span>
      <span className="tile-label">{label}</span>
      {extra?.badge && <span className="tile-badge">{extra.badge}</span>}
      {extra?.slug && (
        <span className={`tile-star ${favs.has(extra.slug) ? 'on' : ''}`} role="button" aria-label={favs.has(extra.slug) ? t('library.remove_from_favourites') : t('library.save_as_favourite')}
          title={favs.has(extra.slug) ? t('library.remove_from_favourites') : t('library.save_as_favourite')}
          onClick={(e) => { e.stopPropagation(); toggleFav(extra.slug); }}
          onPointerDown={(e) => e.stopPropagation()}>★</span>
      )}
    </button>
  );
  const q = query.trim().toLowerCase();
  const inSelection = (e) => (collection === 'All' ? true
    : collection === 'fav' ? favs.has(e.slug)
    : collection.startsWith('pack:') ? e.pack === collection.slice(5)
    : e.collection === collection);
  const catalogList = COLLECTION_ITEMS.filter((e) => inSelection(e)
    && (!q || e.name.toLowerCase().includes(q) || catalogName('collection_item', e).toLowerCase().includes(q) || e.behavior.toLowerCase().includes(q) || e.family.toLowerCase().includes(q) || e.engineName.toLowerCase().includes(q) || engineLabel(e).toLowerCase().includes(q)));
  return (
    <>
      <Head title={t('library.transitions')} hint={t('library.between_the_previous_clip_and_selected')} />
      {!ok && <p className="hint">{t('library.select_a_clip_not_the_first_one_or_drag_a')}</p>}
      <div className="field pad">
        <span>{t('animation-panel.duration')} <b>{t('library.seconds_value', { value: formatNumber(dur, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</b></span>
        <input type="range" min="0.2" max="2" step="0.1" value={dur} onChange={(e) => {
          const d = Number(e.target.value);
          setDur(d);
          if (ok && cur) updateTarget({ transition: { ...cur, duration: d } });
        }} />
      </div>
      {allTransitions().some(t=>t.plugin)&&<div className="fx-group plugin-transitions"><span className="lib-group-name pad-x">{t('plugins.title')}</span><div className="tile-grid">{allTransitions().filter(t=>t.plugin&&(!query||t.name.toLowerCase().includes(query.toLowerCase()))).map(t=>tile(t.id,t.id,t.name))}</div></div>}
      <div className="seg-tabs tr-view" role="group" aria-label={t('library.transition_library')}>
        <button className={view === 'catalog' ? 'on' : ''} aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}>{t('library.catalog_count', { count: COLLECTION_ITEMS.length })}</button>
        <button className={view === 'classic' ? 'on' : ''} aria-pressed={view === 'classic'} onClick={() => setView('classic')}>{t('library.built_in')}</button>
      </div>
      {view === 'classic' && (
        <div className="tile-grid">
          <button className={`tile ${ok && !cur ? 'on' : ''}`} onClick={() => ok && updateTarget({ transition: null })}>
            <span className="tile-preview"><X size={20} /></span>
            <span className="tile-label">{t('grade.none')}</span>
          </button>
          {TRANSITIONS.map((t, i) => tile(t.id, t.id, catalogName('transition', t), { pair: i % 6 }))}
        </div>
      )}
      {view === 'catalog' && (
        <>
          <div className="field pad">
            <SearchBox placeholder={t('library.search_count_transitions', { count: COLLECTION_ITEMS.length })} value={query} onChange={setQuery} ariaLabel={t('library.search_transitions')} />
          </div>
          <div className="chips pad-x" role="group" aria-label={t('library.transition_collection')}>
            <button className={`chip ${collection === 'All' ? 'on' : ''}`} aria-pressed={collection === 'All'} onClick={() => setCollection('All')}>{t('library.all_count', { count: COLLECTION_ITEMS.length })}</button>
            <button className={`chip ${collection === 'fav' ? 'on' : ''}`} aria-pressed={collection === 'fav'} onClick={() => setCollection('fav')}>{t('library.saved_count', { count: favs.size })}</button>
            {COLLECTIONS.map((c) => (
              <button key={c.id} className={`chip ${collection === c.id ? 'on' : ''}`} aria-pressed={collection === c.id} onClick={() => setCollection(c.id)}>{catalogName('collection', c)}</button>
            ))}
            {PACKS.map((p) => (
              <button key={p.id} className={`chip ${collection === `pack:${p.id}` ? 'on' : ''}`} aria-pressed={collection === `pack:${p.id}`} onClick={() => setCollection(`pack:${p.id}`)}>{t('library.name_pack', { name: catalogName('pack', p) })}</button>
            ))}
          </div>
          <p className="hint pad-x">{t('library.tiles_run_the_real_engine_transition_on_re')}</p>
          {!catalogList.length && <p className="hint pad-x">{collection === 'fav' && !query ? t('library.no_favourites_yet_tap_star') : t('library.no_transitions_match_that_search')}</p>}
          {COLLECTIONS.filter((c) => collection === 'All' || collection === 'fav' || c.id === collection).map((c, ci) => {
            const list = catalogList.filter((e) => e.collection === c.id && (collection !== 'All' || !e.pack));
            if (!list.length) return null;
            return (
              <div key={c.id} className="fx-group">
                <span className="lib-group-name pad-x">{catalogName('collection', c)} · {list.length}</span>
                <div className="tile-grid">
                  {list.map((e, i) => tile(e.slug, e.engineId, catalogName('collection_item', e), {
                    slug: e.slug,
                    pair: (ci + i) % 6,
                    badge: e.status === 'adapted' ? t('library.adapted') : null,
                    title: [e.behavior, t('library.best_for_value', { value: e.bestFor || '-' }), t(e.status === 'adapted' ? 'library.uses_engine_adapted' : 'library.uses_engine', { engine: engineLabel(e) })].join('\n'),
                  }))}
                </div>
              </div>
            );
          })}
          {PACKS.filter((p) => collection === 'All' || collection === `pack:${p.id}`).map((p, pi) => {
            const list = catalogList.filter((e) => e.pack === p.id);
            if (!list.length) return null;
            return (
              <div key={p.id} className="fx-group">
                <span className="lib-group-name pad-x">{t('library.name_pack_count', { name: catalogName('pack', p), count: list.length })}</span>
                <div className="tile-grid">
                  {list.map((e, i) => tile(e.slug, e.engineId, catalogName('collection_item', e), {
                    slug: e.slug,
                    pair: (pi + i + 2) % 6,
                    badge: null,
                    title: [e.behavior, t('library.best_for_value', { value: e.bestFor || '-' }), t('library.uses_engine', { engine: engineLabel(e) })].join('\n'),
                  }))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

const CAPTION_LANGS = [
  { id: 'auto', name: t('library.auto_detect') }, { id: 'ar', name: t('library.arabic_incl_darija') }, { id: 'fr', name: t('library.french') },
  { id: 'en', name: t('library.english') }, { id: 'es', name: t('library.spanish') }, { id: 'de', name: t('library.german') }, { id: 'tr', name: t('library.turkish') },
];

// Speech models, each downloaded on first use: base is quick; large-v3-turbo is much better at Arabic; darija is a
// Whisper medium trained on Moroccan Darija (Arabic only). Only the ones the app can download are listed.
const CAPTION_MODELS = [
  { id: 'base', name: t('library.model_fast', { model: 'base' }), size: '150 MB' },
  { id: 'turbo', name: t('library.model_accurate_arabic', { model: 'large-v3-turbo' }), size: '575 MB' },
  { id: 'darija', name: t('library.model_moroccan_darija', { model: 'whisper-medium-darija' }), size: '540 MB', arabicOnly: true },
];

function CaptionsTab({ onAddText, captions, project, dispatch, onOpenSettings, settingsVersion }) {
  useCreativePacks();
  const templates=[...TEXT_TEMPLATES,...packTextTemplates()];
  const [lang, setLang] = useState('auto');
  const [model, setModel] = useState('base');
  // Cloud engines (item O): the user's own provider key, saved through the same encrypted
  // service-key store as the stock/voice keys; never shown again after saving.
  const [engine, setEngine] = useState('local');
  const [provider, setProvider] = useState('groq');
  const [cloudModel, setCloudModel] = useState('');
  const [savedKeys, setSavedKeys] = useState({});
  useEffect(() => {
    let live = true;
    window.api.settingsGet().then((st) => { if (live) setSavedKeys(st.serviceKeys || {}); });
    return () => { live = false; };
  }, [settingsVersion]);
  const CLOUD_PROVIDERS = [
    { id: 'groq', name: 'Groq', def: 'whisper-large-v3-turbo' },
    { id: 'openai', name: 'OpenAI', def: 'whisper-1' },
    { id: 'deepgram', name: 'Deepgram', def: 'nova-3' },
    { id: 'elevenlabs', name: 'ElevenLabs', def: 'scribe_v1' },
  ];
  const cloudMeta = CLOUD_PROVIDERS.find((p) => p.id === provider);
  const keyService = `cap-${provider}`;
  const savedHint = savedKeys[keyService];
  const models = CAPTION_MODELS.filter((m) => !captions.available || captions.available.includes(m.id));
  const modelInfo = CAPTION_MODELS.find((m) => m.id === model);
  const needsDownload = !captions.models?.[model];
  const [source, setSource] = useState('all');
  const [tplId, setTplId] = useState('cap-classic');
  const tpl = templates.find((t) => t.id === tplId);
  const pickStyle = (t) => {
    setTplId(t.id);
    if (project.textClips.some((c) => c.caption)) dispatch({ type: 'styleCaptions', patch: { ...t.patch, template: t.id } });
  };
  const [len, setLen] = useState(42);
  // Words per caption line (0 = no limit, the historical behaviour). Applies to auto
  // captions when generating and to .srt imports below alike.
  const [wpl, setWpl] = useState(0);
  const count = project.textClips.filter((c) => c.caption).length;
  // Imported .srt subtitles: their own clips (source: 'srt'), styled separately from auto captions.
  const srtCount = project.textClips.filter((c) => c.source === 'srt').length;
  const srtFileRef = useRef(null);
  const [srtTplId, setSrtTplId] = useState('cap-classic');
  const [srtNote, setSrtNote] = useState('');
  const onSrtFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const cues = regroupSegments(parseSRT(await f.text()), wpl);
    if (!cues.length) { setSrtNote(t('library.no_subtitle_cues_were_found_in_that_file')); return; }
    const style = templates.find((x) => x.id === srtTplId) || tpl;
    dispatch({ type: 'importSrtCaptions', style: { ...style.patch, template: style.id }, segments: cues.map((c) => ({ ...c, id: uid() })) });
    setSrtNote(tn('library.imported_count_subtitles_from_file', cues.length, { file: f.name }));
  };
  const pickSrtStyle = (t) => {
    setSrtTplId(t.id);
    dispatch({ type: 'styleSrtCaptions', patch: { ...t.patch, template: t.id } });
  };
  const busy = !!captions.busy;
  return (
    <>
      <Head title={t('edit-plan-card.captions')} hint={t('library.local_whisper_or_a_cloud_engine')} />
      <div className="card">
        <div className="card-row">
          <span className="card-icon accent"><Sparkles size={18} /></span>
          <div>
            <b>{t('library.auto_captions')}</b>
            <p>{engine === 'local'
              ? (needsDownload ? t('library.whisper_runs_first_use_downloads', { size: modelInfo.size }) : t('library.whisper_runs_on_your_computer'))
              : t('library.transcribed_by_provider_with_your_key', { provider: cloudMeta.name })}</p>
          </div>
        </div>
        <div className="proj-seg cap-engines" role="radiogroup" aria-label={t('library.caption_engine')}>
          <button type="button" role="radio" aria-checked={engine === 'local'} className={engine === 'local' ? 'on' : ''}
            disabled={busy} onClick={() => setEngine('local')}>{t('library.local_free')}</button>
          <button type="button" role="radio" aria-checked={engine === 'cloud'} className={engine === 'cloud' ? 'on' : ''}
            disabled={busy} onClick={() => setEngine('cloud')}>{t('library.cloud_api_key')}</button>
        </div>
        <label className="field">
          <span>{t('settings.language')}</span>
          <select value={modelInfo.arabicOnly && engine === 'local' ? 'ar' : lang} disabled={busy || (engine === 'local' && modelInfo.arabicOnly)} onChange={(e) => setLang(e.target.value)}>
            {CAPTION_LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {engine === 'local' ? (
          <label className="field">
            <span>{t('settings.model')}</span>
            <select value={model} disabled={busy} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        ) : (
          <>
            <label className="field">
              <span>{t('settings.provider')}</span>
              <select value={provider} disabled={busy} onChange={(e) => { setProvider(e.target.value); }}>
                {CLOUD_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('settings.model')}</span>
              <input type="text" value={cloudModel} disabled={busy} placeholder={cloudMeta.def} aria-label={t('library.provider_model', { provider: cloudMeta.name })}
                onChange={(e) => setCloudModel(e.target.value)} />
            </label>
            <div className="card cap-key-status"><b>{t('library.provider_api_key', { provider: cloudMeta.name })}</b><p className="muted small">{savedHint ? t('library.key_saved_hint', { hint: savedHint }) : t('library.no_key_saved_add_one_in_settings')}</p><button className="btn btn-sm" disabled={busy} onClick={() => onOpenSettings?.(`services:cap-${provider}`)}>{savedHint ? t('settings.manage_api_key') : t('settings.add_api_key')}</button></div>
            <p className="muted small">{t('library.cloud_engines_send_audio_to_provider', { provider: cloudMeta.name })}</p>
          </>
        )}
        {engine === 'local' && lang === 'ar' && model === 'base' && (
          <p className="muted small">{models.some((m) => m.id === 'darija') ? t('library.for_arabic_accurate_and_darija_models') : t('library.for_arabic_the_accurate_model')}</p>
        )}
        <label className="field">
          <span>{t('library.transcribe')}</span>
          <select value={source} disabled={busy} onChange={(e) => setSource(e.target.value)}>
            <option value="all">{t('library.video_audio_track')}</option>
            <option value="video">{t('library.video_clips_only')}</option>
            <option value="audio">{t('library.audio_track_only')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('library.max_line_length')} <b>{len}</b></span>
          <input type="range" min="16" max="80" step="2" value={len} disabled={busy} onChange={(e) => setLen(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>{t('library.words_per_line')} <b>{wpl ? formatNumber(wpl) : t('library.no_limit')}</b></span>
          <input type="range" min="0" max="12" step="1" value={wpl} disabled={busy} onChange={(e) => setWpl(Number(e.target.value))} aria-label={t('library.words_per_caption_line')} />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !(project.videoClips.length || project.audioClips.length) || (engine === 'cloud' && !savedHint)}
          onClick={() => (engine === 'cloud'
            ? captions.run({ engine: 'cloud', provider, model: cloudModel.trim() || undefined, language: lang, maxLen: len, wordsPerLine: wpl, source, style: { ...tpl.patch, template: tpl.id } })
            : captions.run({ language: modelInfo.arabicOnly ? 'ar' : lang, maxLen: len, wordsPerLine: wpl, source, model, style: { ...tpl.patch, template: tpl.id } }))}>
          {busy ? t('library.working') : count ? t('library.regenerate') : t('library.generate_captions')}
        </button>
        {engine === 'cloud' && !savedHint && <p className="muted small">{t('library.add_your_provider_key_in_settings', { provider: cloudMeta.name })}</p>}
        {busy && (
          <div className="progress-block" aria-live="polite">
            <span>{captions.stage} · {formatNumber(captions.progress || 0, { style: 'percent', maximumFractionDigits: 0 })}</span>
            <div className="progress"><div style={{ width: `${(captions.progress || 0) * 100}%` }} /></div>
          </div>
        )}
        {captions.error && <CaptionError error={captions.error} />}
        {!(project.videoClips.length || project.audioClips.length) && <p className="muted">{t('library.add_a_video_or_an_audio_clip_to_the_timeli')}</p>}
      </div>
      <div className="card">
        <b>{t('library.caption_style')}</b>
        <p className="muted">{count ? tn('library.applies_to_all_count_captions', count) : t('library.used_when_you_generate_captions')}</p>
        <TemplateGrid captionOnly activeId={tplId} onPick={pickStyle} />
        {count > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'setCaptions', segments: [] })}>
            <Trash2 size={14} /> {t('library.remove_auto_captions')}
          </button>
        )}
      </div>
      <div className="card">
        <b>{t('library.subtitles_srt')}</b>
        <p className="muted">{srtCount ? tn('library.count_imported_subtitles_on_the_timeline', srtCount) : t('library.import_a_subrip_file_every_cue')}</p>
        <input ref={srtFileRef} type="file" accept=".srt" hidden onChange={onSrtFile} aria-label={t('library.choose_an_srt_subtitle_file')} />
        <button className="btn btn-sm" onClick={() => srtFileRef.current?.click()}><Upload size={14} /> {t('library.import_srt_file')}</button>
        <p className="muted small">{t('library.the_words_per_line_setting_above_applies_t')}</p>
        {srtNote && <p className="muted small">{srtNote}</p>}
        {srtCount > 0 && (
          <>
            <p className="muted small">{t('library.template_for_all_imported_subtitles')}</p>
            <TemplateGrid captionOnly activeId={srtTplId} onPick={pickSrtStyle} />
            <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: 'removeSrtCaptions' })}>
              <Trash2 size={14} /> {t('library.remove_imported_subtitles')}
            </button>
          </>
        )}
      </div>
      <div className="card">
        <b>{t('library.manual_caption')}</b>
        <p className="muted">{t('library.a_caption_line_at_the_bottom_of_the_frame')}</p>
        <button className="btn btn-sm" onClick={() => onAddText({ size: 44, y: 0.9, box: true, boxColor: '#000000', outline: false, font: 'segoe', anim: 'none' })}>
          <Plus size={14} /> {t('library.add_caption')}
        </button>
      </div>
    </>
  );
}

// Error box: short reason plus a button to open the full whisper log.
function CaptionError({ error }) {
  const [msg, logPath] = error.split('\n\nFull log: ');
  return (
    <div className="error-box" role="alert">
      <b>{t('library.couldnt_generate_captions')}</b>
      <p>{msg.replace('Auto captions failed.\n', '')}</p>
      {logPath && (
        <button className="btn btn-ghost btn-sm" onClick={() => window.api.showInFolder(logPath.trim())}>
          <FolderOpen size={14} /> {t('library.open_log')}
        </button>
      )}
    </div>
  );
}

// With several clips selected in the timeline, the Filters and Adjust tabs change all of them.
function ManyNote({ count }) {
  if (count < 2) return null;
  return <p className="hint many">{tn('library.applies_to_the_count_selected_clips', count)}</p>;
}

// Scope: "Selected clip" puts the look on one clip (several when several are selected); "Whole video"
// puts it on the Effects track over everything — the main track is often just a background behind
// overlay pictures and graphics, where a clip filter visibly does nothing. The whole-video layer is
// App's wholeFilter / onWholeVideoFilter; the tab opens on that scope when such a layer exists.
function FiltersTab({ target, updateTarget, media, selectedCount = 0, dispatch, project, wholeFilter = null, onWholeVideoFilter = null }) {
  useCreativePacks();
  const [scope, setScope] = useState(wholeFilter ? 'video' : 'clip');
  const whole = scope === 'video' && !!onWholeVideoFilter;
  const current = whole ? (wholeFilter ? filterFxLook(wholeFilter.fx) : 'none') : (target?.clip.filter || 'none');
  const k = whole ? Math.round((wholeFilter?.strength ?? 1) * 100) : (target?.clip.filterIntensity ?? 100);
  const has = whole || !!target; // something to put a look on
  const apply = (patch) => { if (whole) onWholeVideoFilter(patch); else if (target) updateTarget(patch); };
  const [presets, setPresets] = useState(() => loadPresets(localStorage));
  const [presetName, setPresetName] = useState('');
  const [compareId, setCompareId] = useState(null); // hold a tile: show the unfiltered picture
  const storePresets = (list) => { setPresets(list); savePresets(localStorage, list); };
  const canSave = !whole && !!target && current !== 'none' && !current.startsWith('lut:')&&!current.startsWith('pack-lut:');
  return (
    <>
      <Head title={t('audio-fx.filters')} hint={whole ? t('library.click_a_look_whole_video_hold_to_compare') : t('library.click_or_drag_onto_a_clip_hold_to_compare')} />
      {onWholeVideoFilter && (
        <div className="seg-tabs small filter-scope" role="radiogroup" aria-label={t('library.apply_filters_to')}>
          <button type="button" className={!whole ? 'on' : ''} aria-pressed={!whole} onClick={() => setScope('clip')}>{t('library.selected_clip')}</button>
          <button type="button" className={whole ? 'on' : ''} aria-pressed={whole} onClick={() => setScope('video')}>{t('library.whole_video')}</button>
        </div>
      )}
      {whole && <p className="hint">{t('library.the_look_goes_on_the_effects_track_over_ev')}</p>}
      {!whole && <NeedClip target={target} />}
      {!whole && <ManyNote count={selectedCount} />}
      {!whole&&!!preferredPackColors().length&&<div className="pad-block"><div className="look-cat-title">{t('plugins.color_presets')}</div><div className="chips">{preferredPackColors().map(p=><button className="chip" key={`${p.digest}/${p.id}`} disabled={!target} title={p.pluginName} onClick={()=>target&&updateTarget(colorPresetPatch(p))}>{p.name}</button>)}</div></div>}
      {has && current !== 'none' && (
        <div className="pad-block filter-k">
          <Slider dispatch={dispatch} label={t('library.name_intensity', { name: filterLabel(current, filterName(current)) })} value={k} min={0} max={100} step={1}
            fmt={(v) => formatNumber(Math.round(v))} onChange={(v) => apply({ filterIntensity: v })} />
        </div>
      )}
      <div className="look-cat">
        <div className="look-cat-title">{t('library.my_presets')}</div>
        {target && (
          <div className="preset-save">
            <input type="text" value={presetName} placeholder={t('library.preset_name')} aria-label={t('library.preset_name_2')} onChange={(e) => setPresetName(e.target.value)} />
            <button className="btn btn-sm" disabled={!canSave || !presetName.trim()}
              title={current.startsWith('lut:') ? t('library.lut_looks_live_in_the_lut_library') : t('library.save_the_selected_clips_look_as_a_preset')}
              onClick={() => { storePresets(upsertPreset(presets, target.clip, presetName)); setPresetName(''); }}>{t('library.save_current_look')}</button>
          </div>
        )}
        {!!presets.length && (
          <div className="tile-grid">
            {presets.map((pr) => (
              <button key={pr.name} className={`tile ${has && current === pr.filter ? 'on' : ''}`} title={t('library.preset_name_filter_at_percent', { name: pr.name, filter: filterLabel(pr.filter, filterName(pr.filter)), percent: formatNumber(Math.round(pr.filterIntensity)) })}
                onClick={() => (whole ? apply({ filter: pr.filter, filterIntensity: pr.filterIntensity }) : target && updateTarget(presetPatch(pr)))}>
                <span className="tile-preview filter-thumb"><LookThumb filterId={pr.filter === 'none' ? null : pr.filter} /></span>
                <span className="tile-label">{pr.name}</span>
                <span className="tile-star" role="button" aria-label={t('library.delete_preset_name', { name: pr.name })} title={t('library.delete_preset')}
                  onClick={(e) => { e.stopPropagation(); storePresets(removePreset(presets, pr.name)); }}
                  onPointerDown={(e) => e.stopPropagation()}>×</span>
              </button>
            ))}
          </div>
        )}
        {!presets.length && <p className="hint">{t('library.no_saved_presets_yet_pick_a_filter_set_its')}</p>}
      </div>
      {FILTER_CATS.map((cat) => (
        <div key={cat} className="look-cat">
          <div className="look-cat-title">{catalogLabel('filter_cat', cat)}</div>
          <div className="tile-grid">
            {FILTERS.filter((f) => f.cat === cat).map((f) => (
              <button key={f.id} className={`tile ${current === f.id && has ? 'on' : ''}`}
                onClick={() => apply({ filter: f.id })} {...dragProps({ kind: 'filter', id: f.id })}
                onPointerDown={() => setCompareId(f.id)} onPointerUp={() => setCompareId(null)} onPointerLeave={() => setCompareId(null)}>
                <span className="tile-preview filter-thumb"><LookThumb filterId={f.id === 'none' ? null : f.id} plain={compareId === f.id} /></span>
                <span className="tile-label">{catalogName('filter', f)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <LutBrowser allowPackGrade={!whole} target={whole ? { clip: { filter: current, filterIntensity: k } } : target} updateTarget={apply} dispatch={dispatch} project={project} current={current} />
    </>
  );
}

// LUT browser: bundled LUTs by category (applied as the clip's filter, like the other looks)
// and the user's imported .cube library (applied through the grade's LUT slot, the mechanism
// that supports file paths). Imported entries persist in localStorage; invalid files surface
// the parser's error instead of failing silently.
function LutBrowser({ target, updateTarget, dispatch, project, current, allowPackGrade=true }) {
  useCreativePacks();
  const [lib, setLib] = useState(() => loadLutLibrary(localStorage));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const storeLib = (list) => { setLib(list); saveLutLibrary(localStorage, list); };
  const clipLutPath = target?.clip.grade?.lut?.ref?.path || null;
  const applyImported = (entry) => {
    if (!target) return;
    const g = target.clip.grade || {};
    updateTarget({ grade: { ...g, lut: { ref: { path: entry.path }, name: entry.name, intensity: g.lut?.intensity ?? 100 } } });
  };
  const applyImportedToAll = (entry) => {
    if (!project) return;
    const lut = { ref: { path: entry.path }, name: entry.name, intensity: 100 };
    dispatch({ type: 'updateMany', updates: [
      ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(c.grade || {}), lut } } })),
      ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(c.grade || {}), lut } } })),
    ] });
  };
  const importCube = async () => {
    setErr(''); setBusy(true);
    try {
      const res = await window.api.importLut();
      if (!res || res.canceled) return;
      if (res.error) { setErr(res.error); return; }
      if (res.path) storeLib(addLutEntry(lib, { name: res.name, path: res.path }));
    } catch (e) { setErr(e.message || t('library.import_failed')); }
    finally { setBusy(false); }
  };
  const cats = [...new Set(BUNDLED_LUTS.map((l) => l.cat))];
  return (
    <div className="look-cat">
      <div className="look-cat-title">{t('library.lut_browser')}</div>
      {cats.map((cat) => (
        <div key={cat}>
          <div className="look-cat-title sub">{catalogLabel('lut_cat', cat)} <span className="dim">{t('library.bundled_slay_cc_by_4_0')}</span></div>
          <div className="tile-grid">
            {BUNDLED_LUTS.filter((l) => l.cat === cat).map((l) => {
              // A bundled LUT tile is a filter like the others: picking it replaces the current filter; None removes it.
              const id = `lut:${l.file}`;
              return (
                <button key={l.file} className={`tile ${target && current === id ? 'on' : ''}`} title={t('library.lut_name', { name: catalogName('lut', l) })}
                  onClick={() => target && updateTarget({ filter: id })}>
                  <span className="tile-preview filter-thumb"><LookThumb lutRef={l.ref} /></span>
                  <span className="tile-label">{catalogName('lut', l)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {allowPackGrade&&!!preferredPackLuts().length&&<><div className="look-cat-title sub">{t('plugins.lut_packs')}</div><div className="tile-grid">{preferredPackLuts().map(l=><button className="tile" key={`${l.digest}/${l.id}`} disabled={!target} title={`${l.pluginName} — ${l.license}`} onClick={()=>target&&updateTarget({grade:{...(target.clip.grade||{}),lut:{ref:l.ref,name:l.name,intensity:100,dependency:{pluginId:l.pluginId,digest:l.digest,version:l.version,id:l.id,name:l.name}}}})}><span className="tile-preview filter-thumb"><LookThumb lutRef={l.ref}/></span><span className="tile-label">{l.name}</span></button>)}</div></>}
      <div className="look-cat-title sub">{t('library.my_luts')} <span className="dim">{t('library.cube_3d_or_1d')}</span></div>
      <div className="preset-save">
        <button className="btn btn-sm" disabled={busy} onClick={importCube}>{busy ? t('library.importing') : t('grade.import_cube')}</button>
        {target && clipLutPath && <span className="dim">{t('library.intensity_adjust_basic_lut')}</span>}
      </div>
      {err && <p className="hint pad-x" role="alert">⚠ {err}</p>}
      {!!lib.length && (
        <div className="tile-grid">
          {lib.map((e) => (
            <button key={e.path} className={`tile ${clipLutPath === e.path ? 'on' : ''}`} title={`${e.name}\n${e.path}`}
              onClick={() => applyImported(e)}>
              <span className="tile-preview filter-thumb"><LookThumb lutRef={{ path: e.path }} /></span>
              <span className="tile-label">{e.name}</span>
              <span className="tile-star" role="button" aria-label={t('library.remove_name_from_the_library', { name: e.name })} title={t('library.remove_from_library_keeps_the_file')}
                onClick={(ev) => { ev.stopPropagation(); storeLib(removeLutEntry(lib, e.path)); }}
                onPointerDown={(ev) => ev.stopPropagation()}>×</span>
              <span className="tile-badge clickable" role="button" title={t('library.apply_this_lut_to_every_video_clip')}
                onClick={(ev) => { ev.stopPropagation(); applyImportedToAll(e); }}
                onPointerDown={(ev) => ev.stopPropagation()}>{t('library.all_2')}</span>
            </button>
          ))}
        </div>
      )}
      {!lib.length && <p className="hint">{t('library.import_a_cube_file_to_keep_it_here_invalid')}</p>}
      <p className="hint">{t('library.one_filter_at_a_time_a_new_one_replaces_th')}</p>
    </div>
  );
}

function AdjustTab({ media: library = [], target, updateTarget, dispatch, selectedCount = 0, onApplyLookToAll }) {
  const media = target && library.find((m) => m.id === target.clip.mediaId);
  return (
    <>
      <Head title={t('grade.adjust')} hint={t('library.color_and_light_of_the_clip')} />
      <NeedClip target={target} />
      <ManyNote count={selectedCount} />
      {target && (
        <div className="pad-block">
          <GradePanel grade={target.clip.grade} adjust={target.clip.adjust} dispatch={dispatch}
            autoFrom={media ? { media, clip: target.clip } : undefined}
            onGrade={(grade) => updateTarget({ grade })} onAdjust={(adjust) => updateTarget({ adjust })}
            onApplyAll={onApplyLookToAll ? () => onApplyLookToAll(target.clip) : undefined} />
        </div>
      )}
    </>
  );
}
