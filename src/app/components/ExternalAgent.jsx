import React, { useEffect, useRef } from 'react';
import { Bot, Unplug } from 'lucide-react';
import { t } from '../../i18n/index.js';

// The agent holding the editor over MCP (docs/design/external-agent-mcp.md), in the top bar and on
// Home. Green while it works (CraftAI paused); grey once idle (CraftAI or another agent may take over).
export function ExternalAgentBadge({ owner, onDisconnect }) {
  if (!owner) return null;
  return (
    <div className={`external-badge ${owner.active ? 'is-active' : 'is-idle'}`} role="status"
      title={owner.active ? t('external.name_is_working_in_clipcraft', { name: owner.name }) : t('external.name_is_connected_and_idle', { name: owner.name })}>
      <span className="external-dot" aria-hidden="true" />
      <Bot size={14} aria-hidden="true" />
      <span className="external-name">{owner.name}</span>
      <button type="button" className="icon-btn sm" onClick={onDisconnect} aria-label={t('external.disconnect_name', { name: owner.name })} title={t('external.disconnect')}><Unplug size={13} /></button>
    </div>
  );
}

// First connection of an agent the user has not allowed yet. Deny has the focus; Escape denies.
export function ExternalAgentApproval({ approval, onAnswer }) {
  const deny = useRef(null);
  useEffect(() => {
    if (!approval) return undefined;
    deny.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onAnswer(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approval, onAnswer]);
  if (!approval) return null;
  const name = String(approval.client?.name || t('external.an_mcp_client')).slice(0, 60);
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="external-approve-title" aria-describedby="external-approve-text">
      <div className="modal close-modal external-approve">
        <div className="modal-icon"><Bot size={24} /></div>
        <h3 id="external-approve-title">{t('external.allow_name_to_edit_in_clipcraft', { name })}</h3>
        <p id="external-approve-text" className="muted">
          {t('external.an_agent_on_this_computer_connected_to_cli')}
        </p>
        <div className="modal-actions">
          <button ref={deny} className="btn" onClick={() => onAnswer(false)}>{t('external.dont_allow')}</button>
          <button className="btn btn-primary" onClick={() => onAnswer(true)}>{t('external.allow')}</button>
        </div>
      </div>
    </div>
  );
}
