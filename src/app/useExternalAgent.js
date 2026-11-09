// External agents in the app shell (docs/design/external-agent-mcp.md): owns the external host,
// answers the main process's calls, tracks who is connected and which agent waits for approval,
// and feeds the agent's activity to the CraftAI panel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createExternalHost, externalInstructions } from '../features/agent/externalHost.js';

// appRef.current: { screen(), project(), loadVersion(), dispatch, settle, pilotApp, craftBusy(), projects }
export function useExternalAgent(appRef, settingsVersion, craftBusy) {
  const [status, setStatus] = useState(null);
  const [approval, setApproval] = useState(null); // { id, client }
  const listeners = useRef(new Set());
  const host = useRef(null);
  const provider = useRef('');

  const announce = useCallback(() => {
    if (!host.current || !window.api.externalHostReady) return;
    const { tools } = host.current.refresh();
    window.api.externalHostReady({ tools, instructions: externalInstructions() }).then((s) => { if (s) setStatus(s); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.api.onExternalCall) return undefined;
    const app = () => appRef.current;
    host.current = createExternalHost({
      screen: () => app().screen(), project: () => app().project(), loadVersion: () => app().loadVersion(),
      dispatch: (action) => app().dispatch(action), settle: () => app().settle(), get pilotApp() { return app().pilotApp; },
      provider: () => provider.current, craftBusy: () => app().craftBusy(), projects: {
        status: () => app().projects.status(), list: (q) => app().projects.list(q), create: (a) => app().projects.create(a),
        open: (a) => app().projects.open(a), save: (p) => app().projects.save(p), close: () => app().projects.close(),
      },
      onActivity: (event) => { for (const listener of listeners.current) listener(event); },
    });
    const offs = [
      window.api.onExternalCall(async (req) => {
        const result = await host.current.call(req);
        window.api.externalResult({ callId: req.callId, result }).catch(() => {});
      }),
      window.api.onExternalCancel((req) => host.current.cancel(req.callId)),
      window.api.onExternalReleased(() => host.current.release()),
      window.api.onExternalStatus((s) => setStatus(s)),
      window.api.onExternalApprove((req) => setApproval(req)),
      window.api.onExternalApproveDone((req) => setApproval((a) => (a?.id === req.id ? null : a))),
    ];
    announce();
    window.api.externalStatus?.().then(setStatus).catch(() => {});
    return () => offs.forEach((off) => off?.());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Image generation follows the assistant's provider (Codex): re-offer the list when it changes.
  useEffect(() => {
    window.api.settingsGet?.().then((s) => {
      if (s?.provider === provider.current) return;
      provider.current = s?.provider || '';
      announce();
    }).catch(() => {});
  }, [settingsVersion, announce]);

  // CraftAI running: the main process refuses outside agents meanwhile.
  useEffect(() => { window.api.externalCraftBusy?.(!!craftBusy).catch(() => {}); }, [craftBusy]);

  const subscribe = useCallback((listener) => { listeners.current.add(listener); return () => listeners.current.delete(listener); }, []);
  const answer = useCallback((allow) => {
    setApproval((a) => { if (a) window.api.externalApproval({ id: a.id, allow }).catch(() => {}); return null; });
  }, []);
  const disconnect = useCallback(() => window.api.externalDisconnect?.().then(setStatus).catch(() => {}), []);
  // holder: an agent working now (CraftAI pauses); owner: the agent holding the editor, even idle.
  const owner = status?.owner?.client?.name ? { name: status.owner.client.name, active: !!status.owner.active } : null;
  return { status, owner, holder: owner?.active ? owner.name : null, approval, answer, disconnect, subscribe, setStatus };
}
