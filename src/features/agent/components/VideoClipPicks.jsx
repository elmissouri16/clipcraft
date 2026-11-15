import React from 'react';
import { Film, Plus } from 'lucide-react';
import { activityTime } from '../toolActivity.js';
import { ToolOutput } from './ToolVisuals.jsx';
import { t } from '../../../i18n/index.js';

export default function VideoClipPicks({ data, actionable, onAdd }) {
  if (!data) return null;
  return <section className="video-clip-picks" aria-label={t('discovery.suggestions')}>
    <header><Film size={14} aria-hidden="true" /><strong>{data.picks?.length ? t('discovery.suggestions') : t('discovery.coverage')}</strong></header>
    <p className="video-index-coverage" role="status">{t('discovery.coverage_amount', { indexed: activityTime(data.indexed_sec), duration: activityTime(data.duration_sec) })}{!data.complete && <> {t('discovery.partial')}</>}</p>
    {!!data.picks?.length && <p className="video-picks-note">{t('discovery.review_basis')}</p>}
    {data.picks?.map((pick, i) => <article className="video-clip-pick" key={pick.pick_id}>
      <div className="video-pick-heading"><b dir="auto">{i + 1}. {pick.title}</b><span className={`video-pick-confidence confidence-${pick.confidence}`}>{t(`discovery.confidence_${pick.confidence}`)}</span></div>
      <div className="video-pick-source"><span title={pick.source_name}>{pick.source_name}</span><time>{activityTime(pick.start_sec)}–{activityTime(pick.end_sec)}</time></div>
      <ToolOutput artifact={{ file: pick.file, review: true, duration_sec: pick.end_sec - pick.start_sec }} />
      <p className="video-pick-reason" dir="auto">{pick.reason}</p>
      <button type="button" className="btn btn-sm video-pick-add" disabled={!actionable} onClick={() => onAdd(pick)}><Plus size={13} />{t('discovery.add_to_timeline')}</button>
    </article>)}
  </section>;
}
