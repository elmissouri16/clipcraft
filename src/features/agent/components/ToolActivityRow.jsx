import React from 'react';
import ToolCallIcon from './ToolCallIcon.jsx';
import { activityTime } from '../toolActivity.js';
import { ToolMedia, ToolChange, ToolRender, ToolOutput } from './ToolVisuals.jsx';
import { t, tn } from '../../../i18n/index.js';

const text=value=>typeof value==='string'?value:'';
// Titles once an edit is done; panel text (docs/design/localization.md).
const COMPLETED={generate_image:t('activity.scene_image_added'),generate_images:t('activity.scene_images_added'),cut_range:t('activity.section_removed'),keep_ranges:t('activity.selected_sections_kept'),trim_clip:t('activity.clip_trimmed'),split_at:t('activity.clip_split'),add_captions:t('activity.captions_created'),add_voiceover:t('activity.narration_added'),export_video:t('activity.video_ready'),review_section:t('activity.section_preview_ready')};
function ToolActivityRow({ step, onCancel }) {
  const a=step.activity||{},outcome=text(a.outcome),completed=step.status==='done'&&outcome&&!a.unchanged&&outcome!==t('activity.already_matches_the_requested_settings');
  const title=(completed&&COMPLETED[step.name])||text(a.title)||step.label,description=text(a.description),excerpt=text(a.excerpt);
  const failed=step.status==='error',running=step.status==='running',progress=a.progress;
  const hasProgress=running&&Number.isFinite(progress?.total)&&progress.total>0&&Number.isFinite(progress.completed);
  const status=running?t('activity.running'):failed?t('activity.failed'):step.status==='switch'?t('activity.provider_changed'):t('activity.completed');
  return <li className={`${step.status} pilot-activity`}>
    <ToolCallIcon name={step.name} />
    <div className="pilot-activity-body">
      <div className="pilot-activity-title">{title}</div>
      {description&&<div className="pilot-activity-description" dir="auto">{description}</div>}
      <ToolChange change={a.change} failed={failed} />
      <ToolMedia visuals={a.visuals} more={a.more_visuals} />
      {excerpt&&<details className="pilot-activity-content">
        <summary><span className="pilot-activity-content-label">{text(a.excerptLabel)||t('activity.content')}</span><span className="pilot-activity-preview" dir="auto">{excerpt}</span></summary>
        <p dir="auto">{excerpt}</p>
      </details>}
      {running&&<ToolRender render={a.render} onCancel={onCancel} review={step.name==='review_section'} />}
      {hasProgress&&<div className="pilot-activity-progress">
        <progress value={progress.completed} max={progress.total} aria-label={t('activity.scene_image_generation_progress')} />
        <small>{[t('activity.completed_of_total_finished',{completed:progress.completed,total:progress.total}),tn('activity.placed',progress.inserted||0),progress.failed?tn('activity.failed_count',progress.failed):'',Number.isFinite(progress.elapsed_sec)?activityTime(progress.elapsed_sec):''].filter(Boolean).join(' · ')}</small>
      </div>}
      {!failed&&outcome&&<div className="pilot-activity-outcome">{outcome}</div>}
      <ToolOutput artifact={a.artifact} />
      {failed&&step.detail&&<details className="pilot-activity-error"><summary>{text(step.detail).length>180?`${text(step.detail).slice(0,180)}…`:text(step.detail)}</summary><p>{text(step.detail)}</p></details>}
    </div>
    <span className="pilot-step-status" aria-label={status} title={status}>
      {running?<span className="pilot-activity-spinner" />:<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6" />{failed?<path d="M8 4.5v4 M8 11h.01" />:<path d="m4.7 8 2.1 2.2 4.5-4.5" />}</svg>}
    </span>
  </li>;
}
export default React.memo(ToolActivityRow);
