import { useEffect, useState } from 'react';
import { Image, X } from 'lucide-react';

function AttachedImage({ image, onRemove }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let current = true;
    window.api.agentImagePreview?.(image.id).then(result => { if (current) setPreview(result); }).catch(() => { if (current) setPreview({ error: 'Image preview unavailable' }); });
    return () => { current = false; };
  }, [image.id]);
  return <div className={`pilot-image${preview?.error ? ' is-unavailable' : ''}`} title={preview?.error || `${image.name} · ${image.width} × ${image.height}`}>
    {preview?.url ? <img src={preview.url} alt={image.name} draggable={false} /> : <span className="pilot-image-placeholder"><Image size={18} /></span>}
    <span className="pilot-image-name">{image.name}</span>
    {onRemove && <button type="button" className="pilot-image-remove" aria-label={`Remove image ${image.name}`} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    {preview?.error && <span className="pilot-image-missing">Unavailable</span>}
  </div>;
}
export default function ImageAttachments({ images, onRemove, compact = false }) {
  if (!images?.length) return null;
  return <div className={`pilot-images${compact ? ' is-compact' : ''}`} aria-label="Attached images">
    {images.map(image => <AttachedImage key={image.id} image={image} onRemove={onRemove} />)}
  </div>;
}
