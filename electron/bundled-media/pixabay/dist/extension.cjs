const path = require('node:path');
const client = require('./client.cjs');

const CHIPS = {
  video: [
    ['Green screen', { q: 'green screen' }], ['Background', { q: 'background loop' }], ['Nature', { category: 'nature' }],
    ['Travel', { category: 'travel' }], ['City', { q: 'city' }], ['People', { category: 'people' }], ['Business', { category: 'business' }],
    ['Abstract', { q: 'abstract' }], ['Sky', { q: 'sky clouds' }], ['Ocean', { q: 'ocean' }], ['Particles', { q: 'particles' }],
    ['Food', { category: 'food' }], ['Sports', { category: 'sports' }], ['Animals', { category: 'animals' }], ['Technology', { category: 'computer' }],
  ],
  photo: [
    ['Backgrounds', { category: 'backgrounds' }], ['Nature', { category: 'nature' }], ['Travel', { category: 'travel' }],
    ['People', { category: 'people' }], ['Business', { category: 'business' }], ['Food', { category: 'food' }], ['Animals', { category: 'animals' }],
    ['Places', { category: 'places' }], ['Buildings', { category: 'buildings' }], ['Sports', { category: 'sports' }], ['Fashion', { category: 'fashion' }],
    ['Technology', { category: 'computer' }], ['Music', { category: 'music' }], ['Science', { category: 'science' }], ['Feelings', { category: 'feelings' }],
  ],
};

exports.activate = async function activate(context) {
  const cache = path.join(context.extension.storagePath, 'media-cache');
  const key = () => context.secrets.get('apiKey');
  await context.ui.registerSettings({
    id: 'connection', title: 'Pixabay connection', location: 'settings.plugins',
    fields: [{key:'apiKey', label:'Pixabay API key', type:'secret'}],
  });
  await context.services.register('catalog', {
    async describe() {
      return {kinds:['photo','video'], configured:!!await key(), orientation:true, categories:Object.fromEntries(Object.entries(CHIPS).map(([kind,rows]) => [kind, rows.map(([id]) => id)])), notice:'stock.from_pixabay_under_the_pixabay_content_lic'};
    },
    async search(input, {signal}) {
      const preset = CHIPS[input.kind]?.find(([id]) => id === input.categoryId)?.[1] || {};
      const found = await client.search(request(signal), await key(), {...input, ...preset, q:[input.q, preset.q].filter(Boolean).join(' ')});
      return {...found, results:found.results.map(item => ({...item, license:'pixabay', licenseName:'Pixabay'}))};
    },
    async preview({item}, {signal}) {
      return {path:await client.thumbnail(request(signal), cache, item.thumb)};
    },
    async download({item}, {signal}) {
      const file = await client.download(request(signal), cache, item);
      const name = ((item.tags || 'Pixabay').split(',')[0].trim() || 'Pixabay') + ' ' + item.id + path.extname(file);
      const artifact = await context.media.import({path:file, name});
      return {artifact, credit:{license:'pixabay', providerName:'Pixabay', creator:item.user, landing:item.pageURL, line:client.creditLine(item)}};
    },
  });
  await context.ui.registerIntegration({id:'media', title:'Pixabay', point:'media.sources', service:'catalog', order:20});
};

function request(signal) {
  return (url, options = {}) => fetch(url, {...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal});
}
