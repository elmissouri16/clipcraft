import React, { useState } from 'react';
import { projectCredits } from '../credits.js';
import { t } from '../../../i18n/index.js';

export default function MediaCredits({ project }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const credits = projectCredits(project);
  if (!credits.length) return null;
  return <div className="card lib-credits">
    <b>{t('credits.media_credits')}</b>
    <p>{t('credits.include_these_credits_in_your_published_vi')}</p>
    <pre>{credits.join('\n\n')}</pre>
    <button className="btn btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(credits.join('\n\n')); setCopied(true); setError(''); }
      catch { setError(t('credits.select_and_copy_the_credit_text_above')); }
    }}>{copied ? t('credits.credits_copied') : t('credits.copy_media_credits')}</button>
    {error && <p role="status">{error}</p>}
  </div>;
}
