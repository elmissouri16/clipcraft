const path = require('node:path');
const client = require('./client.cjs');

const SOUNDZA_TAGS = [
  ['Whoosh', { q: 'whoosh' }], ['Transition', { goodFor: 'transition' }], ['UI clicks', { goodFor: 'ui_click' }],
  ['Notification', { goodFor: 'notification' }], ['Impact', { goodFor: 'impact_on_beat' }], ['Reveal', { goodFor: 'reveal' }],
  ['Footsteps', { goodFor: 'footsteps' }], ['Magic', { q: 'magic' }], ['Explosion', { q: 'explosion' }],
  ['Cartoon', { style: 'cartoon' }], ['Retro', { style: 'retro' }], ['Ambience', { type: 'ambience', goodFor: 'background_bed' }],
];

exports.activate = async function activate(context) {
  const cache = path.join(context.extension.storagePath, 'media-cache');
  const key = () => context.secrets.get('apiKey');
  await context.ui.registerSettings({
    id: 'connection', title: 'Soundza connection', location: 'settings.plugins',
    fields: [{key:'apiKey', label:'Soundza API key', type:'secret'}],
  });
  await context.services.register('catalog', {
    async describe() {
      return {kinds:['sfx'], configured:!!await key(), notice:'audio.sounds_from_soundza_under_the_soundza_stan', categories:{sfx:SOUNDZA_TAGS.map(([id]) => id)}};
    },
    async search(input, {signal}) {
      const preset = SOUNDZA_TAGS.find(([id]) => id === input.categoryId)?.[1] || {};
      return client.search(request(signal), await key(), {...preset, ...input, q:input.q || preset.q || ''});
    },
    async preview({item}, {signal}) {
      const file = item.previewUrl ? await client.preview(request(signal), cache, item) : await client.download(request(signal), cache, item, await key());
      return {path:file};
    },
    async download({item}, {signal}) {
      const file = await client.download(request(signal), cache, item, await key());
      const artifact = await context.media.import({path:file, name:item.title + path.extname(file)});
      return {artifact, credit:{title:item.title, creator:item.creator, license:item.license, licenseName:item.licenseName, licenseUrl:item.licenseUrl, landing:item.landing, providerName:'Soundza', line:client.creditLine(item)}};
    },
  });
  await context.ui.registerIntegration({id:'media', title:'Soundza', point:'media.sources', service:'catalog', order:30});
};

function request(signal) {
  return (url, options = {}) => fetch(url, {...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal});
}
