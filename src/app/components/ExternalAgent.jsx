import React, { useEffect, useRef } from 'react';
import { Bot, Unplug } from 'lucide-react';

// The agent holding the editor over MCP (docs/design/external-agent-mcp.md), in the top bar and on
// Home. Green while it works (CraftAI paused); grey once idle (CraftAI or another agent may take over).
export function ExternalAgentBadge({ owner, onDisconnect }) {
  if (!owner) return null;
  return (
    <div className={`external-badge ${owner.active ? 'is-active' : 'is-idle'}`} role="status"
      title={owner.active ? `${owner.name} is working in ClipCraft. CraftAI is paused.` : `${owner.name} is connected and idle. CraftAI can be used.`}>
      <span className="external-dot" aria-hidden="true" />
      <Bot size={14} aria-hidden="true" />
      <span className="external-name">{owner.name}</span>
      <button type="button" className="icon-btn sm" onClick={onDisconnect} aria-label={`Disconnect ${owner.name}`} title="Disconnect"><Unplug size={13} /></button>
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
  const name = String(approval.client?.name || 'An MCP client').slice(0, 60);
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="external-approve-title" aria-describedby="external-approve-text">
      <div className="modal close-modal external-approve">
        <div className="modal-icon"><Bot size={24} /></div>
        <h3 id="external-approve-title">Allow “{name}” to edit in ClipCraft?</h3>
        <p id="external-approve-text" className="muted">
          An agent on this computer connected to ClipCraft’s MCP server. If you allow it, it can open, create and save projects,
          import files and export videos, with the same tools CraftAI uses. CraftAI pauses while it is connected. You can disconnect it
          at any time, and remove it in Settings &gt; External agents.
        </p>
        <div className="modal-actions">
          <button ref={deny} className="btn" onClick={() => onAnswer(false)}>Don’t allow</button>
          <button className="btn btn-primary" onClick={() => onAnswer(true)}>Allow</button>
        </div>
      </div>
    </div>
  );
}
