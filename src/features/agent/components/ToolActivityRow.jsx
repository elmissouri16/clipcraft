import React from 'react';
import ToolCallIcon from './ToolCallIcon.jsx';
import { activityTime } from '../toolActivity.js';
import { ToolMedia, ToolChange, ToolRender, ToolOutput } from './ToolVisuals.jsx';

const text=value=>typeof value==='string'?value:'';
const COMPLETED={generate_image:'Scene image added',generate_images:'Scene images added',cut_range:'Section removed',keep_ranges:'Selected sections kept',trim_clip:'Clip trimmed',split_at:'Clip split',add_captions:'Captions created',add_voiceover:'Narration added',export_video:'Video ready',review_section:'Section preview ready'};
function ToolActivityRow({ step, onCancel }) {
  const a=step.activity||{},outcome=text(a.outcome),completed=step.status==='done'&&outcome&&outcome!=='Already matches the requested settings';
  const title=(completed&&COMPLETED[step.name])||text(a.title)||step.label,description=text(a.description),excerpt=text(a.excerpt);
  const failed=step.status==='error',running=step.status==='running',progress=a.progress;
  const hasProgress=running&&Number.isFinite(progress?.total)&&progress.total>0&&Number.isFinite(progress.completed);
  const status=running?'Running':failed?'Failed':step.status==='switch'?'Provider changed':'Completed';
  return <li className={`${step.status} pilot-activity`}>
    <ToolCallIcon name={step.name} />
    <div className="pilot-activity-body">
      <div className="pilot-activity-title">{title}</div>
      {description&&<div className="pilot-activity-description" dir="auto">{description}</div>}
      <ToolChange change={a.change} failed={failed} />
      <ToolMedia visuals={a.visuals} more={a.more_visuals} />
      {excerpt&&<details className="pilot-activity-content">
        <summary><span className="pilot-activity-content-label">{text(a.excerptLabel)||'Content'}</span><span className="pilot-activity-preview" dir="auto">{excerpt}</span></summary>
        <p dir="auto">{excerpt}</p>
      </details>}
      {running&&<ToolRender render={a.render} onCancel={onCancel} review={step.name==='review_section'} />}
      {hasProgress&&<div className="pilot-activity-progress">
        <progress value={progress.completed} max={progress.total} aria-label="Scene image generation progress" />
        <small>{progress.completed} of {progress.total} finished · {progress.inserted||0} placed{progress.failed?` · ${progress.failed} failed`:''}{Number.isFinite(progress.elapsed_sec)?` · ${activityTime(progress.elapsed_sec)}`:''}</small>
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
