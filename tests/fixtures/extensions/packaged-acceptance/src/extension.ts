import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';

export async function activate(context: ExtensionContext) {
  let viewProof: unknown = null;
  await context.ui.registerSettings({id: 'settings', title: 'Acceptance settings', location: 'settings.plugins', fields: [
    {key: 'label', label: 'Marker label', type: 'string', default: 'Packaged marker'},
  ]});
  await context.commands.register('mark', async () => {
    const snapshot = await context.workspace.inspect({section: 'markers', limit: 1});
    const label = await context.configuration.get<string>('label');
    const result = await context.markers.apply({documentId: snapshot.documentId, projectRevision: snapshot.projectRevision,
      operations: [{type: 'add', time_sec: 1, label: label ?? 'Packaged marker'}]});
    return {applied: result.applied};
  });
  const action = await context.ui.registerAction({id: 'mark', title: 'Add acceptance marker', location: 'toolbar', command: 'mark',
    order: -100, enabled: false, disabledReason: 'Starting acceptance fixture', icon: {paths: ['M6 3 L18 3 L18 21 L12 16 L6 21 Z']}});
  await context.ui.registerInspector({id: 'picture', title: 'Packaged picture', lanes: ['video'], fields: [
    {key: 'opacity', label: 'Packaged opacity', property: 'opacity', type: 'number'},
  ]});
  const view = await context.ui.registerView({id: 'panel', title: 'Packaged view', entry: 'assets/panel.html'});
  view.onMessage(async value => {
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'ready') {
      viewProof = value;
      await view.postMessage({kind: 'reply', label: await context.configuration.get('label')});
    }
  });
  await context.commands.register('proof', async () => ({label: await context.configuration.get('label'), view: viewProof,
    capabilities: await context.host.capabilities(), host: await context.host.read()}));
  await action.update({enabled: true, disabledReason: ''});
}
