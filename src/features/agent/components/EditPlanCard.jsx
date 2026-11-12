import React from 'react';
import { Check, ClipboardList, PencilLine } from 'lucide-react';
import { activityTime } from '../toolActivity.js';
import { t } from '../../../i18n/index.js';

const PLATFORM = { tiktok: 'TikTok', reels: 'Reels', shorts: 'Shorts', youtube: 'YouTube', podcast: t('plan.podcast_clip'), tutorial: t('plan.tutorial'), vlog: t('plan.vlog'), ad: t('plan.ad'), other: '' };
const text = value => typeof value === 'string' ? value : '';
const items = value => Array.isArray(value) ? value.filter(v => typeof v === 'string' && v) : [];

function Section({ label, list }) {
  const values = items(list);
  if (!values.length) return null;
  return <div className="plan-section"><span className="plan-label">{label}</span><ul>{values.map((v, i) => <li key={i} dir="auto">{v}</li>)}</ul></div>;
}

// The plan CraftAI proposes before a substantial edit. Approve sends the
// approval as a normal chat message; Change puts a prompt in the composer.
export default function EditPlanCard({ plan, actionable, onApprove, onChange }) {
  if (!plan || typeof plan !== 'object') return null;
  const story = Array.isArray(plan.story) ? plan.story.filter(s => s && text(s.note)) : [];
  const meta = [PLATFORM[plan.platform] || '', Number.isFinite(plan.target_duration_sec) ? t('plan.seconds_target', { seconds: Math.round(plan.target_duration_sec) }) : ''].filter(Boolean);
  return <section className="edit-plan" aria-label={t('plan.proposed_edit_plan')}>
    <header><ClipboardList size={14} aria-hidden="true" /><b>{t('plan.edit_plan')}</b>{meta.length > 0 && <span>{meta.join(' · ')}</span>}</header>
    {text(plan.goal) && <p className="plan-goal" dir="auto">{plan.goal}</p>}
    {text(plan.hook) && <div className="plan-section"><span className="plan-label">{t('plan.hook')}</span><p dir="auto">{plan.hook}</p></div>}
    {story.length > 0 && <div className="plan-section"><span className="plan-label">{t('plan.story')}</span>
      <ol className="plan-story">{story.map((s, i) => <li key={i}>
        {Number.isFinite(s.start_sec) && <time>{activityTime(s.start_sec)}{Number.isFinite(s.end_sec) ? `–${activityTime(s.end_sec)}` : ''}</time>}
        <span dir="auto">{s.note}</span>
      </li>)}</ol>
    </div>}
    <Section label={t('plan.cuts')} list={plan.cuts} />
    <Section label={t('plan.visuals')} list={plan.visuals} />
    <Section label={t('edit-plan-card.audio')} list={plan.audio} />
    {text(plan.captions) && <div className="plan-section"><span className="plan-label">{t('edit-plan-card.captions')}</span><p dir="auto">{plan.captions}</p></div>}
    <Section label={t('plan.questions')} list={plan.questions} />
    {actionable && <div className="plan-actions">
      <button type="button" className="btn btn-sm btn-primary" onClick={onApprove}><Check size={13} /> {t('plan.approve_plan')}</button>
      <button type="button" className="btn btn-sm" onClick={onChange}><PencilLine size={13} /> {t('plan.change')}</button>
    </div>}
  </section>;
}
