import { useEffect, useState } from 'react';
import { Film, X } from 'lucide-react';
import { formatDuration } from '../videoAttachments.js';
import { t } from '../../../i18n/index.js';

function AttachedVideo({ video, onRemove }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let current = true;
    window.api.agentVideoPreview?.(video.id).then(result => { if (current) setPreview(result); }).catch(() => { if (current) setPreview({ error: t('activity.preview_unavailable') }); });
    return () => { current = false; };
  }, [video.id]);
  return <div className={`pilot-image pilot-video${preview?.error ? ' is-unavailable' : ''}`} title={preview?.error || t('pilot.reference_video_details', { name: video.name, duration: formatDuration(video.duration), width: video.width, height: video.height })}>
    {preview?.url ? <img src={preview.url} alt={video.name} draggable={false} /> : <span className="pilot-image-placeholder"><Film size={18} /></span>}
    <span className="pilot-video-duration"><Film size={10} />{formatDuration(video.duration)}</span>
    <span className="pilot-image-name">{video.name}</span>
    {onRemove && <button type="button" className="pilot-image-remove" aria-label={t('pilot.remove_reference_video', { name: video.name })} onClick={() => onRemove(video.id)}><X size={12} /></button>}
    {preview?.error && <span className="pilot-image-missing">{t('pilot.unavailable')}</span>}
  </div>;
}

// Reference videos attached to a message: a poster, the length and the name.
export default function VideoAttachments({ videos, onRemove, compact = false }) {
  if (!videos?.length) return null;
  return <div className={`pilot-images${compact ? ' is-compact' : ''}`} aria-label={t('pilot.attached_reference_videos')}>
    {videos.map(video => <AttachedVideo key={video.id} video={video} onRemove={onRemove} />)}
  </div>;
}
