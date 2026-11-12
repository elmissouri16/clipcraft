import { useState } from 'react';
import { Clock3, ListOrdered, Pause, Pencil, Play, X } from 'lucide-react';
import { timelineAttachmentLabel } from '../timelineContext.js';
import ImageAttachments from './ImageAttachments.jsx';
import { t, tn } from '../../../i18n/index.js';

export default function MessageQueue({ items, paused, busy, disabled, onPause, onResume, onChange, onRemove }) {
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  if (!items.length) return null;
  const save = id => {
    if (!text.trim()) return;
    onChange(id, { text: text.trim() }); setEditing(null);
  };
  return <section className="pilot-queue" aria-label={t('pilot.queued_messages')}>
    <div className="pilot-queue-head">
      <ListOrdered size={14} /><b>{tn('pilot.queued_count', items.length)}</b><span role="status">{paused ? t('pilot.paused') : busy ? t('pilot.up_next') : t('pilot.ready')}</span>
      {paused ? <button type="button" className="pilot-text-btn" disabled={disabled || !!editing} onClick={onResume}><Play size={12} />{t('pilot.resume_queue')}</button>
        : <button type="button" className="pilot-text-btn" onClick={onPause}><Pause size={12} />{t('message-queue.pause')}</button>}
    </div>
    <ol className="pilot-queue-list">
      {items.map((item, i) => <li key={item.id} className="pilot-queue-item">
        <span className="pilot-queue-number" aria-hidden="true">{i + 1}</span>
        <div className="pilot-queue-body">
          {editing === item.id ? <div className="pilot-queue-editor">
            <textarea autoFocus aria-label={t('pilot.edit_queued_message')} value={text} rows={2} dir="auto" onChange={e => setText(e.target.value)} onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(item.id); }
            }} />
            <div><button type="button" className="btn btn-sm" disabled={!text.trim()} onClick={() => save(item.id)}>{t('close.save')}</button><button type="button" className="pilot-text-btn" onClick={() => setEditing(null)}>{t('app.cancel')}</button></div>
          </div> : <p dir="auto">{item.text}</p>}
          <ImageAttachments images={item.images} compact onRemove={id => onChange(item.id, { images: item.images.filter(image => image.id !== id) })} />
          {item.timelineAttachments?.map(a => <span className="pilot-queue-context" key={a.id}><Clock3 size={11} />{timelineAttachmentLabel(a)}<button type="button" className="icon-btn sm" aria-label={t('pilot.remove_attachment_from_queued_message', { n: i + 1 })} onClick={() => onChange(item.id, { timelineAttachments: item.timelineAttachments.filter(x => x.id !== a.id) })}><X size={11} /></button></span>)}
        </div>
        <div className="pilot-queue-actions">
          <button type="button" className="icon-btn sm" aria-label={t('pilot.edit_queued_message_n', { n: i + 1 })} onClick={() => { onPause(); setText(item.text); setEditing(item.id); }}><Pencil size={12} /></button>
          <button type="button" className="icon-btn sm" aria-label={t('pilot.remove_queued_message_n', { n: i + 1 })} onClick={() => { onRemove(item.id); if (editing === item.id) setEditing(null); }}><X size={13} /></button>
        </div>
      </li>)}
    </ol>
    {paused && <p className="pilot-queue-hint">{t('pilot.review_your_messages_then_resume')}</p>}
  </section>;
}
